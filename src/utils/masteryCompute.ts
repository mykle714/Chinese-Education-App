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
import type { MasteryWorldId } from "../../server/contracts/wire";

export type { MasteryGoals, MasteryBar, MasteryBarSegment } from "../../server/contracts/mastery";
export {
  COOLDOWN_MS_BY_CATEGORY,
  lastCorrectMarkTimestamp,
  lastCorrectOnBar,
  barReadyAt,
  barCooldownRemainingMs,
  isBarOnCooldown,
  isMarkOnCooldown,
} from "../../server/contracts/cooldown";
export type { MasteryWorldId } from "../../server/contracts/wire";
export {
  PBH_FULL,
  PBH_BAND,
  PBH_MAX_TERM_CAP,
  PBH_THRESHOLDS,
  positiveCount,
  positivesByType,
  writingMasteryFromChars,
  WORLD_MARK_TYPES,
  worldForMarkType,
  activeWorlds,
  isWorldActive,
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
 * How much of a mastery bar is filled, 0..1: `pbh / PBH_FULL`, clamped — the length BOTH
 * mastery surfaces draw as one continuous track.
 *
 * The bars were `PBH_FULL` discrete cells (one per mark, `masteryWindowCells`) until
 * 2026-11-23, when the owner replaced them with a single long fill on both surfaces.
 * pbh is still a count, not a percentage; the fraction is only where the fill ends. A
 * fractional core pbh (the know blend) is drawn exactly, not rounded, so two genuinely
 * different cards never read the same.
 *
 * Consumers: `src/features/deckTower/cardView/TowerMasteryPanel.tsx` (the card view's raised bar) and
 * `src/components/MiniCard.tsx` → `MasteryStrip` (the thumbnail strip).
 * See docs/MASTERY_REWORK.md § "cdp — the mastery bar" and § "Mini cards — the mastery strip".
 */
export function masteryFillFraction(bar: MasteryBar): number {
  return Math.min(1, Math.max(0, bar.pbh / PBH_FULL_VALUE));
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
 * #FF8E47) were outside the palette; they are now the MARK tier of the skill's hue, so a
 * skill dot and a mastery cell are drawn from one register.
 *
 * 2026-10-02: only the two PUBLIC skills own a hue — reading GREEN, writing PURPLE
 * (chosen with the since-deleted Reading / Writing Centers; they were red / orange).
 * Recognition and production are no longer learner-facing concepts (they are the two
 * halves of the "know" bar), so they deliberately own NO hue: they take the neutral mid
 * grey. Anything still naming them to the learner is a leftover.
 */
export const MARK_TYPE_COLORS: Record<MarkType, string> = {
  recognition: COLORS.greyA,
  production: COLORS.greyA,
  reading: COLORS.grnMk,
  writing: COLORS.purMk,
};

/**
 * The "cooldown elapsed, this track is markable now" check icon. v2 draws it
 * `var(--success)`, which is ink — the check glyph says "ready" by its shape. Kept as a
 * named constant so the mastery surfaces agree on it.
 */
export const MASTERY_READY_COLOR = COLORS.successInk;

/**
 * User-facing names for the three mastery bars (migration 143).
 *
 * The core bar is called "Know" rather than "Core": the learner never sees the word
 * "core" anywhere else, and what the bar actually measures is whether they know the
 * word — recognition plus production — as opposed to reading or writing it.
 */
export const WORLD_LABELS: Record<MasteryWorldId, string> = {
  core: "Know",
  reading: "Read",
  writing: "Write",
};

// NOTE: both mastery surfaces — the cdp bar and the mini-card strip — colour their fill
// by the track's utcm BAND (`getBandMark`, categoryColors.ts), not by these per-type
// colours; the fill's LENGTH is `masteryFillFraction`. See docs/MASTERY_REWORK.md
// § "Mini cards — the mastery strip".
//
// A Mastered COLLECTION needs one colour per bar; that lives in MASTERY_BAR_COLORS
// (src/utils/categoryColors.ts) beside the other tile palettes.
