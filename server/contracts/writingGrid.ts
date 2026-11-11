/**
 * writingGrid.ts — the Writing Grid game's shared rules (docs/WRITING_PRACTICE_REWORK.md § 2).
 *
 * A grid of 8 single characters, 4 rows × 2 columns; grid POSITION i (reading order) is practised at
 * level i + 1 (server/contracts/writingLevels.ts). Characters come from any of the
 * learner's vet entries — split into characters — sampled across their WRITING mastery
 * bands in the Study Mix proportions (STUDY_MIX_QUOTAS); a learner with fewer than 8
 * eligible characters is lent cards.
 *
 * Pure — sibling contract imports only — so the server (WritingGridService) and the
 * client (the game's Stage) load one definition. The run's speed tiers are client-only
 * (src/games/writing-grid/constants.ts → SPEED_TIERS).
 */
import { STUDY_MIX_QUOTAS } from './studyMix.js';
import { categoryForPbh } from './mastery.js';
import type { FlashcardCategory } from './wire.js';

/** Cells on the board (4 rows × 2 columns, a tall phone-shaped board) — one per level. */
export const WRITING_GRID_SIZE = 8;
export const WRITING_GRID_COLUMNS = 2;

/** One dealt cell. */
export interface WritingGridCharacter {
  /** The character to write. */
  char: string;
  /** Its single-character vet row (created hidden/provisional when the learner had none) — the row a check marks. */
  cardId: number;
  /** Its writing mastery (0–8) at deal time. */
  writingMastery: number;
  /** Tone-marked pinyin from the det row — the Phase 2 prompt once the glyph is hidden. */
  pinyin: string | null;
  /**
   * The character's dd (sense-pick aware), shown under the pinyin in Phase 2 cells that
   * have no shadow preview (levels above WRITING_GRID_SHADOW_MAX_LEVEL on the client).
   */
  definition: string | null;
  /**
   * The cell's row is a card the learner holds, not a hidden provisional one. A correct,
   * recorded mark on it takes that card off a Deck Tower; a mark on a hidden row never
   * does, because the tower never counted it (docs/FLP_GAME_BREAKS.md § 6).
   */
  ownCard: boolean;
  /** A focused break's cell from outside today's set, so it was never on the tower. */
  outsideFocus?: boolean;
}

/** A candidate before sampling. */
export interface WritingGridCandidate {
  char: string;
  pinyin: string | null;
  writingMastery: number;
  /** The character's own writing clock is still running (its marks would be dropped). */
  cooled: boolean;
  /**
   * Draw this character ahead of the rest at the same cooldown state: on an flp break, a
   * character of the working loop's words, or on a focused break, one outside today's set.
   */
  preferred?: boolean;
}

/**
 * Pick `count` distinct characters, weighting each band by the Study Mix quota
 * (Target 5 · Unfamiliar 2 · Comfortable 2 · Mastered 1). Off-cooldown characters are
 * drawn first; cooled ones only fill what is left. Within each, `preferred` characters go
 * first, the same ladder as an flp break's card pools (docs/FLP_GAME_BREAKS.md § 4).
 * `random` is injectable for tests.
 */
export function sampleWritingGridCharacters(
  candidates: readonly WritingGridCandidate[],
  count: number = WRITING_GRID_SIZE,
  random: () => number = Math.random
): WritingGridCandidate[] {
  const weightOf = new Map<FlashcardCategory, number>(STUDY_MIX_QUOTAS.map((q) => [q.category, q.count]));
  const picked: WritingGridCandidate[] = [];

  const drawFrom = (pool: WritingGridCandidate[]) => {
    const remaining = pool.slice();
    while (picked.length < count && remaining.length > 0) {
      const weights = remaining.map((c) => weightOf.get(categoryForPbh(c.writingMastery)) ?? 1);
      const total = weights.reduce((a, b) => a + b, 0);
      let r = random() * total;
      let index = 0;
      for (; index < remaining.length - 1; index++) {
        r -= weights[index];
        if (r < 0) break;
      }
      picked.push(remaining[index]);
      remaining.splice(index, 1);
    }
  };

  drawFrom(candidates.filter((c) => !c.cooled && c.preferred));
  drawFrom(candidates.filter((c) => !c.cooled && !c.preferred));
  drawFrom(candidates.filter((c) => c.cooled && c.preferred));
  drawFrom(candidates.filter((c) => c.cooled && !c.preferred));
  return picked;
}
