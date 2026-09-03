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
import { PBH_FULL as PBH_FULL_VALUE } from "../../server/contracts/mastery";
import type { MasteryBar } from "../../server/contracts/mastery";
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

/** One cell of an eight-mark window: how full it is (0..1) and which track owns it. */
export interface MasteryWindowCell {
  /** 0 = empty, 1 = full, in between = a partial trailing cell. */
  fill: number;
  /** The mark type whose segment covers the filled part; null when the cell is empty. */
  type: MarkType | null;
}

/**
 * A bar's pbh as `PBH_FULL` discrete cells — the shape BOTH mastery surfaces draw.
 *
 * pbh is not a percentage: it is a position in an eight-mark window, and the band cut
 * points are counts inside that window. So the value is drawn as what it is, one cell
 * per mark. Cell `i` covers the pbh interval `[i, i+1)`, so its fill is
 * `clamp(pbh - i, 0, 1)`; a fractional core pbh leaves the last filled cell partial
 * rather than rounded, because rounding would make two genuinely different cards read
 * the same.
 *
 * Returns the owning mark **type**, NOT a color, because the two surfaces paint the same
 * geometry from different palettes: the cdp window colors by mark type
 * (`MARK_TYPE_COLORS`), while the mini-card strip colors every filled cell with the
 * bar's utcm band (`getBandInk`). Handing back a color would force one palette on both.
 *
 * Consumers: `src/components/mastery/MasteryWindow.tsx` (the cdp window, which is where
 * this logic lived before the mini card needed it too) and
 * `src/components/MiniVocabCard.tsx` (the thumbnail strip).
 * See docs/MASTERY_REWORK.md § "Mini cards — the eight-mark window".
 */
export function masteryWindowCells(bar: MasteryBar): MasteryWindowCell[] {
  // Segment extents in pbh units. `fraction` is each type's share of the FILLED length,
  // so scaling by pbh turns shares into positions on the 0..PBH_FULL axis.
  let cursor = 0;
  const extents = bar.segments.map((seg) => {
    const start = cursor;
    cursor += seg.fraction * bar.pbh;
    return { type: seg.type, start, end: cursor };
  });

  return Array.from({ length: PBH_FULL_VALUE }, (_, i) => {
    const fill = Math.min(1, Math.max(0, bar.pbh - i));
    if (fill <= 0) return { fill: 0, type: null };
    // The segment covering the MIDPOINT of the filled part — the midpoint rather than
    // the left edge so a partial cell straddling a boundary takes the color of the half
    // actually painted.
    const midpoint = i + fill / 2;
    // `end` is exclusive except on the last segment, where the midpoint of the final
    // partial cell can land exactly on the boundary — hence the fallback to the last
    // extent rather than returning null on a filled cell.
    const owner =
      extents.find((e) => midpoint >= e.start && midpoint < e.end) ??
      extents[extents.length - 1];
    return { fill, type: owner ? owner.type : null };
  });
}

/**
 * App light colors per mark type (docs/MASTERY_REWORK.md).
 *
 * These collide with the PRE-REDESIGN saturated utcm category colors (same four hexes).
 * That collision is now contained rather than outstanding: the one surface that paints a
 * band as a small solid shape, the mini-card pip strip, uses `BAND_INK`'s darker `*A`
 * tier precisely so the two sets never meet at the same value. See the NOTE at the foot
 * of this file.
 */
// ⚠️ THESE FOUR HEXES ARE LITERAL ON PURPOSE — do not re-point them at the pastel ramp
// in `theme/colors.ts`. The shelf design (docs/SHELF_REDESIGN.md) spells them inline
// wherever a mark is drawn: the Card Detail `.msb` mark cells and cooldown legend use
// `#779BE7` Recognition / `#05C793` Production / `#EF476F` Reading. (Frame 17's deck-preview
// mini-card strip repeated the same blue and green, but the app's strip has since moved its
// COLOR onto the mastery band — see the NOTE at the foot of this file — while keeping the
// frame's geometry.) A mark cell is a small solid
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

// NOTE: the cdp track colors a bar by its SEGMENTS' mark types (MARK_TYPE_COLORS), so
// there is nothing to name there.
//
// The mini-card strip NO LONGER DOES. Its pips are colored by the lens bar's utcm BAND
// (`getBandInk`, categoryColors.ts) while their lengths stay per mark type — see
// docs/MASTERY_REWORK.md § "Mini cards — the eight-mark window". So the two mastery surfaces now
// answer with different palettes on purpose, and `getBandInk` is deliberately the ramp's
// dark `*A` tier rather than the pre-redesign saturated band hexes, which are byte-for-byte
// the four values in MARK_TYPE_COLORS above. Blue must not mean "Recognition" on the cdp
// and "Mastered" on the thumbnail beside it.
//
// The fdp's Mastered TILES do need one color per bar, and that lives in
// MASTERY_BAR_COLORS (src/utils/categoryColors.ts) beside the other tile palettes. It
// borrows from MARK_TYPE_COLORS for reading/writing rather than inventing hues.
