/**
 * POI derivation from stall frontage declarations.
 *
 * Because all walkways are single axis-aligned segments, projecting a stall's
 * iso position onto its walkway is a 1D clamp — no arc-length math required.
 *
 * Usage:
 *   const pois = buildPoisFromStalls(DEMO_STALLS, WALKWAY_MAP);
 */

import type { NightMarketAssetDef, WalkwayDef, PoiDef } from '../config/nightMarketRegistry';

/**
 * Project a stall's iso position onto its declared walkway, returning t in [0, 1].
 *
 * For a horizontal segment (isoY fixed): projects stall.isoX onto the X range.
 * For a vertical segment (isoX fixed): projects stall.isoY onto the Y range.
 *
 * Returns null if the walkway is degenerate (zero length).
 */
export function computePoiFromStall(
  stall: NightMarketAssetDef,
  walkway: WalkwayDef,
): PoiDef | null {
  const [[x0, y0], [x1, y1]] = walkway.polyline;

  let t: number;
  if (x0 === x1) {
    // Vertical segment — project stall's isoY.
    const len = y1 - y0;
    if (len === 0) return null;
    t = Math.max(0, Math.min(1, (stall.isoY - y0) / len));
  } else {
    // Horizontal segment — project stall's isoX.
    const len = x1 - x0;
    if (len === 0) return null;
    t = Math.max(0, Math.min(1, (stall.isoX - x0) / len));
  }

  return {
    poiId: `poi-${stall.assetId}`,
    walkwayId: walkway.walkwayId,
    t,
    linkedAssetId: stall.assetId,
    displayName: stall.displayName,
  };
}

/**
 * Derive POIs for all stalls that declare a frontage.
 * Stalls without frontage are silently skipped.
 */
export function buildPoisFromStalls(
  stalls: NightMarketAssetDef[],
  walkwayMap: Map<string, WalkwayDef>,
): PoiDef[] {
  const pois: PoiDef[] = [];
  for (const stall of stalls) {
    if (!stall.frontage) continue;
    const walkway = walkwayMap.get(stall.frontage.walkwayId);
    if (!walkway) {
      console.warn(`[stallPoi] Stall ${stall.assetId} references unknown walkway ${stall.frontage.walkwayId}`);
      continue;
    }
    const poi = computePoiFromStall(stall, walkway);
    if (poi) pois.push(poi);
  }
  return pois;
}
