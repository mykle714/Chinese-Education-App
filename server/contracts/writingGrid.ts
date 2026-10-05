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
 * client (the game page, medals) load one definition.
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
}

/** A candidate before sampling. */
export interface WritingGridCandidate {
  char: string;
  pinyin: string | null;
  writingMastery: number;
  /** The character's own writing clock is still running (its marks would be dropped). */
  cooled: boolean;
}

/**
 * Pick `count` distinct characters, weighting each band by the Study Mix quota
 * (Target 5 · Unfamiliar 2 · Comfortable 2 · Mastered 1). Off-cooldown characters are
 * drawn first; cooled ones only fill what is left. `random` is injectable for tests.
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

  drawFrom(candidates.filter((c) => !c.cooled));
  drawFrom(candidates.filter((c) => c.cooled));
  return picked;
}

// ── Medals (estimated 2026-10-04 — tune from play data) ────────────────────────
// ~15s to arrange + 8 characters at ~6–10 strokes: levels 1–4 ~8s each, 5–8 ~12s
// each, plus a retry or two. Time-based like Word Search, with a no-medal tier like
// Speed Reading.
export const WRITING_GRID_MEDAL_THRESHOLDS_MS = { gold: 120_000, silver: 210_000, bronze: 360_000 } as const;

export type WritingGridMedal = 'gold' | 'silver' | 'bronze' | null;

/** Medal for a finished board's total time (ms), or null when slower than bronze. */
export function medalForWritingGrid(totalMs: number): WritingGridMedal {
  if (totalMs <= WRITING_GRID_MEDAL_THRESHOLDS_MS.gold) return 'gold';
  if (totalMs <= WRITING_GRID_MEDAL_THRESHOLDS_MS.silver) return 'silver';
  if (totalMs <= WRITING_GRID_MEDAL_THRESHOLDS_MS.bronze) return 'bronze';
  return null;
}
