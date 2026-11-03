import type { IWritingGridDAL } from '../dal/interfaces/IWritingGridDAL.js';
import type { ProvisionalCardService } from './ProvisionalCardService.js';
import type { WritingGridDealOptions } from './WritingGridService.js';
import { isBarOnCooldown } from '../contracts/cooldown.js';
import { isFeatureEnabled } from '../contracts/featureFlags.js';
import { resolveDisplayDefinition, resolveDisplayPronunciation } from '../utils/definitions.js';
import {
  SUPERPOSITION_CHAR_COUNT,
  pickSuperpositionWords,
  type SuperpositionCandidate,
  type SuperpositionWord,
} from '../contracts/superposition.js';

/**
 * SuperpositionService — deals a Superposition board (docs/SUPERPOSITION_GAME.md § Deal).
 *
 * LAYER: service. Reuses the Writing Grid's DAL, because both deal the learner's zh words
 * down to characters with a single-character vet row to mark. The difference is the unit:
 * this board keeps WORDS, since a word is one hint row (pinyin, dd, audio).
 *
 * The focus rule and the lending rule match WritingGridService: a focused break draws from
 * outside today's set first and never lends; otherwise a short board lends words.
 *
 * Stored tile groups ride along only while `FEATURE_FLAGS.superpositionStoredGroups` is on
 * (docs/SUPERPOSITION_GAME.md § Stored groups); otherwise the client computes them.
 */
export class SuperpositionService {
  constructor(
    private writingGridDAL: IWritingGridDAL,
    private provisionalCardService: ProvisionalCardService,
    private random: () => number = Math.random
  ) {}

  async deal(userId: string, options: WritingGridDealOptions = {}): Promise<SuperpositionWord[]> {
    const now = Date.now();
    const { focusBreak = null } = options;
    const seedIds = focusBreak ? [] : options.seedIds ?? [];
    const namedIds = new Set(focusBreak ? focusBreak.setIds : seedIds);

    const pick = async (extraIds: number[]) => {
      const [words, characters] = await Promise.all([
        this.writingGridDAL.findCandidateWords(userId, extraIds),
        this.writingGridDAL.findCandidateCharacters(userId, extraIds),
      ]);
      // A word's marks land on its characters, so it is the characters' clocks that count.
      const cooledChars = new Set(
        characters
          .filter((c) => c.typedMarkHistory && isBarOnCooldown(c.typedMarkHistory, 'writing', now))
          .map((c) => c.char)
      );
      const candidates: SuperpositionCandidate[] = words.map((row) => {
        const senseInput = {
          pronunciation: row.pinyin,
          definition: row.definition,
          definitionClusters: row.definitionClusters as never,
          selectedSense: row.selectedSense,
        };
        return {
          entryKey: row.entryKey,
          pinyin: resolveDisplayPronunciation(senseInput),
          definition: resolveDisplayDefinition(senseInput) || null,
          cooled: Array.from(row.entryKey).some((c) => cooledChars.has(c)),
          // A seed goes first; a focused break inverts that (today's set goes last).
          preferred: namedIds.has(row.id) !== (focusBreak !== null),
        };
      });
      const picked = pickSuperpositionWords(candidates, SUPERPOSITION_CHAR_COUNT, this.random);
      return {
        picked,
        ownCards: new Set(characters.filter((c) => c.ownCard).map((c) => c.char)),
      };
    };

    let { picked, ownCards } = await pick(seedIds);
    const charsOnBoard = () => picked.reduce((sum, word) => sum + Array.from(word.entryKey).length, 0);

    // Never for a focused break, which has the learner's whole pile to draw on.
    if (charsOnBoard() < SUPERPOSITION_CHAR_COUNT && !focusBreak) {
      const { lentIds } = await this.provisionalCardService.acquireLentCards(
        userId, 'zh', SUPERPOSITION_CHAR_COUNT - charsOnBoard()
      );
      ({ picked, ownCards } = await pick([...seedIds, ...lentIds]));
    }

    const ids = await this.writingGridDAL.ensureCharacterRows(
      userId,
      picked.flatMap((word) => Array.from(word.entryKey))
    );
    const remaining = focusBreak ? new Set(focusBreak.remainingIds) : null;
    const storedGroups = isFeatureEnabled('superpositionStoredGroups')
      ? await this.writingGridDAL.findSuperpositionGroups([...ids.keys()])
      : new Map<string, number[][]>();

    return picked
      .filter((word) => Array.from(word.entryKey).every((char) => ids.has(char)))
      .map((word) => ({
        entryKey: word.entryKey,
        pinyin: word.pinyin,
        definition: word.definition,
        characters: Array.from(word.entryKey).map((char) => ({
          char,
          cardId: ids.get(char)!,
          ownCard: ownCards.has(char),
          ...(remaining && !remaining.has(ids.get(char)!) && { outsideFocus: true }),
          ...(storedGroups.has(char) && { strokeGroups: storedGroups.get(char)! }),
        })),
      }));
  }
}
