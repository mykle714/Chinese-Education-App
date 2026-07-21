import { TILE_WIDTH, TILE_HEIGHT, isoToScreen } from './isometric';

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
