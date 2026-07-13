/**
 * Tile Registry — night market layout (currently EMPTY).
 *
 * The night market was rebuilt on the free-farm 2:1 tileset (see
 * docs/NIGHT_MARKET_FEATURE.md). The old hand-authored demo layout — named
 * streets, 8×8 stalls, `floor.png`, and the pedestrian-populated navigation
 * graph — was removed. The visible ground now comes from
 * {@link ../../features/nightmarket/FarmTerrainLayer}, driven by
 * {@link ./farmTerrain}.
 *
 * This module is kept as the seam where a future authored layout plugs back in:
 * the generic street→tile builders and the pedestrian factory remain, but the
 * demo DATA is empty, so `TILES`, `STREETS`, and both graphs are empty. The
 * dormant pedestrian/streetGraph engine still compiles against them.
 */

import {
  PEDESTRIAN_SPEED_ISO_PER_SEC,
  TILE_SIZE,
  type NightMarketAssetDef,
  type PedestrianState,
  type SpriteDef,
  type Street,
  type TileCoord,
  type TileDef,
} from './nightMarketRegistry';

// Re-export Street so consumers can import it from either config module.
export type { Street };
import { buildTileGraph, tileKey } from './tileGraph';
import { buildStreetGraph } from './streetGraph';

// Pedestrian sprite (dormant — kept for a future re-layout that re-populates the
// field with walkers). Uses the test-asset human + walk frames.
import humanImgUrl from '../../assets/test-assets/human.png';
import walkBackLeft1 from '../../assets/test-assets/test-walk-animation/walk_backward_left_1.png';
import walkBackLeft2 from '../../assets/test-assets/test-walk-animation/walk_backward_left_2.png';
import walkBackRight1 from '../../assets/test-assets/test-walk-animation/walk_backward_right_1.png';
import walkBackRight2 from '../../assets/test-assets/test-walk-animation/walk_backward_right_2.png';
import walkFwdLeft1 from '../../assets/test-assets/test-walk-animation/walk_forward_left_1.png';
import walkFwdLeft2 from '../../assets/test-assets/test-walk-animation/walk_forward_left_2.png';
import walkFwdRight1 from '../../assets/test-assets/test-walk-animation/walk_forward_right_1.png';
import walkFwdRight2 from '../../assets/test-assets/test-walk-animation/walk_forward_right_2.png';

// ---------------------------------------------------------------------------
// Tile authoring helpers (generic — retained for the future authored layout).
// ---------------------------------------------------------------------------

function assertGridAligned(label: string, ...values: number[]): void {
  for (const v of values) {
    if (v % TILE_SIZE !== 0) {
      throw new Error(`[tileRegistry] ${label}: value ${v} is not a multiple of TILE_SIZE=${TILE_SIZE}`);
    }
  }
}

/**
 * Expand streets into their tiles in priority order. Streets are sorted
 * thickest-first (NS before EW on ties); the first street to claim a coordinate
 * wins. Intersection tiles carry the full claimant list.
 */
function buildTilesFromStreets(streets: Street[]): TileDef[] {
  const sorted = [...streets].sort((a, b) => {
    if (b.width !== a.width) return b.width - a.width;
    if (a.isNorthSouth !== b.isNorthSouth) return a.isNorthSouth ? -1 : 1;
    return 0;
  });
  const claimed = new Map<string, TileDef>();
  const allClaimants = new Map<string, Street[]>();
  for (const street of sorted) {
    for (const tile of streetTiles(street)) {
      const key = tileKey(tile.isoX, tile.isoY);
      const list = allClaimants.get(key);
      if (list) {
        list.push(street);
      } else {
        allClaimants.set(key, [street]);
        claimed.set(key, tile);
      }
    }
  }
  for (const [key, tile] of claimed) {
    tile.intersectingStreets = allClaimants.get(key);
  }
  return Array.from(claimed.values());
}

/**
 * Expand a Street into the dense set of TileDefs it covers (both endpoints
 * inclusive). Each tile references `s`; ownership is finalised by
 * `buildTilesFromStreets`.
 */
export function streetTiles(s: Street): TileDef[] {
  if (s.width < 1) {
    throw new Error(`[tileRegistry] streetTiles: street "${s.name}" has width=${s.width} (< 1)`);
  }
  assertGridAligned(`streetTiles(${s.name})`, s.start, s.end, s.offset);
  const out: TileDef[] = [];
  const lo = Math.min(s.start, s.end);
  const hi = Math.max(s.start, s.end);
  for (let w = 0; w < s.width; w++) {
    const perp = s.offset + w * TILE_SIZE;
    for (let m = lo; m <= hi; m += TILE_SIZE) {
      if (s.isNorthSouth) {
        out.push({ isoX: perp, isoY: m, street: s });
      } else {
        out.push({ isoX: m, isoY: perp, street: s });
      }
    }
  }
  return out;
}

// ---------------------------------------------------------------------------
// Layout data — intentionally empty (the demo layout was nuked). A future
// authored layout repopulates STREETS / stalls here.
// ---------------------------------------------------------------------------

export const STREETS: Street[] = [];

/** Unlockable stalls placed on the field. Empty until a new layout is authored. */
export const DEMO_STALLS: NightMarketAssetDef[] = [];

export const TILES: TileDef[] = buildTilesFromStreets(STREETS);

// ---------------------------------------------------------------------------
// Derived structures — built once at module load (empty while the layout is).
// ---------------------------------------------------------------------------

export const TILE_GRAPH = buildTileGraph(TILES, DEMO_STALLS);

export const TILE_MAP: Map<string, TileDef> = TILE_GRAPH.tiles;

// Coarse traversal graph: intersections-as-nodes, streets-as-edges.
export const STREET_GRAPH = buildStreetGraph(STREETS, TILES);

// ---------------------------------------------------------------------------
// Pedestrian factory (dormant — no walkers are spawned by the current page).
// ---------------------------------------------------------------------------

const defaultSprite: SpriteDef = {
  imagePath: humanImgUrl,
  scale: 1.0,
  directionalWalk: {
    north: [walkBackLeft1, walkBackLeft2],
    east: [walkBackRight1, walkBackRight2],
    south: [walkFwdRight1, walkFwdRight2],
    west: [walkFwdLeft1, walkFwdLeft2],
    fps: 6,
  },
};

export const DEMO_PEDESTRIAN_COUNT = 3;

/** Lower bound for per-pedestrian random speed; PEDESTRIAN_SPEED_ISO_PER_SEC is the upper bound. */
const MIN_PEDESTRIAN_SPEED_ISO_PER_SEC = 3;

/** Pick a random walkable tile, or iso origin when there are none (empty layout). */
function randomTile(): TileCoord {
  if (TILES.length === 0) return { isoX: 0, isoY: 0 };
  const tile = TILES[Math.floor(Math.random() * TILES.length)];
  return { isoX: tile.isoX, isoY: tile.isoY };
}

/** Random speed in [MIN_PEDESTRIAN_SPEED_ISO_PER_SEC, PEDESTRIAN_SPEED_ISO_PER_SEC]. */
function randomPedestrianSpeed(): number {
  return (
    MIN_PEDESTRIAN_SPEED_ISO_PER_SEC +
    Math.random() * (PEDESTRIAN_SPEED_ISO_PER_SEC - MIN_PEDESTRIAN_SPEED_ISO_PER_SEC)
  );
}

export function makeAmbientPedestrian(id: string, startTile: TileCoord): PedestrianState {
  return {
    id,
    sprite: defaultSprite,
    speedIsoPerSec: randomPedestrianSpeed(),
    currentTile: startTile,
    localProgress: 0,
    pendingLegs: [],
    agenda: [{ kind: 'Wander', dwellMs: 2000 }],
    fsmState: 'Idle',
    recentlyVisitedAssetIds: [],
  };
}

export function makeDemoPedestrians(count = DEMO_PEDESTRIAN_COUNT): PedestrianState[] {
  const result: PedestrianState[] = [];
  for (let i = 0; i < count; i++) {
    result.push(makeAmbientPedestrian(`ped-${i}`, randomTile()));
  }
  return result;
}
