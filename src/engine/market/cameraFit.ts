import { TILE_WIDTH, TILE_HEIGHT, isoToScreen, type CellWindow } from './isometric';

/**
 * cameraFit — derive a camera's ZOOM-OUT floor from how big the rendered world actually is.
 *
 * LAYER: engine (pure math, no React/Pixi). Consumed by the pan/zoom hosts
 * {@link ../../features/nightmarket/MarketEngineViewer} (nmp) and
 * {@link ../../features/nightmarket/TemplateSandboxViewer} (nms).
 *
 * WHY: both surfaces hard-coded a crisp zoom floor (nmp 0.5, nms 1) chosen when a world was one
 * origin hub. As templates tile outward the continent grows without bound, and at a fixed floor a
 * large market can no longer fit on screen at all. So the floor becomes `min(crispFloor,
 * fitZoom)`: small worlds behave exactly as before, and a world that has outgrown the crisp floor
 * may keep pulling back — continuously (fractional, resampled/blurrier art) — until its full
 * footprint bbox fits the viewport.
 *
 * The zoom-IN cap is deliberately NOT derived here; it is a legibility choice, not a size one.
 *
 * The same bbox drives two derived quantities, in a deliberate one-way order:
 *
 *   placements → footprintScreenBounds → computeMinZoom  (the zoom-out floor)
 *                                     → clampPan         (the pan limits)
 *
 * ⚠️ INVARIANT: the bbox is built from TEMPLATE PLACEMENTS ONLY — never from the default ground the
 * terrain layer pads around them. Feeding that back in would enlarge the pannable area, which would
 * demand more ground, which would enlarge it again: an unbounded loop. Placements in, camera limits
 * out; the ground is downstream of the camera and never upstream of it.
 */

/** A template placement reduced to its board rectangle in GLOBAL cell space. */
export interface CellFootprint {
  offsetCol: number;
  offsetRow: number;
  width: number;
  height: number;
}

/** An axis-aligned box in unscaled camera-local screen pixels (origin cell = (0,0)). */
export interface ScreenBounds {
  minX: number;
  maxX: number;
  minY: number;
  maxY: number;
}

/**
 * Extra headroom (unscaled px) added ABOVE the terrain bbox. Ground tiles are anchored at their
 * diamond, but the tall decor drawn on top of them (houses, trees, dirt slabs) extends well up the
 * screen; without this the topmost buildings would be cropped at the fitted zoom.
 */
const TALL_SPRITE_HEADROOM = 96;

/** Fraction of the viewport the fitted world is allowed to occupy — leaves a visual margin. */
const VIEWPORT_FILL = 0.9;

/** Never pull back past this, whatever the world size — at some point the art is pure mush. */
export const ABSOLUTE_MIN_ZOOM = 0.05;

/**
 * Screen-space bbox of a set of cell rectangles, in unscaled camera-local pixels.
 *
 * `isoToScreen` is linear (`x = (c − r)·W/2`, `y = −(c + r)·H/2`), so each rectangle's screen
 * extremes fall on its four corner cells: max X at (maxCol, minRow), min X at (minCol, maxRow),
 * min Y (top) at (maxCol, maxRow), max Y (bottom) at (minCol, minRow). Half a tile is added on
 * each side because a cell's sprite is a diamond centred on that point.
 *
 * @returns null when there is nothing placed (caller keeps its static floor).
 */
export function footprintScreenBounds(items: CellFootprint[]): ScreenBounds | null {
  if (items.length === 0) return null;

  let minX = Infinity, maxX = -Infinity, minY = Infinity, maxY = -Infinity;
  for (const item of items) {
    // Inclusive last cell of the rectangle (width/height are counts, not indices).
    const minCol = item.offsetCol;
    const minRow = item.offsetRow;
    const maxCol = item.offsetCol + Math.max(0, item.width - 1);
    const maxRow = item.offsetRow + Math.max(0, item.height - 1);

    const east = isoToScreen(maxCol, minRow);   // rightmost point
    const west = isoToScreen(minCol, maxRow);   // leftmost point
    const north = isoToScreen(maxCol, maxRow);  // topmost point (smallest screenY)
    const south = isoToScreen(minCol, minRow);  // bottommost point

    if (west.screenX < minX) minX = west.screenX;
    if (east.screenX > maxX) maxX = east.screenX;
    if (north.screenY < minY) minY = north.screenY;
    if (south.screenY > maxY) maxY = south.screenY;
  }

  return {
    minX: minX - TILE_WIDTH / 2,
    maxX: maxX + TILE_WIDTH / 2,
    minY: minY - TILE_HEIGHT / 2 - TALL_SPRITE_HEADROOM,
    maxY: maxY + TILE_HEIGHT / 2,
  };
}

/**
 * The zoom at which `bounds` just fits inside a `viewportW × viewportH` viewport (with the
 * {@link VIEWPORT_FILL} margin). Returns Infinity for a degenerate/zero viewport so callers fall
 * back to their static floor.
 */
export function fitZoomForBounds(bounds: ScreenBounds, viewportW: number, viewportH: number): number {
  const spanX = bounds.maxX - bounds.minX;
  const spanY = bounds.maxY - bounds.minY;
  if (viewportW <= 0 || viewportH <= 0 || spanX <= 0 || spanY <= 0) return Infinity;
  return Math.min((viewportW * VIEWPORT_FILL) / spanX, (viewportH * VIEWPORT_FILL) / spanY);
}

/**
 * The camera's effective zoom-out floor for a world of `items` in a `viewportW × viewportH`
 * viewport.
 *
 * `crispFloor` is the surface's authored floor (the smallest zoom whose art still resamples
 * acceptably — nmp 0.5, nms 1). The result never EXCEEDS it, so small worlds are unaffected, and
 * never drops below {@link ABSOLUTE_MIN_ZOOM}.
 */
export function computeMinZoom(
  items: CellFootprint[],
  viewportW: number,
  viewportH: number,
  crispFloor: number,
): number {
  const bounds = footprintScreenBounds(items);
  if (!bounds) return crispFloor;
  const fit = fitZoomForBounds(bounds, viewportW, viewportH);
  return Math.max(ABSOLUTE_MIN_ZOOM, Math.min(crispFloor, fit));
}

// ─── Pan clamp ────────────────────────────────────────────────────────────────

export interface Pan {
  x: number;
  y: number;
}

/**
 * Clamp `pan` so the point under the SCREEN CENTRE stays inside the placement bbox.
 *
 * The camera transform both hosts use is `container.x = viewportW/2 + pan.x` with `scale = zoom`,
 * so camera-local `worldX` lands on screen at `viewportW/2 + pan.x + worldX·zoom`. Solving that for
 * the world point sitting at the screen centre (`screenX = viewportW/2`) gives
 *
 *   centreX = −pan.x / zoom          centreY = −pan.y / zoom
 *
 * — the viewport size cancels out entirely. Requiring `minX ≤ centreX ≤ maxX` therefore inverts to a
 * pan interval that needs no viewport at all:
 *
 *   pan.x ∈ [−maxX·zoom, −minX·zoom]      pan.y ∈ [−maxY·zoom, −minY·zoom]
 *
 * Because `minX ≤ maxX` by construction, that interval can never cross — so unlike the previous
 * "bbox must cover the viewport" rule there is no degenerate case to special-case, and no
 * snap-to-centre fallback. The bbox is the set of points the camera may look at, full stop.
 *
 * ⚠️ CONSEQUENCE: at the zoom floor (where the whole world already fits) the centre may still roam
 * the bbox, so the market can be pushed off-centre even while fully visible — the old rule pinned it
 * centred there. That is the intended trade for a rule that is one line of arithmetic per axis and
 * independent of viewport size. Shrink the bbox here if the market should stay closer to centre.
 *
 * @returns the clamped pan (the input object is never mutated), or `pan` unchanged when there is
 *   nothing placed / the zoom is degenerate.
 */
export function clampPan(pan: Pan, items: CellFootprint[], zoom: number): Pan {
  const bounds = footprintScreenBounds(items);
  if (!bounds || zoom <= 0) return pan;

  return {
    x: Math.min(-bounds.minX * zoom, Math.max(-bounds.maxX * zoom, pan.x)),
    y: Math.min(-bounds.minY * zoom, Math.max(-bounds.maxY * zoom, pan.y)),
  };
}

// ─── Apron sizing: REMOVED ────────────────────────────────────────────────────
//
// An `apronCells()` here used to size the default-ground pad to the camera's worst-case reach (the
// zoom-out floor at a clamp limit). It was correct and unusable: ~200×200 cells, 40k+ sprites. The
// ground apron is now a small fixed ring of real tiles plus one tiling quad that covers the rest of
// the viewport for constant cost, so there is nothing left to size — see
// features/nightmarket/GroundBackdropLayer.tsx.

// ─── Visible-cell window (culling) ────────────────────────────────────────────

export type { CellWindow };

/**
 * Cells to pad the visible window by. Covers (a) tall sprites whose anchor cell is off-screen but
 * whose art reaches in, and (b) the quantisation step below, so a drag never exposes an unbuilt
 * edge before the window snaps forward.
 */
const WINDOW_MARGIN_CELLS = 10;

/**
 * Quantisation step for the window edges, in cells. Without it the window would change on every
 * dragged pixel and rebuild the tile field each frame; snapping to a coarse grid means a rebuild
 * only every `STEP` cells of travel. Must stay well under {@link WINDOW_MARGIN_CELLS}.
 */
const WINDOW_QUANTUM_CELLS = 8;

/**
 * The cell-space window currently on screen, for terrain culling.
 *
 * Inverse of the camera transform: the viewport's four screen corners map back to camera-local px
 * (`(screen − viewportW/2 − pan)/zoom`), then to cell space. Because the iso basis is rotated, the
 * cell-space extremes come from the CORNERS of the screen rect, not from its edges — hence all four
 * are converted and min/maxed rather than transforming two points.
 *
 * The result is padded by {@link WINDOW_MARGIN_CELLS} and snapped outward to
 * {@link WINDOW_QUANTUM_CELLS}, so callers can memoise on its four numbers and rebuild rarely.
 */
export function visibleCellWindow(
  pan: Pan,
  zoom: number,
  viewportW: number,
  viewportH: number,
): CellWindow {
  const halfW = TILE_WIDTH / 2;
  const halfH = TILE_HEIGHT / 2;

  let minCol = Infinity, maxCol = -Infinity, minRow = Infinity, maxRow = -Infinity;
  for (const [sx, sy] of [[0, 0], [viewportW, 0], [0, viewportH], [viewportW, viewportH]] as const) {
    // Screen px → camera-local (unscaled) px.
    const localX = (sx - viewportW / 2 - pan.x) / zoom;
    const localY = (sy - viewportH / 2 - pan.y) / zoom;
    // Camera-local px → cell space (inverse of isoToScreen).
    const u = localX / halfW;   // = col − row
    const v = localY / halfH;   // = −(col + row)
    const col = (u - v) / 2;
    const row = (-u - v) / 2;
    if (col < minCol) minCol = col;
    if (col > maxCol) maxCol = col;
    if (row < minRow) minRow = row;
    if (row > maxRow) maxRow = row;
  }

  const snapDown = (n: number) => Math.floor((n - WINDOW_MARGIN_CELLS) / WINDOW_QUANTUM_CELLS) * WINDOW_QUANTUM_CELLS;
  const snapUp = (n: number) => Math.ceil((n + WINDOW_MARGIN_CELLS) / WINDOW_QUANTUM_CELLS) * WINDOW_QUANTUM_CELLS;

  return {
    minCol: snapDown(minCol),
    maxCol: snapUp(maxCol),
    minRow: snapDown(minRow),
    maxRow: snapUp(maxRow),
  };
}
