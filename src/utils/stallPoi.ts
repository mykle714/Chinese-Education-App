/**
 * POI derivation from stall frontage declarations.
 *
 * Because all walkways are single axis-aligned segments, projecting a stall's
 * iso position onto its walkway is a 1D distance — no arc-length math required.
 *
 * t is returned in iso units (not a 0–1 fraction): t = distance from polyline[0],
 * where polyline[0] is the screen-south start (max isoX + isoY endpoint).
 *
 * Usage:
 *   const pois = buildPoisFromStalls(DEMO_STALLS, WALKWAY_MAP);
 */

import type { NightMarketAssetDef, WalkwayDef, PoiDef } from '../config/nightMarketRegistry';

/**
 * Project a stall's iso position onto its declared walkway, returning t as the
 * iso distance from polyline[0] (the screen-south start of the walkway).
 *
 * For a horizontal segment (isoY fixed): t = |stall.isoX - polyline[0].isoX|
 * For a vertical segment (isoX fixed):   t = |stall.isoY - polyline[0].isoY|
 *
 * Returns null if the walkway is degenerate (zero length) or has no frontage.
 */
export function computePoiFromStall(
  stall: NightMarketAssetDef,
  walkway: WalkwayDef,
): PoiDef | null {
  if (!stall.frontage) return null;
  const [[x0, y0], [x1, y1]] = walkway.polyline;

  let t: number;
  if (x0 === x1) {
    // Vertical segment — project stall's isoY distance from polyline[0].
    const len = Math.abs(y1 - y0);
    if (len === 0) return null;
    t = Math.abs(stall.isoY - y0);
  } else {
    // Horizontal segment — project stall's isoX distance from polyline[0].
    const len = Math.abs(x1 - x0);
    if (len === 0) return null;
    t = Math.abs(stall.isoX - x0);
  }

  return {
    poiId: `poi-${stall.assetId}`,
    walkwayId: walkway.walkwayId,
    t,
    side: stall.frontage.side,
    linkedAssetId: stall.assetId,
    displayName: stall.displayName,
  };
}

/**
 * Derive POIs for all stalls that declare a frontage.
 * Stalls without frontage are silently skipped.
 * Throws (in dev) if two stalls share the same (walkwayId, t, side) — max 1 POI
 * per side per t position on any walkway.
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

  // Dev-time guard: enforce max 1 POI per (walkwayId, t, side).
  if (import.meta.env.DEV) {
    const seen = new Set<string>();
    for (const poi of pois) {
      const key = `${poi.walkwayId}:${poi.t}:${poi.side}`;
      if (seen.has(key)) {
        throw new Error(`[stallPoi] Duplicate POI at (${key}). Each (walkway, t, side) may have at most one POI.`);
      }
      seen.add(key);
    }
  }

  return pois;
}
