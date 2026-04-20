/**
 * Walkway micro-layer traversal.
 *
 * Once a pedestrian is committed to a walkway, the graph is no longer
 * consulted. A per-walkway TraversalStrategy owns moment-to-moment position.
 *
 * v1 ships `linearTraversal` (constant-speed interpolation along the polyline).
 * Extension points (not implemented yet) all slot in here without touching
 * pedestrian state or graph code:
 *   - lanedTraversal: offsets perpendicular to the polyline tangent based on direction
 *   - collisionAwareTraversal: slows/steers when peers are within a radius
 *   - curvedTraversal: smooths corners with a spline
 *   - stallInteriorTraversal: scripted choreography inside a stall footprint
 */

import type { WalkwayDef, TraversalKind } from '../config/nightMarketRegistry';

/**
 * Result of one traversal step. `t` is progress in [0, 1] along the polyline.
 * `isoPos` is the pedestrian's current iso-space position (already accounting
 * for any strategy-specific offsets like lane shift).
 */
export interface TraversalStep {
  t: number;
  isoPos: [number, number];
  /** Heading in iso space (unit vector). Useful for sprite facing / lanes. */
  headingIso: [number, number];
  /** True when the pedestrian has reached direction-end of the walkway. */
  reachedEnd: boolean;
}

/** Optional per-pedestrian context a traversal strategy may peek at (collision, etc.). */
export interface TraversalContext {
  /** Other pedestrians currently on the same walkway (for future collision). */
  peersOnWalkway?: Array<{ id: string; t: number; direction: 1 | -1 }>;
}

export interface TraversalStrategy {
  kind: TraversalKind;
  /**
   * Advance one step.
   * @param walkway   the walkway being traversed
   * @param t         current progress in [0, 1]
   * @param direction +1 toward polyline[N-1], -1 toward polyline[0]
   * @param dtMs      elapsed time since last step
   * @param clampT    optional: stop at this progress (used for POI entry points)
   */
  advance(
    walkway: WalkwayDef,
    t: number,
    direction: 1 | -1,
    dtMs: number,
    clampT: number | null,
    ctx?: TraversalContext
  ): TraversalStep;
}

// ---------------------------------------------------------------------------
// Polyline math helpers (used by all strategies, so kept here)
// ---------------------------------------------------------------------------

/** Total iso-length of a polyline. */
export function polylineLength(polyline: Array<[number, number]>): number {
  let total = 0;
  for (let i = 1; i < polyline.length; i++) {
    const [x0, y0] = polyline[i - 1];
    const [x1, y1] = polyline[i];
    total += Math.hypot(x1 - x0, y1 - y0);
  }
  return total;
}

/**
 * Interpolate a point along a polyline at progress t in [0, 1].
 * Returns both position and the local segment heading (unit vector).
 */
export function pointAtT(
  polyline: Array<[number, number]>,
  t: number
): { isoPos: [number, number]; headingIso: [number, number] } {
  const clamped = Math.max(0, Math.min(1, t));
  const total = polylineLength(polyline);
  if (total === 0) {
    return { isoPos: [polyline[0][0], polyline[0][1]], headingIso: [1, 0] };
  }
  const targetDist = clamped * total;
  let acc = 0;
  for (let i = 1; i < polyline.length; i++) {
    const [x0, y0] = polyline[i - 1];
    const [x1, y1] = polyline[i];
    const segLen = Math.hypot(x1 - x0, y1 - y0);
    if (segLen === 0) continue;
    if (acc + segLen >= targetDist || i === polyline.length - 1) {
      const segT = Math.min(1, (targetDist - acc) / segLen);
      const ix = x0 + (x1 - x0) * segT;
      const iy = y0 + (y1 - y0) * segT;
      const hx = (x1 - x0) / segLen;
      const hy = (y1 - y0) / segLen;
      return { isoPos: [ix, iy], headingIso: [hx, hy] };
    }
    acc += segLen;
  }
  // Fallback — shouldn't hit this.
  const last = polyline[polyline.length - 1];
  return { isoPos: [last[0], last[1]], headingIso: [1, 0] };
}

// ---------------------------------------------------------------------------
// Strategies
// ---------------------------------------------------------------------------

export const linearTraversal: TraversalStrategy = {
  kind: 'linear',
  advance(walkway, t, direction, dtMs, clampT) {
    const totalLen = polylineLength(walkway.polyline);
    if (totalLen === 0) {
      const [x, y] = walkway.polyline[0];
      return { t, isoPos: [x, y], headingIso: [1, 0], reachedEnd: true };
    }
    // Constant-speed progress in t-space: dt * speed / totalLen.
    const dt = (dtMs / 1000) * (walkway.speedIsoPerSec / totalLen);
    let next = t + dt * direction;

    // Hard target (POI stop) — clamp if we'd overshoot it.
    let reachedEnd = false;
    if (clampT !== null) {
      if (direction === 1 && next >= clampT) {
        next = clampT;
        reachedEnd = true;
      } else if (direction === -1 && next <= clampT) {
        next = clampT;
        reachedEnd = true;
      }
    }
    // Walkway-end bound.
    if (next >= 1) {
      next = 1;
      reachedEnd = true;
    } else if (next <= 0) {
      next = 0;
      reachedEnd = true;
    }

    const { isoPos, headingIso } = pointAtT(walkway.polyline, next);
    // Flip heading when traveling backward so sprite-facing etc. stays correct.
    const oriented: [number, number] = direction === 1
      ? headingIso
      : [-headingIso[0], -headingIso[1]];
    return { t: next, isoPos, headingIso: oriented, reachedEnd };
  },
};

/** Resolve a TraversalKind to its strategy implementation. */
export function getTraversalStrategy(kind: TraversalKind): TraversalStrategy {
  switch (kind) {
    case 'linear':
      return linearTraversal;
  }
}
