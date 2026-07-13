/**
 * walkway — pure data layer describing a straight plank walkway on the free-farm
 * ground field.
 *
 * LAYER: data/model. A walkway is a run of raised wooden **plank** tiles laid
 * along one iso axis. Each tile carries a board-pattern `variation` (the pack
 * ships 3 per direction); the tile at the run's FAR end takes the pack's edge cap
 * for that direction, every other tile the flat `center` plank:
 *   - `ew` (east↔west) — laid along +isoX; far/east end capped with `eastEdge`,
 *   - `ns` (north↔south) — laid along +isoY; far/north end capped with `northEdge`.
 * The pack authors caps only on those two far iso faces (the near S/W faces are
 * never visible), mirroring the landmass edge rule in {@link freeFarmTileset}.
 *
 * It does NOT render — the view ({@link ../../features/nightmarket/WalkwayLayer})
 * paints each {@link WalkwayTile} as a single raised plank slab, the same way
 * {@link ../../features/nightmarket/FarmTerrainLayer} paints the tallDirt slabs.
 *
 * Referenced by: src/features/nightmarket/WalkwayLayer.tsx (consumer),
 * docs/NIGHT_MARKET_FEATURE.md (Terrain rendering section).
 */

import { freeFarmTileset, type WalkwayDirection } from './freeFarmTileset';

/**
 * Board-pattern variations the pack authors per direction
 * (`plank_{dir}_{1..3}_…`), in canonical order. A walkway with no explicit
 * `variations` lays one of each, in this order.
 */
export const PLANK_VARIATIONS = [1, 2, 3] as const;

export interface WalkwayTile {
  /** Iso grid coordinate (east). */
  isoX: number;
  /** Iso grid coordinate (north). */
  isoY: number;
  /** Resolved plank sprite URL (a `center` plank, or the far-end edge cap). */
  url: string;
  /** True for the run's far-end tile — the one drawn with the edge cap. */
  isEnd: boolean;
}

export interface WalkwaySpec {
  /** The NEAR-end (start) tile: west-most for `ew`, south-most for `ns`. */
  origin: readonly [number, number];
  direction: WalkwayDirection;
  /**
   * Board-pattern variation per tile, laid from `origin` toward the far end.
   * Defaults to {@link PLANK_VARIATIONS} — one of each variation, in order.
   */
  variations?: readonly number[];
}

/**
 * Lay a straight walkway of plank tiles from `origin` toward the walkway's far
 * face (east for `ew` / +isoX, north for `ns` / +isoY). Successive tiles take the
 * successive `variations` board patterns; the FAR-END tile uses the pack's edge
 * cap for that direction (`eastEdge` / `northEdge`), every other tile the flat
 * `center` plank. Tiles whose sprite is missing from the pack are skipped.
 */
export function buildWalkway(spec: WalkwaySpec): WalkwayTile[] {
  const variations = spec.variations ?? PLANK_VARIATIONS;
  const [ox, oy] = spec.origin;
  const cap = spec.direction === 'ew' ? 'eastEdge' : 'northEdge';

  const tiles: WalkwayTile[] = [];
  variations.forEach((variation, i) => {
    const isEnd = i === variations.length - 1;
    // ew runs east (+isoX) at constant isoY; ns runs north (+isoY) at constant isoX.
    const isoX = spec.direction === 'ew' ? ox + i : ox;
    const isoY = spec.direction === 'ns' ? oy + i : oy;
    const url = freeFarmTileset.getPlank(spec.direction, variation, isEnd ? cap : 'center');
    if (url) tiles.push({ isoX, isoY, url, isEnd });
  });
  return tiles;
}
