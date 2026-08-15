import { TILE_WIDTH, TILE_HEIGHT, type CellWindow } from './isometric';

/**
 * Chunk grid for baked terrain — the pure half of the slippy-map terrain cache.
 *
 * LAYER: engine. No React, no Pixi, no DOM (see docs/FRONTEND_LAYERING.md §
 * "src/engine/ imports nothing outside itself"). Every function here is a
 * coordinate calculation; the renderer half — `RenderTexture` baking, the LRU,
 * the bake queue — lives in `src/features/nightmarket/TerrainChunkLayer.tsx`.
 *
 * ── The problem ────────────────────────────────────────────────────────────────
 * Terrain is emitted as one to four sprites PER CELL (see
 * `src/features/nightmarket/EditorTerrainLayer.tsx`). At the stated scale target
 * — ~100 templates, a ~240×240 cell world — that is tens of thousands of draws
 * for content that does not move. Memoisation hides it today only because a
 * market is currently a handful of 16×16 boards.
 *
 * ── The model: chunk by SCREEN SPACE, not by template ──────────────────────────
 * The tempting design is one baked texture per template. It does not work:
 * templates differ in size, overlap arbitrarily at their seams, and give no
 * control over texture memory as the market grows.
 *
 * Instead this is the slippy-map / quadtree model used by web map tiles. A chunk
 * is a fixed {@link CHUNK_PX}-square of PROJECTED space at a given zoom LEVEL,
 * and it rasterises whatever cells happen to fall inside it. Template
 * heterogeneity then stops mattering entirely — a chunk does not know what a
 * template is.
 *
 * The payoff is that resident texture memory is bounded by the SCREEN, not by the
 * world: ~8 chunks cover a phone viewport, ~16 while two levels are held during a
 * zoom transition, so 16 × 256 × 256 × 4 B ≈ **4 MB regardless of market size**.
 *
 * ── Why the cell⇄screen conversions here are exact ─────────────────────────────
 * A screen-axis-aligned rectangle is NOT axis-aligned in cell space — the iso
 * basis is rotated, so the region it covers is a diamond. But it IS axis-aligned
 * in the rotated coordinates `diag = col − row` and `sum = col + row`, because
 * `isoToScreen` is exactly `x = diag·W/2`, `y = −sum·H/2`. So a screen rect
 * converts to EXACT bounds on (diag, sum) — no approximation, no over-iteration
 * of the ~50% of the bounding box that falls outside the diamond.
 *
 * That is the same insight {@link CellWindow} already encodes for viewport
 * culling, which is why this module returns a `CellWindow` rather than inventing
 * a second rectangle type: the terrain builder (`farmTerrain.buildEditorField`)
 * already consumes exactly this shape, so a chunk bake reuses the existing
 * culling path unchanged.
 *
 * Referenced by docs/NIGHT_MARKET_TERRAIN_CHUNKING.md and
 * docs/REACT_NATIVE_MIGRATION.md § Terrain chunk baking (action item 7).
 */

/**
 * Edge length of one baked chunk texture, in texture pixels.
 *
 * 256 is the web-map-tile convention and it is the right trade here too: large
 * enough that a phone viewport needs only ~8 chunks (so the per-chunk bookkeeping
 * is negligible), small enough that a single bake is ~1–2 ms and can be dropped
 * into a frame without a visible hitch, and small enough that LRU eviction is
 * fine-grained rather than dumping a quarter of the screen at a time.
 */
export const CHUNK_PX = 256;

/**
 * The level at which one cell is drawn at its NATIVE size.
 *
 * `TILE_WIDTH` is 32, and level L draws a cell `2^L` px wide, so native is L5.
 * Levels above this would upscale the source art and are never baked — at scales
 * beyond 1:1 the chunk cache is bypassed and cells draw as ordinary sprites.
 */
export const NATIVE_LEVEL = Math.log2(TILE_WIDTH);

/** Cell width in px at level `L`. L0 = 1 px/cell … L5 = 32 px/cell (native). */
export function cellPxAtLevel(level: number): number {
  return 2 ** level;
}

/**
 * Render scale of level `L` relative to native art — i.e. what the bake pass
 * multiplies sprite coordinates by. 1.0 at {@link NATIVE_LEVEL}.
 */
export function scaleForLevel(level: number): number {
  return cellPxAtLevel(level) / TILE_WIDTH;
}

/**
 * The level to draw at for a given camera scale.
 *
 * Picks the smallest level whose cells are at least as large as what the camera
 * is about to display, so the baked texture is always scaled DOWN (bilinear
 * minification, which is clean) and never UP (magnification, which is visibly
 * soft). Clamped to `[0, NATIVE_LEVEL]`.
 *
 * ⚠️ This is the function whose result must be CROSS-FADED, not switched. Level
 * changes are discrete while zoom is continuous, so a hard swap pops. The
 * renderer holds both levels briefly and blends — which is the reason the memory
 * budget above assumes ~16 resident chunks rather than ~8.
 */
export function levelForScale(cameraScale: number): number {
  if (!(cameraScale > 0)) return NATIVE_LEVEL;
  const wanted = Math.ceil(Math.log2(cameraScale * TILE_WIDTH));
  return Math.min(NATIVE_LEVEL, Math.max(0, wanted));
}

/**
 * How many NATIVE screen px one chunk spans at level `L`.
 *
 * A chunk is always {@link CHUNK_PX} texels; at a coarser level each texel covers
 * more of the world, so the chunk grid is coarser too. L5 → 256 native px,
 * L4 → 512, L0 → 8192.
 */
export function chunkNativeSpan(level: number): number {
  return CHUNK_PX / scaleForLevel(level);
}

/** An axis-aligned rectangle in NATIVE screen space (the space `isoToScreen` returns). */
export interface ScreenRect {
  minX: number;
  maxX: number;
  minY: number;
  maxY: number;
}

/** Identifies one baked chunk. `cx`/`cy` index the chunk grid AT THAT LEVEL. */
export interface ChunkCoord {
  level: number;
  cx: number;
  cy: number;
}

/** Stable string form, for use as a Map key. */
export function chunkKey(c: ChunkCoord): string {
  return `${c.level}/${c.cx}/${c.cy}`;
}

/** The native-screen-space rectangle a chunk covers. */
export function chunkScreenRect({ level, cx, cy }: ChunkCoord): ScreenRect {
  const span = chunkNativeSpan(level);
  return {
    minX: cx * span,
    maxX: (cx + 1) * span,
    minY: cy * span,
    maxY: (cy + 1) * span,
  };
}

/**
 * Every chunk at `level` that intersects a native-screen-space rectangle.
 *
 * This is what the renderer calls each frame with the viewport rect to decide
 * which chunks must be resident. It is deliberately cheap and allocation-light:
 * a phone viewport yields ~8 entries.
 */
export function chunksForScreenRect(level: number, rect: ScreenRect): ChunkCoord[] {
  const span = chunkNativeSpan(level);
  const out: ChunkCoord[] = [];
  // The upper edge is EXCLUSIVE: a rect ending exactly on a boundary covers zero
  // area of the next chunk and must not fetch it. `ceil(max/span) − 1` expresses
  // that exactly; nudging by an epsilon does not, because at these magnitudes
  // `256 - Number.EPSILON === 256` in float. `max(cx0, …)` keeps a degenerate
  // (zero-width) rect returning its own chunk rather than nothing.
  const cx0 = Math.floor(rect.minX / span);
  const cx1 = Math.max(cx0, Math.ceil(rect.maxX / span) - 1);
  const cy0 = Math.floor(rect.minY / span);
  const cy1 = Math.max(cy0, Math.ceil(rect.maxY / span) - 1);
  for (let cy = cy0; cy <= cy1; cy++) {
    for (let cx = cx0; cx <= cx1; cx++) out.push({ level, cx, cy });
  }
  return out;
}

/**
 * Vertical overhang of terrain art beyond the cell diamond it belongs to, in
 * NATIVE px, as `{ above, below }` relative to the sprite's foot anchor.
 *
 * ⚠️ THIS IS THE WHOLE CORRECTNESS PROBLEM OF CHUNK BAKING, so it is a required
 * argument rather than a default.
 *
 * Isometric art is taller than its diamond: the free-farm pack ships 32×32 tiles
 * in which the 32×16 surface diamond is one half and the rest is vertical
 * body/cliff, and the dirt slab is drawn a further `TILE_HEIGHT` BELOW the anchor
 * (see `EditorTerrainLayer`'s `y + TILE_HEIGHT`). A cell whose anchor sits just
 * outside a chunk can therefore still paint INTO it.
 *
 * If a bake only draws the cells whose anchors fall inside its own rect, every
 * chunk boundary shows as a seam of clipped tree tops and missing slab edges —
 * a visible grid over the world. The fix is to bake from a rect expanded by this
 * overhang and let the extra draw off the edge of the render texture, where it is
 * clipped harmlessly.
 *
 * Getting this too LARGE is free (a few redundant draws per chunk). Getting it
 * too SMALL produces seams. Err upward.
 */
export interface SpriteOverhang {
  /** Max px a sprite extends ABOVE its anchor (i.e. toward smaller screen Y). */
  above: number;
  /** Max px a sprite extends BELOW its anchor. */
  below: number;
}

/**
 * The overhang of the current free-farm terrain art.
 *
 * `above`: tiles are authored 32 px tall and anchored at their base, so a sprite
 * reaches one full tile height above its anchor. `below`: the tallDirt slab is
 * drawn at `y + TILE_HEIGHT`, and being bottom-anchored it ends there.
 *
 * Deliberately generous — see the warning on {@link SpriteOverhang}. If the art
 * direction moves to larger non-pixel-art tiles (see
 * docs/REACT_NATIVE_MIGRATION.md open item 6), this is the ONE constant that has
 * to grow with it.
 */
export const FARM_TERRAIN_OVERHANG: SpriteOverhang = {
  above: TILE_WIDTH,
  below: TILE_HEIGHT,
};

/**
 * The exact set of cells whose sprites can paint into a native-screen rectangle.
 *
 * Returns a {@link CellWindow}, whose `minDiag/maxDiag/minSum/maxSum` are the
 * EXACT constraints (see the module header) and whose `minCol…maxRow` box is
 * their bounding box. `farmTerrain.buildEditorField` already consumes this shape
 * and iterates only the diamond, so a bake never touches the ~50% of the bounding
 * box that lies outside the rect.
 *
 * The rect is expanded by `overhang` FIRST, which is what makes chunk seams
 * impossible — see {@link SpriteOverhang}.
 */
export function cellWindowForScreenRect(rect: ScreenRect, overhang: SpriteOverhang): CellWindow {
  // Grow the rect so that any sprite painting into it has its ANCHOR inside the
  // grown rect. A sprite reaching `above` px up means an anchor up to `above` px
  // BELOW the rect's bottom edge can still paint in, and vice versa.
  const minX = rect.minX - TILE_WIDTH / 2;
  const maxX = rect.maxX + TILE_WIDTH / 2;
  const minY = rect.minY - overhang.below;
  const maxY = rect.maxY + overhang.above;

  // Invert the projection. `isoToScreen` is x = (col − row)·W/2, y = −(col + row)·H/2,
  // so diag = 2x/W and sum = −2y/H. Note the sign flip on Y: larger `sum` (deeper
  // into the scene) is HIGHER on screen, so the rect's maxY gives the MIN sum.
  const minDiag = (2 * minX) / TILE_WIDTH;
  const maxDiag = (2 * maxX) / TILE_WIDTH;
  const minSum = (-2 * maxY) / TILE_HEIGHT;
  const maxSum = (-2 * minY) / TILE_HEIGHT;

  // col = (diag + sum)/2, row = (sum − diag)/2. Each is extremised at a corner of
  // the (diag, sum) box, so the bounding box comes straight from the extremes.
  return {
    minDiag: Math.floor(minDiag),
    maxDiag: Math.ceil(maxDiag),
    minSum: Math.floor(minSum),
    maxSum: Math.ceil(maxSum),
    minCol: Math.floor((minDiag + minSum) / 2),
    maxCol: Math.ceil((maxDiag + maxSum) / 2),
    minRow: Math.floor((minSum - maxDiag) / 2),
    maxRow: Math.ceil((maxSum - minDiag) / 2),
  };
}

/** Convenience: the cells that must be drawn to bake one chunk. */
export function cellWindowForChunk(coord: ChunkCoord, overhang: SpriteOverhang): CellWindow {
  return cellWindowForScreenRect(chunkScreenRect(coord), overhang);
}

/** An INCLUSIVE cell-space bounding box — e.g. a template placement's footprint. */
export interface CellBounds {
  minCol: number;
  maxCol: number;
  minRow: number;
  maxRow: number;
}

/**
 * Every chunk key, at every level in `levels`, that a cell-space edit invalidates.
 *
 * ── Why terrain baking is cheap in practice ────────────────────────────────────
 * Terrain is IMMUTABLE between layout edits. It is baked when a template is
 * placed or its version changes — never when the camera moves — so the steady
 * state (pan, zoom, walk around) does zero bake work.
 *
 * An edit dirties only the chunks overlapping the changed template's bounds, at
 * each level. A 16×16 template touches a handful. The expensive case is a global
 * change (season or time-of-day swap, which switches the whole asset set): that
 * dirties everything, and should be run behind the existing transition so the
 * re-bake is hidden.
 *
 * The bounds are expanded by `overhang` for the same reason bakes are — a tall
 * sprite at the edge of the edited region paints into the neighbouring chunk, so
 * that neighbour's texture is stale too.
 */
export function chunksForCellBounds(
  bounds: CellBounds,
  levels: number[],
  overhang: SpriteOverhang,
): string[] {
  // Project the four corners of the cell box; the screen-space bbox of an
  // iso-space box is the bbox of its corners, since the projection is linear.
  const corners = [
    [bounds.minCol, bounds.minRow],
    [bounds.maxCol, bounds.minRow],
    [bounds.minCol, bounds.maxRow],
    [bounds.maxCol, bounds.maxRow],
  ];
  let minX = Infinity, maxX = -Infinity, minY = Infinity, maxY = -Infinity;
  for (const [col, row] of corners) {
    const x = (col - row) * (TILE_WIDTH / 2);
    const y = -(col + row) * (TILE_HEIGHT / 2);
    minX = Math.min(minX, x); maxX = Math.max(maxX, x);
    minY = Math.min(minY, y); maxY = Math.max(maxY, y);
  }
  // Sprites on the edited cells paint beyond their anchors, so grow the region.
  const rect: ScreenRect = {
    minX: minX - TILE_WIDTH / 2,
    maxX: maxX + TILE_WIDTH / 2,
    minY: minY - overhang.above,
    maxY: maxY + overhang.below,
  };

  const keys = new Set<string>();
  for (const level of levels) {
    for (const c of chunksForScreenRect(level, rect)) keys.add(chunkKey(c));
  }
  return [...keys];
}

/**
 * Whether the baked-chunk path engages at this camera scale.
 *
 * Baking flattens ground into one image at one depth, which loses the occlusion a
 * raised terrain lip on a nearer cell gives over an entity behind it. That is
 * acceptable only when it is sub-pixel, so baking engages strictly BELOW native
 * scale and the exact per-cell sprite path runs when the camera is close.
 *
 * ⚠️ SINGLE SOURCE OF TRUTH. Both the chunk layer (deciding whether to bake) and
 * the live layer (deciding whether to emit ground or only decor) must ask this
 * function. Two independent thresholds that disagree leave a zoom band with no
 * ground drawn at all — a full-screen artifact from a one-line inconsistency.
 */
export function isChunkBakingActive(cameraScale: number): boolean {
  return levelForScale(cameraScale) < NATIVE_LEVEL;
}

/** Every bakeable level, coarsest first. Used to dirty "all levels" on a global change. */
export const ALL_LEVELS: number[] = Array.from({ length: NATIVE_LEVEL + 1 }, (_, i) => i);
