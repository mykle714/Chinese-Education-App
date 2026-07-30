/**
 * Mastery compute — client entry point.
 *
 * The formula itself lives in `server/contracts/mastery.ts`, the one module both the
 * server and the client consume. This file is a re-export so every existing
 * `from "../utils/masteryCompute"` import keeps working; it holds no logic of its own
 * beyond the two client-only presentation maps below.
 *
 * The header this file used to carry — *"Mirror of server/utils/masteryCompute.ts and
 * the SQL compute_utcm_category(). Keep the three in sync."* — described the problem
 * rather than fixing it (and by then there were four copies, not three).
 * See docs/ARCHITECTURE_REVIEW.md finding 3 and docs/MASTERY_REWORK.md.
 */
import type { MarkType } from "../types";

export type { MasteryGoals, MasteryBar, MasteryBarSegment } from "../../server/contracts/mastery";
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
} from "../../server/contracts/mastery";

// ─── Client-only presentation ───────────────────────────────────────────────────

/**
 * App light colors per mark type (docs/MASTERY_REWORK.md). NOTE: these currently
 * collide with the utcm category colors; to be rectified later.
 */
export const MARK_TYPE_COLORS: Record<MarkType, string> = {
  recognition: "#779BE7", // blue
  production: "#05C793",  // green
  reading: "#EF476F",     // red
  writing: "#FF8E47",     // yellow
};

export const MARK_TYPE_LABELS: Record<MarkType, string> = {
  recognition: "Recognition",
  production: "Production",
  reading: "Reading",
  writing: "Writing",
};
