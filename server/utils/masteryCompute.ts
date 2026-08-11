/**
 * Mastery compute — server entry point.
 *
 * The formula itself lives in `server/contracts/mastery.ts`, the one module both the
 * server and the client consume (docs/ARCHITECTURE_REVIEW.md finding 3). This file
 * is a re-export so every existing `from '../utils/masteryCompute.js'` import keeps
 * working; it holds no logic of its own.
 *
 * The SQL functions `compute_core_category()` (migration 143) and
 * `compute_type_category()` (migration 128) still exist because the selection queries
 * band cards in-query. They are pinned to this implementation by
 * `server/__tests__/mastery.test.ts`.
 *
 * See docs/MASTERY_REWORK.md.
 */
export type { MasteryGoals, MasteryBar, MasteryBarSegment } from '../contracts/mastery.js';
export {
  PBH_FULL,
  PBH_BAND,
  PBH_MAX_TERM_CAP,
  PBH_THRESHOLDS,
  CATEGORY_ORDER,
  categoryRank,
  bandsClimbed,
  positiveCount,
  positivesByType,
  BAR_MARK_TYPES,
  barForMarkType,
  activeBars,
  isBarActive,
  coreProgressBarHeight,
  barProgressBarHeight,
  barCategory,
  categoryForPbh,
  computeCoreCategory,
  computeTypeCategory,
  masteryBar,
  masteryBars,
  masteredAtForBar,
  appendTypedMark,
  coreMasteredTypedMarkHistory,
} from '../contracts/mastery.js';
