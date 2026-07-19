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

// Pedestrian sprites — the free-farm player art (two character sets: male /
// female), each a 4-frame walk cycle in 4 cardinal directions. Indexed by the
// shared FreeFarmTileset singleton (same pack that draws the terrain).
import { freeFarmTileset, type Direction, type PlayerGender } from './freeFarmTileset';

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

/** Walk-cycle frame rate shared by both pedestrian variants. */
const WALK_FPS = 6;

/**
 * Build a pedestrian {@link SpriteDef} from one farm-pack character set.
 *
 * The pack ships 4-cardinal-direction art (`n`/`e`/`s`/`w`); the engine's iso
 * headings map onto those facings 1:1. This matches `isoToScreen`'s axes
 * (E = top-right, N = top-left, S = bottom-right, W = bottom-left) and the
 * `DirectionalWalkAnimation` semantics (north = backward/away, south =
 * forward/toward the camera):
 *   north → 'n' (facing away)     east → 'e' (facing screen-right)
 *   south → 's' (facing camera)   west → 'w' (facing screen-left)
 *
 * Frames render at native scale (1.0) — the pack is authored for the same
 * 32px tile grid the terrain uses, and the camera does the integer zoom.
 */
function makeFarmSprite(gender: PlayerGender): SpriteDef {
  const framesFor = (d: Direction): string[] => freeFarmTileset.getWalkFrames(gender, d);
  return {
    // Idle pose = first south-facing frame (character facing the camera).
    imagePath: framesFor('s')[0],
    scale: 1.0,
    directionalWalk: {
      north: framesFor('n'),
      east: framesFor('e'),
      south: framesFor('s'),
      west: framesFor('w'),
      fps: WALK_FPS,
    },
  };
}

/** Pedestrian character variant — one of the farm pack's two player sets. */
export type PedestrianVariant = PlayerGender;

/** The two pedestrian variants, resolved to concrete sprite defs once at load. */
export const PEDESTRIAN_SPRITES: Record<PedestrianVariant, SpriteDef> = {
  male: makeFarmSprite('male'),
  female: makeFarmSprite('female'),
};

export const PEDESTRIAN_VARIANTS: PedestrianVariant[] = ['male', 'female'];

/**
 * Every sprite frame any pedestrian variant can render (idle + all directional walk frames,
 * both character sets). The renderer ({@link ../../features/nightmarket/PedestrianLayer})
 * preloads these as textures so `PedestrianDrawable.imagePath` — which names the CURRENT
 * animation frame — always resolves. Derived from {@link PEDESTRIAN_SPRITES} so it stays in
 * sync with the sprite definitions.
 */
export const PEDESTRIAN_SPRITE_PATHS: string[] = (() => {
  const paths = new Set<string>();
  for (const sprite of Object.values(PEDESTRIAN_SPRITES)) {
    paths.add(sprite.imagePath);
    const walk = sprite.directionalWalk;
    if (walk) {
      for (const f of [...walk.north, ...walk.east, ...walk.south, ...walk.west]) paths.add(f);
    }
  }
  return [...paths];
})();

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

/** Pick one of the two pedestrian character variants at random. */
function randomVariant(): PedestrianVariant {
  return PEDESTRIAN_VARIANTS[Math.floor(Math.random() * PEDESTRIAN_VARIANTS.length)];
}

export function makeAmbientPedestrian(
  id: string,
  startTile: TileCoord,
  variant: PedestrianVariant = randomVariant(),
): PedestrianState {
  return {
    id,
    sprite: PEDESTRIAN_SPRITES[variant],
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
