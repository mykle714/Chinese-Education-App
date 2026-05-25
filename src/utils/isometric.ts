import type { RenderSlot } from '../config/nightMarketRegistry';
import { RENDER_SLOT_Z } from '../config/nightMarketRegistry';

/**
 * Isometric coordinate system utilities for the Night Market.
 *
 * Converts isometric grid coordinates (isoX, isoY) into screen-space
 * coordinates (screenX, screenY) using true isometric projection (30° angle, equal axes).
 *
 * Axis orientation (compass directions match the screen layout):
 *   - Increasing isoX → top-right on screen (east)
 *   - Increasing isoY → top-left on screen (north)
 *   - Decreasing isoX → bottom-left  (west)
 *   - Decreasing isoY → bottom-right (south)
 *   - Origin (0, 0) maps to the center of the viewport
 *
 * Z-ordering (axis-minimum rule):
 *   z = -min(isoX, isoY) - max(isoX, isoY) * Z_MAX_TIEBREAK + slot
 *
 *   Every asset anchors at its SW corner (lowest iso point, bottom screen
 *   vertex) and the sprite extends upward from there. Two sprites only visually
 *   overlap on screen when their anchors' (isoX + isoY) sums are close, which
 *   means their min(isoX, isoY) values are also close — so min-based depth
 *   sorts overlapping sprites correctly. Crucially, a pedestrian "beside" a
 *   wide stand (ahead on one axis, behind on the other) renders correctly:
 *   if the ped is in front on EITHER axis its min is smaller, so it renders
 *   in front. The -(isoX+isoY) sum formula gets this wrong.
 *
 *   The -max*Z_MAX_TIEBREAK term is a tiebreaker for stands sharing the same
 *   min (e.g., a row of stands at constant isoY where every stand's isoX ≥ isoY
 *   collapses to min=isoY): the stand further along the larger axis sits
 *   slightly further back, matching its true depth ordering.
 */

/** Width of one isometric tile in pixels (horizontal span of the diamond) */
export const TILE_WIDTH = 128;

/** Height of one isometric tile in pixels (vertical span of the diamond, width ÷ √3 for 30° angle) */
const TILE_HEIGHT = TILE_WIDTH / Math.sqrt(3); // ~73.86px

/**
 * Small fractional weight applied to the max-axis coordinate as a z-tiebreaker.
 * Must be small enough that it never reorders pairs that the min-axis term
 * already separates, but large enough to break ties. Stand min values typically
 * span ~hundreds of iso units, so 0.001 keeps the tiebreak well below the
 * smallest meaningful min difference (1.0).
 */
const Z_MAX_TIEBREAK = 0.001;

export interface ScreenPosition {
  screenX: number;
  screenY: number;
}

/**
 * Convert isometric grid coordinates to screen-space coordinates.
 *
 * Z-index is intentionally not returned here — callers must use computeLayerZ
 * or computePedestrianZ, which encode the axis-minimum depth rule.
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
 * Compute the z-index for an asset sub-layer using the axis-minimum rule
 * (see the top-of-file docblock for the rationale).
 *
 * @param isoX - Isometric X position (continuous float)
 * @param isoY - Isometric Y position (continuous float)
 * @param slot - Render slot determining fractional z-offset within the asset
 */
export function computeLayerZ(isoX: number, isoY: number, slot: RenderSlot): number {
  return -Math.min(isoX, isoY) - Math.max(isoX, isoY) * Z_MAX_TIEBREAK + RENDER_SLOT_Z[slot];
}

/**
 * Compute z-index for a pedestrian. Shares the axis-minimum formula with
 * computeLayerZ; pedestrians always render in the `entity` slot.
 */
export function computePedestrianZ(isoX: number, isoY: number): number {
  return -Math.min(isoX, isoY) - Math.max(isoX, isoY) * Z_MAX_TIEBREAK + RENDER_SLOT_Z.entity;
}
