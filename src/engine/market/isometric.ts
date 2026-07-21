import type { RenderSlot } from './nightMarketRegistry';
import { RENDER_SLOT_Z } from './nightMarketRegistry';

/**
 * Isometric coordinate system utilities for the Night Market.
 *
 * Converts isometric grid coordinates (isoX, isoY) into screen-space
 * coordinates (screenX, screenY) using a 2:1 dimetric ("pixel-art isometric")
 * projection — the tile diamond is twice as wide as it is tall. This matches
 * the free-farm-assets tilepack, whose surface diamonds are authored 32×16.
 *
 * Axis orientation (compass directions match the screen layout):
 *   - Increasing isoX → top-right on screen (east)
 *   - Increasing isoY → top-left on screen (north)
 *   - Decreasing isoX → bottom-left  (west)
 *   - Decreasing isoY → bottom-right (south)
 *   - Origin (0, 0) maps to the center of the viewport
 *
 * Z-ordering (painter's algorithm with foot-anchor sort):
 *   z = -(footIsoX + footIsoY) + slot
 *
 *   Draw back-to-front along the camera depth axis (isoX + isoY) — larger
 *   sums sit further into the screen and get a lower z so they render first.
 *   Pixi's `sortableChildren` then resolves occlusion correctly.
 *
 *   Sort key is the sprite's FOOT anchor — the front-corner point closest to
 *   the camera, not the bounding box. In this codebase every sprite (stand or
 *   pedestrian) is positioned at its SW corner with Pixi anchor (0.5, 1), so
 *   the rendered foot already coincides with the (isoX, isoY) passed in — no
 *   per-sprite anchor metadata needed.
 *
 *   The slot term (a small fraction in [0, 1)) layers sub-images of the same
 *   asset (background → entity → foreground → overlay) without reordering
 *   anything across asset depths.
 */

/**
 * Width of one isometric tile in pixels (horizontal span of the diamond).
 * 32 == the free-farm surface-diamond width at native (1:1) resolution; the
 * camera does integer zoom for crisp upscaling, so no per-tile scaling.
 */
export const TILE_WIDTH = 32;

/**
 * Height of one isometric tile in pixels (vertical span of the diamond).
 * 2:1 dimetric → exactly half the width (16px), matching the pack's 32×16 art.
 */
export const TILE_HEIGHT = TILE_WIDTH / 2; // 16px

export interface ScreenPosition {
  screenX: number;
  screenY: number;
}

/**
 * Convert isometric grid coordinates to screen-space coordinates.
 *
 * Z-index is intentionally not returned here — callers must use computeLayerZ
 * or computePedestrianZ, which encode the foot-anchor painter's rule.
 *
 * @param isoX - Position along the isometric X axis (toward top-right / east)
 * @param isoY - Position along the isometric Y axis (toward top-left / north)
 */
export function isoToScreen(isoX: number, isoY: number): ScreenPosition {
  const screenX = (isoX - isoY) * (TILE_WIDTH / 2);
  const screenY = -(isoX + isoY) * (TILE_HEIGHT / 2);

  return { screenX, screenY };
}

/**
 * Compute the z-index for an asset sub-layer.
 *
 * @param isoX - Foot-anchor isoX (SW corner of the stand / front-corner of the footprint)
 * @param isoY - Foot-anchor isoY
 * @param slot - Render slot determining fractional z-offset within the asset
 */
export function computeLayerZ(isoX: number, isoY: number, slot: RenderSlot): number {
  return -(isoX + isoY) + RENDER_SLOT_Z[slot];
}

/**
 * A translation from a LOCAL cell space (a template's own 0-based grid) into the GLOBAL cell
 * space shared by every surface that composites more than one template (the Template Sandbox).
 *
 * Adding an origin to a local cell makes BOTH its screen position and its {@link computeLayerZ}
 * depth global at once — `isoToScreen` is linear and `computeLayerZ` is `-(x + y) + slot`, so the
 * shift is exactly `-(origin.col + origin.row)` on z. That identity is why compositing surfaces
 * shift cells rather than translating a per-template container: a container isolates Pixi's
 * `sortableChildren` pass to its own children, which collapses a whole template to a single depth
 * and makes tall sprites (trees, house roofs, dirt slabs) occlude across templates incorrectly.
 */
export interface CellOrigin {
  col: number;
  row: number;
}

/** The identity origin — local space IS global space (single-template surfaces). */
export const ORIGIN_ZERO: CellOrigin = { col: 0, row: 0 };

/**
 * Compute z-index for a pedestrian. Same painter's rule as computeLayerZ;
 * pedestrians always render in the `entity` slot.
 */
export function computePedestrianZ(isoX: number, isoY: number): number {
  return -(isoX + isoY) + RENDER_SLOT_Z.entity;
}

// ── Sprite-strip slicing ─────────────────────────────────────────────────────
// A big building/stand sprite is a SINGLE quad, so a single foot anchor gives it
// ONE depth for its whole width — which is wrong for anything wider than a tile:
// a pedestrian standing beside the near-left wing sorts against the same z as one
// standing beside the near-right wing. The fix is to draw the sprite as a row of
// full-height VERTICAL STRIPS, each carrying its own foot anchor, so the
// painter's-algorithm sort resolves per screen-column.
//
// Visual placement is PIXEL-FAITHFUL — each strip occupies the same screen
// column it would in the unsliced sprite (no horizontal stretching, no
// vertical shift). The sub-texture frame is just the i-th vertical slice of
// the source, so gaps/overlaps between adjacent strips never appear.
//
// Z-sort, however, treats each strip as if its bottom sits on the footprint's
// two FRONT (south) diamond edges at that strip's screen-X — which is exactly the
// nearest surface point of the block in that screen column. We derive an implied
// "foot iso" by mapping the strip's center-offset (in screen px) back to iso units
// along those edges: TILE_WIDTH/2 screen px per iso unit horizontally, with the
// left half walking +isoY (the SW edge) and the right half walking +isoX (the SE
// edge) out of the front corner. This decouples z-depth from the sprite's authored
// pixel width — art that overhangs the footprint (a roof eave) simply gets an
// implied foot slightly past the footprint corner, which is the depth its pixels
// visually occupy.

export interface StripPlacement {
  /** 0-based, left-to-right in TEXTURE order (see `offsetX` for screen order under flip). */
  stripIndex: number;
  /** Sub-texture frame within the source. Always full-height; horizontal slice only. */
  frame: { x: number; y: number; w: number; h: number };
  /**
   * Screen-X offset of the strip's LEFT edge from the sprite's anchor point.
   * Render the strip at `anchorScreenX + offsetX` with `anchor.x = flip ? 1 : 0`
   * and `scale.x = flip ? -1 : 1` — both combinations draw rightward from that x.
   */
  offsetX: number;
  /** Implied foot iso (used only for z-sort). */
  footIsoX: number;
  footIsoY: number;
}

export interface SpriteStripOptions {
  /** Foot anchor of the whole sprite — the footprint's FRONT (min-iso) corner. */
  footIsoX: number;
  footIsoY: number;
  /** Source texture dimensions in pixels. */
  texW: number;
  texH: number;
  /**
   * Texture-X of the sprite's anchor point (the pixel that seats on the front
   * corner). Bottom-centre-anchored art passes `texW / 2`; art with a measured
   * off-centre base corner (House.png) passes that corner's x.
   */
  anchorTexX: number;
  /**
   * Width of one strip in TEXTURE px. Defaults to TILE_WIDTH / 2 — one iso unit
   * of front-edge length per strip, the finest depth granularity the grid can use.
   * Strips are cut from texture x = 0 so boundaries stay on integer pixels.
   */
  stripTexW?: number;
  /** Render scale of the sprite (1 when the camera container does the zooming). */
  scale?: number;
  /**
   * Horizontally mirrored sprite. Mirroring swaps which screen side each texture
   * column lands on, so the depth mapping is computed AFTER the flip.
   */
  flip?: boolean;
}

/**
 * Enumerate the vertical-strip placements for one foot-anchored sprite.
 *
 * Consumers: {@link ./house HOUSE_STRIPS} (the House.png building, rendered by
 * `HouseStripSprites`). Stands go through {@link computeStripPlacements}.
 */
export function computeSpriteStrips(opts: SpriteStripOptions): StripPlacement[] {
  const {
    footIsoX, footIsoY, texW, texH, anchorTexX,
    stripTexW = TILE_WIDTH / 2, scale = 1, flip = false,
  } = opts;

  const count = Math.ceil(texW / stripTexW);
  const placements: StripPlacement[] = [];
  for (let i = 0; i < count; i++) {
    const left = i * stripTexW;
    const w = Math.min(stripTexW, texW - left); // last strip may be a remainder
    // Signed screen-px offsets of this strip's edges/centre from the anchor point,
    // measured AFTER any horizontal mirror (flip negates and swaps the edges).
    const texToScreen = (tx: number) => (tx - anchorTexX) * scale * (flip ? -1 : 1);
    const centerOffset = texToScreen(left + w / 2);
    const leftEdgeOffset = flip ? texToScreen(left + w) : texToScreen(left);
    // Map |centerOffset| back to iso units along the front (south) diamond edges.
    const deltaIso = Math.abs(centerOffset) / (TILE_WIDTH / 2);
    const isLeft = centerOffset < 0;
    placements.push({
      stripIndex: i,
      frame: { x: left, y: 0, w, h: texH },
      offsetX: leftEdgeOffset,
      footIsoX: isLeft ? footIsoX : footIsoX + deltaIso,
      footIsoY: isLeft ? footIsoY + deltaIso : footIsoY,
    });
  }
  return placements;
}

/**
 * Stand flavour of {@link computeSpriteStrips}: a bottom-centre-anchored, square
 * `footprintSize`×`footprintSize` sprite cut into exactly `2F` strips (one per iso
 * unit of its two front edges) regardless of the art's authored pixel width.
 */
export function computeStripPlacements(
  swX: number,
  swY: number,
  footprintSize: number,
  texW: number,
  texH: number,
  scale: number,
): StripPlacement[] {
  return computeSpriteStrips({
    footIsoX: swX,
    footIsoY: swY,
    texW,
    texH,
    anchorTexX: texW / 2,
    stripTexW: texW / (2 * footprintSize),
    scale,
  });
}
