import type { RenderSlot } from '../config/nightMarketRegistry';
import { RENDER_SLOT_Z } from '../config/nightMarketRegistry';

/**
 * Isometric coordinate system utilities for the Night Market.
 *
 * Converts isometric grid coordinates (isoX, isoY) into screen-space
 * coordinates (screenX, screenY) using true isometric projection (30° angle, equal axes).
 *
 * Axis orientation:
 *   - Increasing isoX → top-right on screen
 *   - Increasing isoY → top-left on screen
 *   - Origin (0, 0) maps to the center of the viewport
 *
 * Z-ordering:
 *   z = -(isoX + isoY) — items further "north" (high iso) render behind;
 *   items closer to the viewer (low iso, bottom of screen) render in front.
 */

/** Width of one isometric tile in pixels (horizontal span of the diamond) */
const TILE_WIDTH = 128;

/** Height of one isometric tile in pixels (vertical span of the diamond, width ÷ √3 for 30° angle) */
const TILE_HEIGHT = TILE_WIDTH / Math.sqrt(3); // ~73.86px

export interface ScreenPosition {
  screenX: number;
  screenY: number;
  zIndex: number;
}

/**
 * Convert isometric grid coordinates to screen-space coordinates.
 *
 * @param isoX - Position along the isometric X axis (toward bottom-right)
 * @param isoY - Position along the isometric Y axis (toward bottom-left)
 * @returns Screen position and computed z-index for draw ordering
 */
export function isoToScreen(isoX: number, isoY: number): ScreenPosition {
  const screenX = (isoX - isoY) * (TILE_WIDTH / 2);
  const screenY = -(isoX + isoY) * (TILE_HEIGHT / 2);
  const zIndex = -(isoX + isoY);

  return { screenX, screenY, zIndex };
}

/**
 * Compute the final z-index for a sub-layer, incorporating its render slot offset.
 *
 * finalZ = -(isoX + isoY) + slotFraction
 *
 * Within the same stand (same depth), layers sort by slot.
 * Across stands separated by >= 1.0 depth, spatial depth dominates naturally.
 *
 * @param isoX - Isometric X position (continuous float)
 * @param isoY - Isometric Y position (continuous float)
 * @param slot - Render slot determining fractional z-offset
 */
export function computeLayerZ(isoX: number, isoY: number, slot: RenderSlot): number {
  return -(isoX + isoY) + RENDER_SLOT_Z[slot];
}
