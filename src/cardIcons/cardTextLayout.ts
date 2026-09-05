// Geometry + small helpers for MOVABLE TEXT on the flp back face (the two text blocks —
// the foreign word and the English definition — that the advanced fie editor lets a learner
// drag / resize / rotate just like icons). See docs/CARD_ICON_LAYOUT.md "Movable text".
//
// Like the icon layout, text coordinates are NORMALIZED to the card: x,y are the block
// CENTER as a fraction of card width/height, `scale` multiplies the block's base font size,
// and `rotation` is in degrees. There is no iconId/flipX/z (text always paints ABOVE the
// icon layer, and the two blocks keep a fixed paint order).

import type { TextBlock, TextLayout, TextLayoutItem } from "../types";
import { SNAP_MOVE_STEP_FRAC, CARD_ASPECT } from "./cardIconLayout";

/** Per-block font-scale clamp. The floor keeps text from shrinking to unreadable (the
 *  "resize floor" requirement); the ceiling keeps a single block from swallowing the card. */
export const TEXT_SCALE_MIN = 0.5;
export const TEXT_SCALE_MAX = 3;

/**
 * The move-snap grid in each axis: x snaps to multiples of SNAP_MOVE_STEP_FRAC (5% of card
 * width); y snaps to multiples of SNAP_MOVE_STEP_FRAC·CARD_ASPECT (the same physical 5%-of-
 * width step expressed in HEIGHT fractions, since the grid is square in pixels). These mirror
 * snapCenterToGrid in cardIconLayout. The default centers below are exact integer multiples of
 * these steps, so a default-positioned block sits EXACTLY on the grid — toggling snap-move on
 * never nudges it. (scale 1 and rotation 0 are likewise already on the size/rotate grids.)
 */
const GRID_X = SNAP_MOVE_STEP_FRAC;                 // 0.05  (width fraction)
const GRID_Y = SNAP_MOVE_STEP_FRAC * CARD_ASPECT;   // 0.05 × 295/426 ≈ 0.034624 (height fraction)

/**
 * Default block centers — grid-aligned so the default text sits perfectly on the move-snap
 * grid (the same default for the flp display AND the fie seed). x = 10 steps = 0.5 (card
 * center). y = integer grid steps in the lower third: foreign at step 18 (≈0.623), english at
 * step 22 (≈0.762). The wide-ish separation is deliberate: unlike the old flex column these
 * centers are FIXED (they can't grow to fit), so the gap must clear a multi-line English
 * definition without overlapping the foreign word above it. Built FROM the grid constants (not
 * hand-typed decimals) so snapCenterToGrid is an exact no-op on them. */
export const DEFAULT_TEXT_CENTER: Record<TextBlock, { x: number; y: number }> = {
  foreign: { x: 10 * GRID_X, y: 18 * GRID_Y },
  english: { x: 10 * GRID_X, y: 22 * GRID_Y },
};

/** A freshly-seeded block: its default center, unscaled, unrotated, unlocked. */
export function defaultTextItem(block: TextBlock): TextLayoutItem {
  return { x: DEFAULT_TEXT_CENTER[block].x, y: DEFAULT_TEXT_CENTER[block].y, scale: 1, rotation: 0 };
}

/** The default placement for BOTH blocks — the editor's seed when a card has no saved
 *  textLayout (or for a block missing from a partial saved layout). */
export function defaultTextLayout(): Required<Pick<TextLayout, TextBlock>> {
  return { foreign: defaultTextItem("foreign"), english: defaultTextItem("english") };
}

/** Resolve a saved (possibly partial / null) textLayout into a full both-blocks layout,
 *  filling any absent block with its default. Used to seed the editor draft and to render. */
export function resolveTextLayout(saved: TextLayout | null | undefined): { foreign: TextLayoutItem; english: TextLayoutItem } {
  return {
    foreign: saved?.foreign ?? defaultTextItem("foreign"),
    english: saved?.english ?? defaultTextItem("english"),
  };
}

/** Clamp a text block's font scale into the readable range. Non-finite (a degenerate pinch
 *  frame) falls back to 1, mirroring clampScale's NaN guard for icons. */
export const clampTextScale = (s: number) =>
  Number.isFinite(s) ? Math.min(Math.max(s, TEXT_SCALE_MIN), TEXT_SCALE_MAX) : 1;

/** Sanitize a text rotation (degrees): non-finite falls back to 0. */
export const sanitizeTextRotation = (deg: number) => (Number.isFinite(deg) ? deg : 0);

/** Text font-scale snap step (the "resize" snap toggle quantizes the block scale to this
 *  increment). 0.1 = a clean 10%-of-base step that keeps text on tidy round sizes. */
export const SNAP_TEXT_SCALE_STEP = 0.1;
/** Snap-OFF Shift-pad fine nudge for text scale (one tap), and the cardinal/rotate fine
 *  nudges reuse the icon helpers (generic on fractions / degrees). */
export const NUDGE_TEXT_SCALE = 0.05;

/** Snap a text block's font scale to the nearest SNAP_TEXT_SCALE_STEP (clamped, never below
 *  one step). Mirrors snapScaleToStep but operates on the scale multiplier directly (text has
 *  no BASE_ICON_FRAC box). */
export function snapTextScale(scale: number): number {
  const snapped = Math.max(SNAP_TEXT_SCALE_STEP, Math.round(scale / SNAP_TEXT_SCALE_STEP) * SNAP_TEXT_SCALE_STEP);
  return clampTextScale(snapped);
}

/** One-step font-scale nudge for the Shift pad. Snap ON → ±one snap step (re-snapped); OFF →
 *  ±NUDGE_TEXT_SCALE. Clamped to the readable range. */
export function nudgeTextScale(scale: number, increase: boolean, sizeSnap: boolean): number {
  const step = sizeSnap ? SNAP_TEXT_SCALE_STEP : NUDGE_TEXT_SCALE;
  const next = clampTextScale(scale + (increase ? step : -step));
  return sizeSnap ? snapTextScale(next) : next;
}

const clampRange = (v: number, lo: number, hi: number) => Math.min(Math.max(v, lo), hi);

/**
 * Clamp a text block's center so the WHOLE block stays on the card (the "text may never be
 * even partially off-card" rule — stricter than the icon 15%-overhang clamp). `halfWFrac` /
 * `halfHFrac` are the block's axis-aligned bounding-box HALF-extents as fractions of card
 * width / height (the caller measures the rendered, scaled, rotated box and converts px →
 * fractions). When a block is wider/taller than the card on an axis the bound collapses to the
 * card center (0.5), so it's centered rather than thrown off one side.
 */
export function clampTextCenterFully(
  x: number,
  y: number,
  halfWFrac: number,
  halfHFrac: number,
): { x: number; y: number } {
  const cx = halfWFrac >= 0.5 ? 0.5 : clampRange(x, halfWFrac, 1 - halfWFrac);
  const cy = halfHFrac >= 0.5 ? 0.5 : clampRange(y, halfHFrac, 1 - halfHFrac);
  return { x: cx, y: cy };
}

/**
 * The two ordered block keys (foreign first → painted BELOW english, since english is
 * rendered later). Single source of truth for iterating the blocks in both the canvas and
 * the static renderer.
 */
export const TEXT_BLOCKS: TextBlock[] = ["foreign", "english"];

/**
 * Whether a saved textLayout differs from the default in any way (any block present). Drives
 * auto-opening ADVANCED mode on enter (a card whose text has been moved must open advanced so
 * the canvas can show/edit it — basic mode has no canvas). A null/empty layout is default.
 */
export function hasCustomTextLayout(saved: TextLayout | null | undefined): boolean {
  return !!saved && (!!saved.foreign || !!saved.english);
}

/** CSS transform for a placed text block, positioned by its center via percentages of the
 *  card box (matches iconItemStyle's translate→rotate order, plus the font scale). */
export function textItemTransform(item: TextLayoutItem): string {
  return `translate(-50%, -50%) rotate(${item.rotation}deg) scale(${item.scale})`;
}

/**
 * Transform for the DEFAULT (unsaved) English block in the BASIC static render only —
 * anchored by its TOP edge instead of its center, so a multi-line definition grows downward
 * only instead of reserving symmetric headroom above DEFAULT_TEXT_CENTER.english for upward
 * growth too. Deliberately scoped to that one case:
 *   - The advanced fie editor (CardIconCanvas) and any block with a SAVED/custom textLayout
 *     keep textItemTransform's center anchor unchanged — a saved position was captured in
 *     center coordinates while dragging, and rotating/resizing around a top edge reads oddly.
 *   - The Chinese (foreign) block is unaffected either way.
 * Scale/rotation are threaded through for consistency with textItemTransform, though a true
 * default item is always scale 1 / rotation 0.
 */
export function defaultEnglishTopAnchorTransform(item: TextLayoutItem): string {
  return `translate(-50%, 0%) rotate(${item.rotation}deg) scale(${item.scale})`;
}

/** A measured on-screen placement for one or both text blocks, as card-normalized centers. */
export type MeasuredTextCenters = Partial<Record<TextBlock, { x: number; y: number }>>;

/**
 * How close a measured center has to be to the default before we treat it AS the default
 * (≈1.7px on a 426px-tall card). Without this a measurement that rounds a hair off the
 * default would make an untouched block count as "custom" (isDefaultTextItem is an exact
 * comparison), so merely opening and saving the editor would persist a textLayout for a card
 * that has none.
 */
const MEASURED_CENTER_EPSILON = 0.004;

/**
 * Measure where each text block is ACTUALLY drawn on the basic (non-editing) card, as a
 * center normalized to the card's own box — the exact coordinate space the fie canvas
 * positions blocks in. Used when entering the advanced editor to seed any block that has no
 * saved placement, so opening the canvas never makes the text jump.
 *
 * Why measure instead of reusing DEFAULT_TEXT_CENTER: the basic renderer's box for a block is
 * not always centered on that constant. The English block is TOP-anchored while it is at its
 * default (defaultEnglishTopAnchorTransform), so its real center depends on the definition's
 * line count; and either block's box can differ from the canvas's idea of it whenever the two
 * renderers wrap or pad the same content differently. Neither is derivable from data — it
 * takes a real DOM read. Measuring BOTH blocks (rather than special-casing English) means the
 * editor opens on whatever the learner was just looking at, whatever caused the difference.
 *
 * Measures the block WRAPPER (`.mobile-demo-flashcard-text-block--<block>`), which is the same
 * element the canvas re-creates, so the correspondence is 1:1.
 *
 * @param cardContainer the element whose box IS the card face (the flp card, the cdp hero)
 * @returns a center per block that could be measured; blocks that aren't mounted are omitted,
 *          so the caller falls back to the plain default.
 */
export function measureDefaultTextCenters(cardContainer: HTMLElement): MeasuredTextCenters {
  const cardRect = cardContainer.getBoundingClientRect();
  if (cardRect.width <= 0 || cardRect.height <= 0) return {};
  const out: MeasuredTextCenters = {};
  for (const block of TEXT_BLOCKS) {
    const el = cardContainer.querySelector<HTMLElement>(`.mobile-demo-flashcard-text-block--${block}`);
    if (!el) continue;
    const r = el.getBoundingClientRect();
    if (r.width <= 0 || r.height <= 0) continue;
    const def = DEFAULT_TEXT_CENTER[block];
    const x = (r.left - cardRect.left + r.width / 2) / cardRect.width;
    const y = (r.top - cardRect.top + r.height / 2) / cardRect.height;
    out[block] = {
      x: Math.abs(x - def.x) < MEASURED_CENTER_EPSILON ? def.x : x,
      y: Math.abs(y - def.y) < MEASURED_CENTER_EPSILON ? def.y : y,
    };
  }
  return out;
}

/** Whether a text block sits at its untouched default placement (default center, scale 1,
 *  no rotation, unlocked). A block that IS default is omitted from the saved layout so a
 *  default card stores NULL. */
export function isDefaultTextItem(item: TextLayoutItem, block: TextBlock): boolean {
  const def = DEFAULT_TEXT_CENTER[block];
  return item.x === def.x && item.y === def.y && item.scale === 1 && item.rotation === 0 && !item.locked;
}

/**
 * Normalize the editor's both-blocks draft into a saveable TextLayout: only blocks that
 * differ from their default are kept; if neither differs, returns null (store a default card
 * as NULL). Mirrors how snapConfig/textColors collapse to null when untouched.
 */
export function textLayoutForSave(draft: { foreign: TextLayoutItem; english: TextLayoutItem }): TextLayout | null {
  const out: TextLayout = {};
  if (!isDefaultTextItem(draft.foreign, "foreign")) out.foreign = draft.foreign;
  if (!isDefaultTextItem(draft.english, "english")) out.english = draft.english;
  return out.foreign || out.english ? out : null;
}
