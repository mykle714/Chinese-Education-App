/**
 * Mastery compute — server entry point.
 *
 * The formula itself lives in `server/contracts/mastery.ts`, the one module both the
 * server and the client consume (docs/ARCHITECTURE_REVIEW.md finding 3). This file
 * is a re-export so every existing `from '../utils/masteryCompute.js'` import keeps
 * working; it holds no logic of its own.
 *
 * The SQL functions `compute_utcm_category()` (migration 101) and
 * `compute_type_category()` (migration 128) still exist because the generated
 * `vocabentries_*.category` column depends on them. They are pinned to this
 * implementation by `server/__tests__/mastery.test.ts`.
 *
 * See docs/MASTERY_REWORK.md.
 */
export type { MasteryGoals, MasteryBar, MasteryBarSegment } from '../contracts/mastery.js';
export {
  PBH_FULL,
  PBH_BAND,
  PBH_MAX_TERM_CAP,
  PBH_THRESHOLDS,
  positiveCount,
  positivesByType,
  goalTypes,
  progressBarHeight,
  categoryForPbh,
  computeUtcm,
  computeTypeCategory,
  masteryBar,
  appendTypedMark,
  perfectTypedMarkHistory,
} from '../contracts/mastery.js';
