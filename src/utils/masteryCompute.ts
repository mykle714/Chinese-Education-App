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
import type { MasteryBarId } from "../../server/contracts/wire";

export type { MasteryGoals, MasteryBar, MasteryBarSegment } from "../../server/contracts/mastery";
export {
  COOLDOWN_MS_BY_CATEGORY,
  lastCorrectMarkTimestamp,
  cooldownRemainingMs,
  isTypeOnCooldown,
  readyMarkTypes,
} from "../../server/contracts/cooldown";
export type { MasteryBarId } from "../../server/contracts/wire";
export {
  PBH_FULL,
  PBH_BAND,
  PBH_MAX_TERM_CAP,
  PBH_THRESHOLDS,
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
} from "../../server/contracts/mastery";

// ─── Client-only presentation ───────────────────────────────────────────────────

/**
 * App light colors per mark type (docs/MASTERY_REWORK.md). NOTE: these currently
 * collide with the utcm category colors; to be rectified later.
 */
// ⚠️ THESE FOUR HEXES ARE LITERAL ON PURPOSE — do not re-point them at the pastel ramp
// in `theme/colors.ts`. The shelf design (docs/SHELF_REDESIGN.md) spells them inline
// wherever a mark is drawn: the Card Detail `.msb` mark cells and cooldown legend use
// `#779BE7` Recognition / `#05C793` Production / `#EF476F` Reading, and the deck-preview
// mini-card two-mark strip repeats the same blue and green. A mark cell is a small solid
// mark read directly against the paper ground with nothing sitting on top of it, so it
// takes the SATURATED hue — unlike a band chip or a spine, which is a FILL and therefore
// pastel (see CATEGORY_COLORS). A previous pass moved these to the pastels and the cells
// vanished; that is why the distinction is spelled out here.
//
// Writing has no artboard of its own; it keeps the orange it has always had, which is
// also the design's tone-4 orange.
export const MARK_TYPE_COLORS: Record<MarkType, string> = {
  recognition: "#779BE7", // blue
  production: "#05C793",  // green
  reading: "#EF476F",     // red
  writing: "#FF8E47",     // orange
};

/**
 * The green of the "cooldown elapsed, this track is markable now" check icon.
 *
 * The design fixes this at `#05C793` (`.msb .cd3 .ms` and `.mst .cdr .ms` in
 * `shelf-system.css`) — the same green as a Production mark, but a separate constant
 * because the icon means "ready", not "production". Kept here beside the mark colors
 * rather than in `theme/colors.ts` because only the mastery surfaces draw it.
 */
export const MASTERY_READY_COLOR = "#05C793";

export const MARK_TYPE_LABELS: Record<MarkType, string> = {
  recognition: "Recognition",
  production: "Production",
  reading: "Reading",
  writing: "Writing",
};

/**
 * User-facing names for the three mastery bars (migration 143).
 *
 * The core bar is called "Know" rather than "Core": the learner never sees the word
 * "core" anywhere else, and what the bar actually measures is whether they know the
 * word — recognition plus production — as opposed to reading or writing it.
 */
export const BAR_LABELS: Record<MasteryBarId, string> = {
  core: "Know",
  reading: "Read",
  writing: "Write",
};

// NOTE: a bar has no single color WHERE IT IS DRAWN AS A BAR. Both surfaces that paint
// one — the cdp track and the mini-card strip — color it by its SEGMENTS' mark types
// (MARK_TYPE_COLORS), so there is nothing to name there.
//
// The fdp's Mastered TILES do need one color per bar, and that lives in
// MASTERY_BAR_COLORS (src/utils/categoryColors.ts) beside the other tile palettes. It
// borrows from MARK_TYPE_COLORS for reading/writing rather than inventing hues.
