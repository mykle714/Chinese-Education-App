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
import { COLORS } from "../theme/colors";
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
 * One colour per MARK TYPE — the identity of a skill, not a measure of progress
 * (docs/MASTERY_REWORK.md).
 *
 * ⚠️ NOT for mastery cells. Since 2026-09-23 a mastery window is coloured by the
 * track's BAND (`getBandMark`, utils/categoryColors.ts): "mastery bars are colored by
 * mastery progress, not the mark type". These remain for surfaces that name a SKILL —
 * Bubble Match's track toggle dot and the eip tab strip (`TAB_COLORS`).
 *
 * v2 (docs/SHELF_REDESIGN.md § A1b): the four v1 literals (#779BE7 / #05C793 / #EF476F /
 * #FF8E47) were outside the palette; they are now the MARK tier of the hue each skill
 * has always owned, so a skill dot and a mastery cell are drawn from one register.
 */
export const MARK_TYPE_COLORS: Record<MarkType, string> = {
  recognition: COLORS.bluMk,
  production: COLORS.grnMk,
  reading: COLORS.redMk,
  writing: COLORS.orgMk,
};

/**
 * The "cooldown elapsed, this track is markable now" check icon. v2 draws it
 * `var(--success)`, which is ink — the check glyph says "ready" by its shape. Kept as a
 * named constant so the mastery surfaces agree on it.
 */
export const MASTERY_READY_COLOR = COLORS.successInk;

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

// NOTE: both mastery surfaces — the cdp window and the mini-card strip — colour every
// filled cell by the track's utcm BAND (`getBandMark`, categoryColors.ts), while the
// cells' LENGTHS still come from the per-mark-type segments. See docs/MASTERY_REWORK.md
// § "Mini cards — the eight-mark window".
//
// The fdp's Mastered TILES need one colour per bar; that lives in MASTERY_BAR_COLORS
// (src/utils/categoryColors.ts) beside the other tile palettes.
