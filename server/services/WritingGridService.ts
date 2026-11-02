import type { IWritingGridDAL } from '../dal/interfaces/IWritingGridDAL.js';
import type { ProvisionalCardService } from './ProvisionalCardService.js';
import { positiveCount } from '../contracts/mastery.js';
import { isBarOnCooldown } from '../contracts/cooldown.js';
import { resolveDisplayDefinition, resolveDisplayPronunciation } from '../utils/definitions.js';
import {
  WRITING_GRID_SIZE,
  sampleWritingGridCharacters,
  type WritingGridCandidate,
  type WritingGridCharacter,
} from '../contracts/writingGrid.js';

/** What an flp game break adds to a deal (docs/FLP_GAME_BREAKS.md § 4). */
export interface WritingGridDealOptions {
  /** The working loop's vet ids. Their characters go on the board first. */
  seedIds?: number[];
  /**
   * The world's focus state on a focused break: `setIds` is today's whole set and
   * `remainingIds` what is left of it. The seed then does not apply; characters of the
   * set's words are the fallback rather than the first choice (FOCUS_MODE.md § 4a).
   */
  focusBreak?: { setIds: number[]; remainingIds: number[] } | null;
}

/** The distinct characters of some vet entry keys. */
const charsOf = (entryKeys: readonly string[]): Set<string> =>
  new Set(entryKeys.flatMap((key) => Array.from(key)));

/**
 * WritingGridService — deals the Writing Grid's 8 characters
 * (docs/WRITING_PRACTICE_REWORK.md § 2).
 *
 * LAYER: service. Candidate characters come from every vet word the learner owns, split
 * into characters; each is banded by its OWN single-character writing mastery and
 * sampled in Study Mix proportions (`sampleWritingGridCharacters`). Short of 8 →
 * lend cards (ProvisionalCardService.acquireLentCards) and split those too. Every dealt
 * character is guaranteed a single-character vet row (hidden provisional when new), so
 * each cell's check can mark it directly.
 *
 * An flp game break deals with `WritingGridDealOptions`. Its seeds are WORDS and the board
 * is CHARACTERS, so a seed reaches the board as its characters; those of a just-studied
 * multi-character word usually stay markable, because the word's result never restarts a
 * character's own clock (docs/WRITING_PRACTICE_REWORK.md § 3a).
 */
export class WritingGridService {
  constructor(
    private writingGridDAL: IWritingGridDAL,
    private provisionalCardService: ProvisionalCardService,
    private random: () => number = Math.random
  ) {}

  async deal(userId: string, options: WritingGridDealOptions = {}): Promise<WritingGridCharacter[]> {
    const now = Date.now();
    const { focusBreak = null } = options;
    const seedIds = focusBreak ? [] : options.seedIds ?? [];
    // Seed words count as candidates even if lent, or a lent word in the loop would vanish.
    let rows = await this.writingGridDAL.findCandidateCharacters(userId, seedIds);
    const namedChars = charsOf(
      await this.writingGridDAL.findEntryKeys(userId, focusBreak ? focusBreak.setIds : seedIds)
    );
    // The seed's characters go first; a focused break inverts that (today's set goes last).
    const isPreferred = (char: string) => namedChars.has(char) !== (focusBreak !== null);

    // Never for a focused break, which has the learner's whole pile to draw on.
    if (rows.length < WRITING_GRID_SIZE && !focusBreak) {
      // Lend words until the characters cover the board. Words carry ≥1 new character
      // each, so asking for the shortfall in words is enough in the worst case.
      const { lentIds } = await this.provisionalCardService.acquireLentCards(
        userId, 'zh', WRITING_GRID_SIZE - rows.length
      );
      rows = await this.writingGridDAL.findCandidateCharacters(userId, [...seedIds, ...lentIds]);
    }

    // Pinyin and dd resolve through the shared twins so they honour the learner's sense
    // pick on the character's own vet row — the same text their flashcard shows.
    const definitionByChar = new Map<string, string | null>();
    const ownCards = new Set(rows.filter((row) => row.ownCard).map((row) => row.char));
    const candidates: WritingGridCandidate[] = rows.map((row) => {
      const senseInput = {
        pronunciation: row.pinyin,
        definition: row.definition,
        definitionClusters: row.definitionClusters as never,
        selectedSense: row.selectedSense,
      };
      definitionByChar.set(row.char, resolveDisplayDefinition(senseInput) || null);
      return {
        char: row.char,
        pinyin: resolveDisplayPronunciation(senseInput),
        writingMastery: positiveCount(row.typedMarkHistory?.writing),
        cooled: row.typedMarkHistory ? isBarOnCooldown(row.typedMarkHistory, 'writing', now) : false,
        preferred: isPreferred(row.char),
      };
    });
    const picked = sampleWritingGridCharacters(candidates, WRITING_GRID_SIZE, this.random);
    const ids = await this.writingGridDAL.ensureCharacterRows(userId, picked.map((p) => p.char));
    const remaining = focusBreak ? new Set(focusBreak.remainingIds) : null;

    return picked
      .filter((p) => ids.has(p.char))
      .map((p) => ({
        char: p.char,
        cardId: ids.get(p.char)!,
        writingMastery: p.writingMastery,
        pinyin: p.pinyin,
        definition: definitionByChar.get(p.char) ?? null,
        ownCard: ownCards.has(p.char),
        ...(remaining && !remaining.has(ids.get(p.char)!) && { outsideFocus: true }),
      }));
  }
}
