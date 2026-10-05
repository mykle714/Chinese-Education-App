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
 */
export class WritingGridService {
  constructor(
    private writingGridDAL: IWritingGridDAL,
    private provisionalCardService: ProvisionalCardService,
    private random: () => number = Math.random
  ) {}

  async deal(userId: string): Promise<WritingGridCharacter[]> {
    const now = Date.now();
    let rows = await this.writingGridDAL.findCandidateCharacters(userId, []);

    if (rows.length < WRITING_GRID_SIZE) {
      // Lend words until the characters cover the board. Words carry ≥1 new character
      // each, so asking for the shortfall in words is enough in the worst case.
      const { lentIds } = await this.provisionalCardService.acquireLentCards(
        userId, 'zh', WRITING_GRID_SIZE - rows.length
      );
      rows = await this.writingGridDAL.findCandidateCharacters(userId, lentIds);
    }

    // Pinyin and dd resolve through the shared twins so they honour the learner's sense
    // pick on the character's own vet row — the same text their flashcard shows.
    const definitionByChar = new Map<string, string | null>();
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
      };
    });
    const picked = sampleWritingGridCharacters(candidates, WRITING_GRID_SIZE, this.random);
    const ids = await this.writingGridDAL.ensureCharacterRows(userId, picked.map((p) => p.char));

    return picked
      .filter((p) => ids.has(p.char))
      .map((p) => ({
        char: p.char,
        cardId: ids.get(p.char)!,
        writingMastery: p.writingMastery,
        pinyin: p.pinyin,
        definition: definitionByChar.get(p.char) ?? null,
      }));
  }
}
