/**
 * Tile traversal helpers — pure math for moving a pedestrian along a tile path.
 *
 * A pedestrian's render position is `lerp(currentTile, nextForwardTile, localProgress)`,
 * where the next forward tile is derived from the current `NavLeg`.
 * `advanceLocalProgress` advances `localProgress` by elapsed time at the
 * pedestrian's speed. Each tile is 1 iso unit on a side, so the progress delta
 * per tick is simply `dtMs/1000 * speed`.
 */

import { TILE_SIZE, type TileCoord } from '../config/nightMarketRegistry';

/** Linear interpolation in iso space between two tiles. */
export function lerpTile(from: TileCoord, to: TileCoord, t: number): [number, number] {
  const clamped = Math.max(0, Math.min(1, t));
  return [
    from.isoX + (to.isoX - from.isoX) * clamped,
    from.isoY + (to.isoY - from.isoY) * clamped,
  ];
}

/** Heading (unit vector in iso space) from `from` to `to`. */
export function headingBetweenTiles(from: TileCoord, to: TileCoord): [number, number] {
  const dx = to.isoX - from.isoX;
  const dy = to.isoY - from.isoY;
  const len = Math.hypot(dx, dy);
  if (len === 0) return [1, 0];
  return [dx / len, dy / len];
}

/**
 * Advance localProgress along a single tile-step (which spans TILE_SIZE iso units).
 * Speed is in iso/sec, so progress increments by `(dt/1000) * speed / TILE_SIZE`.
 */
export function advanceLocalProgress(
  current: number,
  dtMs: number,
  speedIsoPerSec: number,
): { progress: number; completed: boolean } {
  const next = current + (dtMs / 1000) * (speedIsoPerSec / TILE_SIZE);
  if (next >= 1) return { progress: 1, completed: true };
  return { progress: next, completed: false };
}
