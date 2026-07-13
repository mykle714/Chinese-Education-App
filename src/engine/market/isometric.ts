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
 * Compute z-index for a pedestrian. Same painter's rule as computeLayerZ;
 * pedestrians always render in the `entity` slot.
 */
export function computePedestrianZ(isoX: number, isoY: number): number {
  return -(isoX + isoY) + RENDER_SLOT_Z.entity;
}

// ── Sprite-strip slicing ─────────────────────────────────────────────────────
// Wide stand sprites are rendered as 2F vertical strips so each strip carries
// its own foot anchor for painter's-algorithm z-sorting.
//
// Visual placement is PIXEL-FAITHFUL — each strip occupies the same screen
// column it would in the unsliced sprite (no horizontal stretching, no
// vertical shift). The sub-texture frame is just the i-th vertical slice of
// the source.
//
// Z-sort, however, treats each strip as if its bottom sits on the stand's
// SW/SE diamond edge at that strip's screen-X. We derive an implied "foot
// iso" by mapping the strip's center-offset (in screen px) back to iso units
// along the south edges. This decouples z-depth from the sprite's authored
// pixel width — gaps/overlaps between adjacent strips never appear because
// the strips render at their natural pixel positions.

export interface StripPlacement {
  /** 0..2F-1, 0 = leftmost column, F-1 = innermost left, F = innermost right, 2F-1 = rightmost. */
  stripIndex: number;
  /** Sub-texture frame within the source. Always full-height; horizontal slice only. */
  frame: { x: number; y: number; w: number; h: number };
  /** Screen-X offset of the strip's LEFT edge from the sprite's original anchor (sx0). */
  offsetX: number;
  /** Implied foot iso (used only for z-sort). */
  footIsoX: number;
  footIsoY: number;
}

/**
 * Enumerate `2F` vertical-slice placements for a stand at (swX, swY).
 * Pass the texture dimensions and render scale so screen offsets and
 * implied foot positions can be computed from the asset's actual pixel
 * extent (avoids stretching/gap artifacts when the artwork isn't exactly
 * 2F·TILE_WIDTH/2 wide).
 */
export function computeStripPlacements(
  swX: number,
  swY: number,
  footprintSize: number,
  texW: number,
  texH: number,
  scale: number,
): StripPlacement[] {
  const F = footprintSize;
  const stripTexW = texW / (2 * F);
  const stripScreenW = stripTexW * scale;
  const placements: StripPlacement[] = [];
  for (let i = 0; i < 2 * F; i++) {
    // Center-offset of this strip (signed screen px from sprite center).
    const centerOffset = (i + 0.5 - F) * stripScreenW;
    // Map |centerOffset| back to iso units along the SW/SE diamond edge.
    // TILE_WIDTH/2 screen px per iso unit on the horizontal axis.
    const deltaIso = Math.abs(centerOffset) / (TILE_WIDTH / 2);
    const isLeft = i < F;
    placements.push({
      stripIndex: i,
      frame: { x: i * stripTexW, y: 0, w: stripTexW, h: texH },
      offsetX: (i - F) * stripScreenW,   // left edge of strip relative to sx0
      footIsoX: isLeft ? swX : swX + deltaIso,
      footIsoY: isLeft ? swY + deltaIso : swY,
    });
  }
  return placements;
}
