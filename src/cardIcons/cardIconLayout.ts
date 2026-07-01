// Geometry + small helpers for the custom flashcard icon layout (the "edit" mode on
// the flp back face). See docs/CARD_ICON_LAYOUT.md.
//
// Layout coordinates are NORMALIZED to the card: x,y are the icon CENTER as a
// fraction of card width/height, and the on-screen icon box width is
// BASE_ICON_FRAC * scale as a fraction of the card WIDTH. Because every dimension is
// expressed as a percentage of the card, the rendering layer needs no pixel
// measurement — it just maps each item to CSS percentages. The edit canvas does need
// the card's pixel rect to convert drag/pinch deltas back into fractions.

import type { CSSProperties } from "react";
import type { IconLayoutItem, VocabEntry } from "../types";
import { API_BASE_URL } from "../constants";

/** Base icon box as a fraction of card width (before per-icon scale). */
export const BASE_ICON_FRAC = 0.28;

/** Per-icon scale clamp (mirrors the server's validateIconLayout). Max is 5 so a
 *  maximized icon is ~1.4× the card width (BASE_ICON_FRAC × 5 ≈ 1.4 — bumped up from
 *  the earlier 4.5 ≈ 1.26× per design). */
export const SCALE_MIN = 0.25;
export const SCALE_MAX = 5;

/** Default placement of the seeded single icon: horizontally centered, ~1/3 down from the
 *  top of the card. Both coordinates sit EXACTLY on the move-snap grid so toggling snap-move
 *  never nudges a default icon (matching the grid-aligned default text — see cardTextLayout.ts):
 *   - x = 0.5 = 10 × SNAP_MOVE_STEP_FRAC (card center).
 *   - y = 10 × (SNAP_MOVE_STEP_FRAC × CARD_ASPECT) ≈ 0.34624 — grid step 10, which is exactly
 *     where the legacy 0.3333 snapped to. Written as the explicit grid product (0.05 and 295/426
 *     ARE SNAP_MOVE_STEP_FRAC and CARD_ASPECT, defined lower in this file; kept in sync). */
export const DEFAULT_ICON_X = 0.5;
export const DEFAULT_ICON_Y = 10 * (0.05 * (295 / 426));

/** Default per-icon scale for a freshly seeded / swapped / spawned icon. 1.25 = the
 *  default icon renders 25% larger than the base box (basic-mode display and icons
 *  spawned into advanced mode both start here). 1.25 is chosen so the default lands
 *  EXACTLY on the size-snap grid: BASE_ICON_FRAC·1.25 = 0.28·1.25 = 0.35 = 7 × the
 *  0.05 SNAP_SIZE_STEP_FRAC, so toggling size-snap on never nudges a default icon.
 *  Existing saved layouts keep their own stored scale; only newly created items use this. */
export const DEFAULT_ICON_SCALE = 1.25;

/** Scales that count as a "default placement" for the basic-vs-advanced inference: the
 *  current default (1.25) plus legacy basic-save defaults (1.2 before the size-snap
 *  alignment, 1.0 before the 20%-larger bump). A single icon at default x/y with one of
 *  these scales (no rotation/flip) reads back as basic, so pre-existing basic-saved cards
 *  keep opening in basic mode. Kept here as the single source of truth; the server mirror
 *  in `server/dal/shared/advancedLayout.ts` re-lists these values and must stay in sync. */
export const DEFAULT_PLACEMENT_SCALES = [DEFAULT_ICON_SCALE, 1.2, 1] as const;

/** Y centers that count as a "default placement" for the basic-vs-advanced inference: the
 *  current grid-aligned default (≈0.34624) PLUS the legacy 0.3333 that basic "change icon"
 *  swaps wrote before the grid alignment. Accepting both keeps pre-existing basic-saved cards
 *  opening in basic mode (and out of the Community feed). Single source of truth; the server
 *  mirror in `server/dal/shared/advancedLayout.ts` re-lists these and must stay in sync. */
export const DEFAULT_PLACEMENT_YS = [DEFAULT_ICON_Y, 0.3333] as const;

/** Our cached-icon image endpoint (transparent SVG/PNG bytes from our DB). */
export const iconImageUrl = (id: string) =>
  `${API_BASE_URL}/api/icons8/${encodeURIComponent(id)}/image`;

/**
 * icons8's public by-id CDN preview, used for un-cached search results in the add
 * dialog (we only download+cache to our own DB on select). Public, no token.
 */
export const iconCdnPreviewUrl = (id: string) =>
  `https://img.icons8.com/?id=${encodeURIComponent(id)}&format=png&size=96`;

/**
 * The single default-placed icon layout for a given icon id (centered upper-third,
 * default scale). Shared by the edit-mode seed AND the non-editing default render, so
 * the default icon displays at IDENTICAL geometry whether or not the editor is open.
 */
export function defaultLayoutForIcon(iconId: string): IconLayoutItem[] {
  return [{ iconId, x: DEFAULT_ICON_X, y: DEFAULT_ICON_Y, scale: DEFAULT_ICON_SCALE, rotation: 0, z: 0 }];
}

/**
 * Seed layout when a card has no custom arrangement yet: the entry's default det icon
 * at the central default spot (empty when the entry has no icon at all).
 */
export function defaultLayoutForEntry(entry: VocabEntry): IconLayoutItem[] {
  if (!entry.iconId) return [];
  return defaultLayoutForIcon(entry.iconId);
}

/**
 * CSS for one placed icon, positioned by its center via percentages of the card box.
 * The icon box is square (aspect-ratio 1); width is a % of the card width.
 *
 * `includeFlip` controls whether the horizontal mirror (scaleX(-1) for flipX) is baked
 * into this transform. The read-only layer puts this style on the <img> itself, so it
 * wants the flip here (default true). The editor canvas instead puts this on a WRAPPER
 * box that also carries the resize/rotate handle; flipping that box would drag the
 * handle to the opposite side, so the canvas passes false and mirrors the inner <img>
 * separately (see iconFlipTransform).
 */
export function iconItemStyle(item: IconLayoutItem, includeFlip = true): CSSProperties {
  const flip = includeFlip && item.flipX ? " scaleX(-1)" : "";
  return {
    position: "absolute",
    left: `${item.x * 100}%`,
    top: `${item.y * 100}%`,
    width: `${BASE_ICON_FRAC * item.scale * 100}%`,
    aspectRatio: "1 / 1",
    // Order matters: rotate first, then mirror, so a mirrored icon reflects across the
    // card's vertical axis as the user sees it (scaleX(-1) when flipX is set).
    transform: `translate(-50%, -50%) rotate(${item.rotation}deg)${flip}`,
    // Each icon's z drives paint order within the layer.
    zIndex: item.z,
  };
}

/** Horizontal-mirror transform for a placed icon, applied to the inner <img> in the
 *  editor canvas so the wrapper box (and its resize/rotate handle) is NOT flipped. */
export const iconFlipTransform = (item: IconLayoutItem) =>
  item.flipX ? "scaleX(-1)" : "none";

/**
 * Whether a single placed icon sits at the canonical default placement (centered in the
 * upper third, unscaled, unrotated). The basic-mode "change icon" swap always writes
 * exactly this, so it's the signature of a basic-saved layout.
 */
export function isDefaultPlacement(it: IconLayoutItem): boolean {
  // Accept the current default scale OR the legacy ones (see DEFAULT_PLACEMENT_SCALES),
  // so pre-existing basic-saved cards still open in basic mode.
  const defaultScale = (DEFAULT_PLACEMENT_SCALES as readonly number[]).includes(it.scale);
  // Accept the current grid-aligned default Y OR the legacy 0.3333 (see DEFAULT_PLACEMENT_YS).
  const defaultY = (DEFAULT_PLACEMENT_YS as readonly number[]).includes(it.y);
  return (
    defaultScale &&
    it.rotation === 0 &&
    !it.flipX &&
    it.x === DEFAULT_ICON_X &&
    defaultY
  );
}

/**
 * Whether a draft is the plain default arrangement (a single default-placed icon that IS
 * the entry's default det icon) — i.e. nothing a "reset to default" would change. Used to
 * grey out the reset button when there's no custom design to clear. A layout with a
 * different iconId, a moved/resized/rotated/mirrored icon, or multiple icons is NOT plain
 * default.
 */
export function isPlainDefaultLayout(
  layout: IconLayoutItem[] | null | undefined,
  defaultIconId: string | null | undefined,
): boolean {
  if (!layout || layout.length !== 1) return false;
  const it = layout[0];
  return it.iconId === defaultIconId && isDefaultPlacement(it);
}

/** The eight alignment directions the toolbar's align dropdown offers — the four cardinals
 *  plus the four 45° diagonals. Mirrors `AlignDirection` in `CardEditToolbar.tsx`. */
export type AlignDirection =
  | "up"
  | "up-right"
  | "right"
  | "down-right"
  | "down"
  | "down-left"
  | "left"
  | "up-left";

/** Map an alignment direction to an absolute rotation (degrees, clockwise from upright). Used
 *  by the advanced toolbar's alignment dropdown to snap the selected icon's orientation. The
 *  value doubles as the angle to spin an upward-pointing arrow glyph so it points that way, so
 *  the dropdown's grid arrows are generated straight from this map. */
export const ALIGN_ROTATION: Record<AlignDirection, number> = {
  up: 0,
  "up-right": 45,
  right: 90,
  "down-right": 135,
  down: 180,
  "down-left": 225,
  left: -90,
  "up-left": -45,
};

/**
 * Whether a saved layout should open the editor straight into ADVANCED mode: any
 * arrangement that isn't a single default-placed icon — i.e. multiple icons, or one
 * icon that has been moved / resized / rotated. Lets us distinguish basic-saved from
 * advanced-saved layouts without storing an explicit mode flag.
 */
export function isAdvancedLayout(layout: IconLayoutItem[] | null | undefined): boolean {
  if (!layout || layout.length === 0) return false;
  if (layout.length > 1) return true;
  return !isDefaultPlacement(layout[0]);
}

/** Clamp a scale into the allowed range. A non-finite input (NaN/±Infinity — e.g.
 *  a degenerate pinch frame where the finger distance was 0/undefined) is coerced
 *  to the default scale rather than passed through: Math.min/Math.max do NOT filter
 *  NaN, so without this a bad gesture frame could write `scale: NaN` into the layout
 *  (icon renders at width "NaN%" → vanishes) and even get saved, permanently
 *  breaking the card. */
export const clampScale = (s: number) =>
  Number.isFinite(s) ? Math.min(Math.max(s, SCALE_MIN), SCALE_MAX) : DEFAULT_ICON_SCALE;

/** Sanitize a rotation (degrees): a non-finite value falls back to 0. Same NaN
 *  concern as clampScale — a bad pinch/handle frame must never persist NaN. */
export const sanitizeRotation = (deg: number) => (Number.isFinite(deg) ? deg : 0);

// ── Snap-to-increment helpers (the toolbar's "snap" toggles) ──────────────────────────
// The editor's snap dropdown offers three independent toggles — move / rotate / resize —
// each quantizing its operation to a discrete increment. When a toggle is turned on the
// page snaps every icon for that property once (so existing placements jump onto the grid)
// and the canvas keeps future gestures snapped while it stays on. See docs/CARD_ICON_LAYOUT.md.

/** Card aspect ratio (width / height), fixed by the flashcard frame (the CardAspectWrapper
 *  in FlashCardSection.tsx uses `aspectRatio: 295 / 426`). The move grid is square in
 *  PHYSICAL units (5% of the card WIDTH on both axes), but `y` is a fraction of card HEIGHT,
 *  so the y-step is the width-step scaled by this ratio. Keeping it a constant lets the snap
 *  math run on the page (no canvas pixel rect needed) since the card's aspect never varies. */
export const CARD_ASPECT = 295 / 426;

/** Move grid spacing as a fraction of card WIDTH (icon CENTER snaps to this grid). */
export const SNAP_MOVE_STEP_FRAC = 0.05;
/** Resize step: the rendered icon SIZE (BASE_ICON_FRAC·scale of card width) snaps to a
 *  multiple of this fraction of card WIDTH. */
export const SNAP_SIZE_STEP_FRAC = 0.05;
/** Rotation snaps to the nearest multiple of this angle (degrees). 360 / 22.5 = 16 steps. */
export const SNAP_ROTATION_DEG = 22.5;

/** Round a value to the nearest multiple of `step`. */
const roundToStep = (v: number, step: number) => Math.round(v / step) * step;

/** Snap an icon center (`x`,`y`, normalized to card width/height) onto the move grid. The
 *  grid is square in pixels: x uses a 5%-of-width step, y uses the same physical step
 *  expressed in height fractions (× CARD_ASPECT). */
export function snapCenterToGrid(x: number, y: number): { x: number; y: number } {
  return {
    x: roundToStep(x, SNAP_MOVE_STEP_FRAC),
    y: roundToStep(y, SNAP_MOVE_STEP_FRAC * CARD_ASPECT),
  };
}

/** Snap a `scale` so the rendered icon size (BASE_ICON_FRAC·scale of card width) lands on a
 *  5%-of-card-width step. Never snaps below one step; result is clamped to the scale range. */
export function snapScaleToStep(scale: number): number {
  const size = BASE_ICON_FRAC * scale; // current icon width as a fraction of card width
  const snappedSize = Math.max(SNAP_SIZE_STEP_FRAC, roundToStep(size, SNAP_SIZE_STEP_FRAC));
  return clampScale(snappedSize / BASE_ICON_FRAC);
}

/** Snap a rotation (degrees) to the nearest 22.5° increment. */
export function snapRotation(rotation: number): number {
  return roundToStep(rotation, SNAP_ROTATION_DEG);
}

// ── Fine "Shift" nudge helpers (the toolbar's Shift menu step controls) ────────────────
// The Shift menu nudges the selected icon by one step per tap. Each control's step size
// depends on whether the matching snap toggle is ON: a snap-on control steps by exactly one
// snap unit (and re-lands on the snap grid); a snap-off control makes a fine 1px-ish nudge.
// See docs/CARD_ICON_LAYOUT.md.

/** Nominal DESIGN pixel size of the card (the CardAspectWrapper renders at aspectRatio
 *  295/426). The page-level Shift handlers carry no absolute pixel rect, so a "1px" nudge
 *  is reckoned against these design dimensions — consistent with CARD_ASPECT being the
 *  canonical card shape used by the snap math. */
export const CARD_DESIGN_WIDTH = 295;
export const CARD_DESIGN_HEIGHT = 426;

/** Snap-OFF Shift step magnitudes (one tap = one step). Move/size are in design px;
 *  rotation is in degrees. */
export const NUDGE_MOVE_PX = 1;
export const NUDGE_ROTATE_DEG = 1;
export const NUDGE_SIZE_PX = 1;

/** One-step cardinal nudge of an icon center (normalized coords). Grid snap ON → step by
 *  one move-grid cell and re-land on the grid; OFF → step by NUDGE_MOVE_PX design px
 *  (converted to width/height fractions). */
export function nudgeCenter(
  item: Pick<IconLayoutItem, "x" | "y">,
  dir: "up" | "down" | "left" | "right",
  gridSnap: boolean,
): { x: number; y: number } {
  const stepX = gridSnap ? SNAP_MOVE_STEP_FRAC : NUDGE_MOVE_PX / CARD_DESIGN_WIDTH;
  const stepY = gridSnap ? SNAP_MOVE_STEP_FRAC * CARD_ASPECT : NUDGE_MOVE_PX / CARD_DESIGN_HEIGHT;
  let { x, y } = item;
  if (dir === "left") x -= stepX;
  if (dir === "right") x += stepX;
  if (dir === "up") y -= stepY;
  if (dir === "down") y += stepY;
  // When snapping, re-quantize so the result lands exactly on the grid regardless of any
  // prior off-grid drift.
  return gridSnap ? snapCenterToGrid(x, y) : { x, y };
}

/** One-step rotation nudge. Rotate snap ON → ±22.5° (one snap unit, re-snapped); OFF →
 *  ±NUDGE_ROTATE_DEG. `ccw` rotates counter-clockwise (negative degrees). */
export function nudgeRotationStep(rotation: number, ccw: boolean, rotateSnap: boolean): number {
  const step = rotateSnap ? SNAP_ROTATION_DEG : NUDGE_ROTATE_DEG;
  const next = rotation + (ccw ? -step : step);
  return rotateSnap ? snapRotation(next) : next;
}

/** One-step size nudge (changes the rendered icon SIZE, then back-solves the scale). Size
 *  snap ON → ±5%-of-width (one snap unit, re-snapped); OFF → ±NUDGE_SIZE_PX design px.
 *  Result clamped to the scale range. */
export function nudgeScaleStep(scale: number, increase: boolean, sizeSnap: boolean): number {
  const sizeStep = sizeSnap ? SNAP_SIZE_STEP_FRAC : NUDGE_SIZE_PX / CARD_DESIGN_WIDTH;
  const curSize = BASE_ICON_FRAC * scale; // icon width as fraction of card width
  const nextSize = curSize + (increase ? sizeStep : -sizeStep);
  const nextScale = clampScale(nextSize / BASE_ICON_FRAC);
  return sizeSnap ? snapScaleToStep(nextScale) : nextScale;
}

const clampRange = (v: number, lo: number, hi: number) => Math.min(Math.max(v, lo), hi);

/**
 * Minimum slice of an ICON that must stay on the card after a drag, expressed as a
 * fraction of the icon's own size. Icons dragged farther off-card are pulled back to
 * this edge so a grabbable sliver always remains (replaces the old drag-off-to-delete).
 */
export const MIN_ON_CARD_FRAC = 0.15;

/**
 * Clamp an icon's center (`x`,`y`, normalized to card width/height) so that at least
 * `minVisible` of the ICON'S OWN size stays on the card in BOTH axes.
 *
 * Icons are square in pixels (aspect-ratio 1, width = BASE_ICON_FRAC*scale of the card
 * width), but `x` is a fraction of card width while `y` is a fraction of card height.
 * Because the threshold is icon-relative it's the same `minVisible` on each axis; we
 * just express the icon's half-size in each axis's own units — width fractions for x,
 * and height fractions for y via the card's aspect ratio (`rect.width / rect.height`).
 * `rect` is the canvas pixel rect.
 *
 * For an icon of half-size `h` (in an axis's fractions) and visible fraction `f`, the
 * center bound on that axis is `[(2f-1)·h, 1-(2f-1)·h]` (keep `f` of the icon on-card).
 */
export function clampIconCenter(
  item: Pick<IconLayoutItem, "x" | "y" | "scale">,
  rect: { width: number; height: number },
  minVisible = MIN_ON_CARD_FRAC,
): { x: number; y: number } {
  // Half the icon box as a fraction of card width (icons are square in px).
  const halfW = (BASE_ICON_FRAC * item.scale) / 2;
  // Convert that half-size into card-HEIGHT fractions for the vertical axis.
  const ratio = rect.height > 0 ? rect.width / rect.height : 1;
  const halfH = halfW * ratio;
  // How far the center may pass an edge while still keeping `minVisible` of the icon
  // on-card: at the edge, `(2·minVisible − 1)` of the half-size pokes inward.
  const overhang = 2 * minVisible - 1;
  const x = clampRange(item.x, overhang * halfW, 1 - overhang * halfW);
  const y = clampRange(item.y, overhang * halfH, 1 - overhang * halfH);
  return { x, y };
}

/** Highest z in a layout (so selection can bring an icon to the front: max + 1). */
export const maxZ = (layout: IconLayoutItem[]) =>
  layout.reduce((m, it) => Math.max(m, it.z), -1);
