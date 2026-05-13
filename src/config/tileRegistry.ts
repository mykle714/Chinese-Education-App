/**
 * Tile Registry — Demo Scene
 *
 * Hand-authored tile + stand layout for the night market.
 *
 * Walkable space is a set of 1×1 iso-unit tiles. Adjacent tiles (4-neighbor)
 * form the navigation graph. Each stand becomes accessible only by listing
 * its assetId in the `connections` field of one tile that sits 4-adjacent
 * to the stand's footprint tile.
 *
 * Authoring helpers `lineX` / `lineY` build a strip of tiles inclusive of
 * both endpoints (or with either endpoint excluded when a stand sits there).
 *
 * The demo reproduces the previous polyline layout:
 *   - Two straight spokes (north, west)
 *   - East bend, south Z, two dead-end spurs
 *   - Long market row with stalls on both sides
 *   - North T-junction
 *   - East and west loops returning to the market row
 */

import {
  TILE_SIZE,
  type NightMarketAssetDef,
  type PedestrianState,
  type SpriteDef,
  type TileCoord,
  type TileDef,
} from './nightMarketRegistry';
import { buildTileGraph, tileKey } from '../utils/tileGraph';
import { TILE_WIDTH } from '../utils/isometric';

// Demo stall sprites — reuse existing test assets.
import baseImgUrl from '../assets/test-assets/base.png';
import floorImgUrl from '../assets/test-assets/floor.png';
import humanImgUrl from '../assets/test-assets/human.png';
import roofImgUrl from '../assets/test-assets/roof.png';

import walkBackLeft1 from '../assets/test-assets/test-walk-animation/walk_backward_left_1.png';
import walkBackLeft2 from '../assets/test-assets/test-walk-animation/walk_backward_left_2.png';
import walkBackRight1 from '../assets/test-assets/test-walk-animation/walk_backward_right_1.png';
import walkBackRight2 from '../assets/test-assets/test-walk-animation/walk_backward_right_2.png';
import walkFwdLeft1 from '../assets/test-assets/test-walk-animation/walk_forward_left_1.png';
import walkFwdLeft2 from '../assets/test-assets/test-walk-animation/walk_forward_left_2.png';
import walkFwdRight1 from '../assets/test-assets/test-walk-animation/walk_forward_right_1.png';
import walkFwdRight2 from '../assets/test-assets/test-walk-animation/walk_forward_right_2.png';

// ---------------------------------------------------------------------------
// Tile authoring helpers
// ---------------------------------------------------------------------------

/**
 * Horizontal strip at fixed isoY from x0..x1 inclusive, emitted at stride TILE_SIZE.
 * All inputs must be TILE_SIZE multiples (dev-time check).
 */
function lineX(isoY: number, x0: number, x1: number): TileDef[] {
  assertGridAligned('lineX', isoY, x0, x1);
  const out: TileDef[] = [];
  const lo = Math.min(x0, x1);
  const hi = Math.max(x0, x1);
  for (let x = lo; x <= hi; x += TILE_SIZE) out.push({ isoX: x, isoY });
  return out;
}

/** Vertical strip at fixed isoX from y0..y1 inclusive, emitted at stride TILE_SIZE. */
function lineY(isoX: number, y0: number, y1: number): TileDef[] {
  assertGridAligned('lineY', isoX, y0, y1);
  const out: TileDef[] = [];
  const lo = Math.min(y0, y1);
  const hi = Math.max(y0, y1);
  for (let y = lo; y <= hi; y += TILE_SIZE) out.push({ isoX, isoY: y });
  return out;
}

/** Solid rectangle of tiles inclusive of both corners. Used for plazas / wide segments. */
function rect(x0: number, y0: number, x1: number, y1: number): TileDef[] {
  assertGridAligned('rect', x0, y0, x1, y1);
  const out: TileDef[] = [];
  const xLo = Math.min(x0, x1);
  const xHi = Math.max(x0, x1);
  const yLo = Math.min(y0, y1);
  const yHi = Math.max(y0, y1);
  for (let y = yLo; y <= yHi; y += TILE_SIZE) {
    for (let x = xLo; x <= xHi; x += TILE_SIZE) {
      out.push({ isoX: x, isoY: y });
    }
  }
  return out;
}

function assertGridAligned(label: string, ...values: number[]): void {
  for (const v of values) {
    if (v % TILE_SIZE !== 0) {
      throw new Error(`[tileRegistry] ${label}: value ${v} is not a multiple of TILE_SIZE=${TILE_SIZE}`);
    }
  }
}

/**
 * Merge several tile lists. Later-list connections OVERRIDE earlier ones at
 * coincident coordinates, but coordinate duplication itself is allowed because
 * walkway strips share junction tiles. Coordinates are deduplicated, with any
 * non-empty `connections` field winning.
 */
function mergeTiles(...lists: TileDef[][]): TileDef[] {
  const map = new Map<string, TileDef>();
  for (const list of lists) {
    for (const t of list) {
      const key = tileKey(t.isoX, t.isoY);
      const existing = map.get(key);
      if (!existing) {
        map.set(key, { ...t });
        continue;
      }
      // Merge connections (union of both).
      const merged: TileDef = { ...existing };
      const conns = new Set([...(existing.connections ?? []), ...(t.connections ?? [])]);
      if (conns.size > 0) merged.connections = Array.from(conns);
      if (t.speedIsoPerSec !== undefined) merged.speedIsoPerSec = t.speedIsoPerSec;
      map.set(key, merged);
    }
  }
  return Array.from(map.values());
}

/** Attach `connections` to a single tile coordinate. Used to overlay onto a strip. */
function connectTile(isoX: number, isoY: number, ...assetIds: string[]): TileDef {
  return { isoX, isoY, connections: assetIds };
}

// ---------------------------------------------------------------------------
// Walkable tiles — reproduce the existing demo as discrete strips.
//
// Endpoint tiles that previously hosted a stand (e.g. wk-north terminating at
// (0,-40) where demo-stall-north sat) are EXCLUDED from the strip — the stand
// now sits at a dedicated footprint tile one step further out, and the strip's
// last walkable tile carries the `connections`.
// ---------------------------------------------------------------------------

// Spokes from the central hub at (0,0). Hub tile is shared by every spoke.
const STRIP_NORTH = lineY(0, 0, -40);          // (0,0)..(0,-40) — T at (0,-40)
const STRIP_WEST = lineX(0, 0, -50);           // (0,0)..(-50,0) — junction at (-50,0)
const STRIP_EAST_TO_BEND = lineX(0, 0, 50);    // (0,0)..(50,0) — bend at (50,0)
const STRIP_EAST_STUB = lineY(50, 0, 5);       // (50,0)..(50,5); stand at (50,10) is one tile beyond

// South Z: hub → (0,20) junction → (20,20) junction.
const STRIP_SOUTH_TO_NODE = lineY(0, 0, 20);
const STRIP_SOUTH_CROSS = lineX(20, 0, 20);

// Spurs off the (20,20) junction. Each ends one tile short of its terminating stand.
const STRIP_SE_SPUR = lineX(20, 20, 30);       // stand at (35,20)
const STRIP_S_SPUR = lineY(20, 20, 35);        // stand at (20,40)

// South extension and market row.
const STRIP_SOUTH_EXT = lineY(0, 20, 60);      // (0,20)..(0,60) — junction at (0,60)
const STRIP_MARKET_ROW = lineX(60, 0, 80);     // (0,60)..(80,60) — junctions at both ends

// North T-junction at (0,-40) splits east/west.
const STRIP_N_CROSS_WEST = lineX(-40, 0, -30); // (0,-40)..(-30,-40)
const STRIP_N_CROSS_EAST = lineX(-40, 0, 30);  // (0,-40)..(30,-40)

// East loop.
const STRIP_E_PROM_EXT = lineX(0, 50, 80);     // (50,0)..(80,0)
const STRIP_E_RETURN = lineY(80, 0, 60);       // (80,0)..(80,60)

// West loop.
const STRIP_W_RETURN = lineY(-50, 0, 60);      // (-50,0)..(-50,60)
const STRIP_W_ROW_EXT = lineX(60, -50, 0);     // (-50,60)..(0,60)

// ---------------------------------------------------------------------------
// Variable-thickness areas — exercise the 4-neighbor graph beyond 1-tile lanes.
// These strips OVERLAP the line strips above; mergeTiles dedupes by coordinate
// so the resulting walkable set is the union.
// ---------------------------------------------------------------------------

// Central hub plaza: 3×3 block centered on (0,0). At TILE_SIZE=5 this spans
// iso (-5,-5) to (5,5) — 15×15 iso. Touches the four spokes at their
// hub-end tiles so the spokes still connect through the plaza interior.
const PLAZA_HUB = rect(-5, -5, 5, 5);

// South extension widened to 3 tiles (isoX = -5, 0, 5) over isoY=25..45.
// Stops short of y=50 so it doesn't collide with the 2×2 footprints of
// market-row stalls that extend down to y=50.
const SOUTH_EXT_WIDE = rect(-5, 25, 5, 45);

// Connection overlays — one per stand, placed on the tile that fronts it.
// Each connecting tile is at TILE_SIZE distance from its stand's footprint.
const CONNECTION_OVERLAYS: TileDef[] = [
  // Endpoint stalls — placed two tiles beyond the junction so the 2×2
  // footprint clears all walkable strips.
  connectTile(0, -40, 'demo-stall-north'),
  connectTile(-50, 0, 'demo-stall-west'),
  connectTile(50, 5, 'demo-stall-east'),
  connectTile(30, 20, 'demo-stall-se'),
  connectTile(20, 35, 'demo-stall-s'),

  // Market row stalls. Connecting tiles all lie on the row at isoY=60.
  // The footprints sit one tile further out: north side at isoY=50..55,
  // south side at isoY=65..70.
  connectTile(10, 60, 'market-stall-1'),
  connectTile(20, 60, 'market-stall-2'),
  connectTile(30, 60, 'market-stall-3'),
  connectTile(40, 60, 'market-stall-4', 'market-stall-4-north'),
  connectTile(50, 60, 'market-stall-5'),
  connectTile(60, 60, 'market-stall-6'),
  connectTile(70, 60, 'market-stall-7'),
  connectTile(80, 60, 'market-stall-8'),

  // North cross-street stalls (north side of isoY=-40 row).
  connectTile(-20, -40, 'demo-stall-nw'),
  connectTile(20, -40, 'demo-stall-ne'),

  // East promenade extension.
  connectTile(65, 0, 'demo-stall-east-promenade'),

  // East return lane.
  connectTile(80, 20, 'demo-stall-east-return-n'),
  connectTile(80, 40, 'demo-stall-east-return-s'),

  // West return lane.
  connectTile(-50, 20, 'demo-stall-west-return-n'),
  connectTile(-50, 40, 'demo-stall-west-return-s'),

  // Market row west extension.
  connectTile(-25, 60, 'market-stall-west-ext'),
];

export const TILES: TileDef[] = mergeTiles(
  STRIP_NORTH,
  STRIP_WEST,
  STRIP_EAST_TO_BEND,
  STRIP_EAST_STUB,
  STRIP_SOUTH_TO_NODE,
  STRIP_SOUTH_CROSS,
  STRIP_SE_SPUR,
  STRIP_S_SPUR,
  STRIP_SOUTH_EXT,
  STRIP_MARKET_ROW,
  STRIP_N_CROSS_WEST,
  STRIP_N_CROSS_EAST,
  STRIP_E_PROM_EXT,
  STRIP_E_RETURN,
  STRIP_W_RETURN,
  STRIP_W_ROW_EXT,
  PLAZA_HUB,
  SOUTH_EXT_WIDE,
  CONNECTION_OVERLAYS,
);

// ---------------------------------------------------------------------------
// Demo stalls — footprints are the rounded (isoX, isoY) of each stand and
// must be 4-adjacent to that stand's connecting tile (validated by buildTileGraph).
// ---------------------------------------------------------------------------

const makeStallLayers = (groupId: string): NightMarketAssetDef['layers'] => [
  { imagePath: floorImgUrl, slot: 'background', groupId },
  { imagePath: humanImgUrl, slot: 'entity', groupId: `${groupId}-merchant` },
  { imagePath: baseImgUrl, slot: 'foreground', groupId },
  { imagePath: roofImgUrl, slot: 'foreground', groupId },
];

/**
 * Build the 2×2 footprint for a stand whose anchor (isoX, isoY) is the
 * SW corner of the block — the tile with the LOWEST isoX and LOWEST isoY,
 * which projects to the BOTTOM vertex of the footprint diamond on screen.
 *
 * With the sprite anchor at (0.5, 1.0), placing the sprite at the SW corner
 * makes its base sit on the footprint's bottom vertex and rise upward over
 * the rest of the footprint — matching how a building stands on its tiles.
 *
 * Footprint extends NE: { (X, Y), (X+T, Y), (X, Y+T), (X+T, Y+T) }.
 */
function footprint2x2(swX: number, swY: number): TileCoord[] {
  return [
    { isoX: swX, isoY: swY },
    { isoX: swX + TILE_SIZE, isoY: swY },
    { isoX: swX, isoY: swY + TILE_SIZE },
    { isoX: swX + TILE_SIZE, isoY: swY + TILE_SIZE },
  ];
}

// Convention for 2×2 stalls:
//   (isoX, isoY) is the SW corner of the footprint — the tile with the lowest
//   isoX and lowest isoY, which projects to the BOTTOM vertex of the footprint
//   diamond on screen. The sprite anchor (0.5, 1.0) sits there so the building
//   visually rises up over the footprint. The footprint extends NE.
//
//   Footprint tiles must NOT coincide with any walkable tile; at least one of
//   them must be 4-adjacent to the connection tile in CONNECTION_OVERLAYS.
export const DEMO_STALLS: NightMarketAssetDef[] = [
  // Endpoint stalls.
  {
    assetId: 'demo-stall-north',
    unlockType: 'stall',
    displayName: 'Lantern Shop',
    description: 'At the north end of the plaza.',
    layers: makeStallLayers('demo-stall-north'),
    isoX: -5, isoY: -50, scale: 1.0,
    footprint: footprint2x2(-5, -50),
  },
  {
    assetId: 'demo-stall-west',
    unlockType: 'stall',
    displayName: 'Tea House',
    description: 'At the west end of the plaza.',
    layers: makeStallLayers('demo-stall-west'),
    isoX: -60, isoY: -5, scale: 1.0,
    footprint: footprint2x2(-60, -5),
  },
  {
    assetId: 'demo-stall-east',
    unlockType: 'stall',
    displayName: 'Fish Monger',
    description: 'At the far end of the east stall row.',
    layers: makeStallLayers('demo-stall-east'),
    isoX: 45, isoY: 10, scale: 1.0,
    footprint: footprint2x2(45, 10),
  },
  {
    assetId: 'demo-stall-se',
    unlockType: 'stall',
    displayName: 'Spice Merchant',
    description: 'Down the SE alley.',
    layers: makeStallLayers('demo-stall-se'),
    isoX: 35, isoY: 15, scale: 1.0,
    footprint: footprint2x2(35, 15),
  },
  {
    assetId: 'demo-stall-s',
    unlockType: 'stall',
    displayName: 'Silk Weaver',
    description: 'Down the S alley.',
    layers: makeStallLayers('demo-stall-s'),
    isoX: 15, isoY: 40, scale: 1.0,
    footprint: footprint2x2(15, 40),
  },

  // Market row stalls. North-side SW anchors at isoY=50, south-side at isoY=65.
  { assetId: 'market-stall-1', unlockType: 'stall', displayName: 'Jade Jeweller',
    description: 'Fine jade ornaments and pendants.',
    layers: makeStallLayers('market-stall-1'), isoX: 5, isoY: 50, scale: 1.0,
    footprint: footprint2x2(5, 50) },
  { assetId: 'market-stall-2', unlockType: 'stall', displayName: 'Dumpling House',
    description: 'Steamed dumplings, fresh every hour.',
    layers: makeStallLayers('market-stall-2'), isoX: 15, isoY: 65, scale: 1.0,
    footprint: footprint2x2(15, 65) },
  { assetId: 'market-stall-3', unlockType: 'stall', displayName: 'Ink & Brush',
    description: 'Calligraphy supplies and handmade scrolls.',
    layers: makeStallLayers('market-stall-3'), isoX: 25, isoY: 50, scale: 1.0,
    footprint: footprint2x2(25, 50) },
  { assetId: 'market-stall-4', unlockType: 'stall', displayName: 'Lotus Tea',
    description: 'Rare teas sourced from mountain gardens.',
    layers: makeStallLayers('market-stall-4'), isoX: 35, isoY: 65, scale: 1.0,
    footprint: footprint2x2(35, 65) },
  { assetId: 'market-stall-4-north', unlockType: 'stall', displayName: 'Lotus Tea North',
    description: 'Across from Lotus Tea.',
    layers: makeStallLayers('market-stall-4-north'), isoX: 35, isoY: 50, scale: 1.0,
    footprint: footprint2x2(35, 50) },
  { assetId: 'market-stall-5', unlockType: 'stall', displayName: 'Dragon Kites',
    description: 'Handpainted kites in every shape.',
    layers: makeStallLayers('market-stall-5'), isoX: 45, isoY: 50, scale: 1.0,
    footprint: footprint2x2(45, 50) },
  { assetId: 'market-stall-6', unlockType: 'stall', displayName: 'Five Spice Grill',
    description: 'Skewers grilled over charcoal.',
    layers: makeStallLayers('market-stall-6'), isoX: 55, isoY: 65, scale: 1.0,
    footprint: footprint2x2(55, 65) },
  { assetId: 'market-stall-7', unlockType: 'stall', displayName: 'Paper Lanterns',
    description: 'Lanterns of every colour and size.',
    layers: makeStallLayers('market-stall-7'), isoX: 65, isoY: 50, scale: 1.0,
    footprint: footprint2x2(65, 50) },
  { assetId: 'market-stall-8', unlockType: 'stall', displayName: 'Fortune Teller',
    description: 'Wisdom from the stars, for a small fee.',
    layers: makeStallLayers('market-stall-8'), isoX: 75, isoY: 65, scale: 1.0,
    footprint: footprint2x2(75, 65) },

  // North cross-street stalls (row at isoY=-40). SW anchors at isoY=-50.
  { assetId: 'demo-stall-nw', unlockType: 'stall', displayName: 'Moon Cake Bakery',
    description: 'At the west arm of the north cross.',
    layers: makeStallLayers('demo-stall-nw'), isoX: -25, isoY: -50, scale: 1.0,
    footprint: footprint2x2(-25, -50) },
  { assetId: 'demo-stall-ne', unlockType: 'stall', displayName: 'Bamboo Flute Maker',
    description: 'At the east arm of the north cross.',
    layers: makeStallLayers('demo-stall-ne'), isoX: 15, isoY: -50, scale: 1.0,
    footprint: footprint2x2(15, -50) },

  // East promenade ext (row at isoY=0).
  { assetId: 'demo-stall-east-promenade', unlockType: 'stall', displayName: 'Copper Smith',
    description: 'Along the east promenade.',
    layers: makeStallLayers('demo-stall-east-promenade'), isoX: 60, isoY: -10, scale: 1.0,
    footprint: footprint2x2(60, -10) },

  // East return lane (vertical at isoX=80).
  { assetId: 'demo-stall-east-return-n', unlockType: 'stall', displayName: 'Incense House',
    description: 'Upper east return lane.',
    layers: makeStallLayers('demo-stall-east-return-n'), isoX: 85, isoY: 15, scale: 1.0,
    footprint: footprint2x2(85, 15) },
  { assetId: 'demo-stall-east-return-s', unlockType: 'stall', displayName: 'Porcelain Works',
    description: 'Lower east return lane.',
    layers: makeStallLayers('demo-stall-east-return-s'), isoX: 70, isoY: 35, scale: 1.0,
    footprint: footprint2x2(70, 35) },

  // West return lane (vertical at isoX=-50).
  { assetId: 'demo-stall-west-return-n', unlockType: 'stall', displayName: 'Herbalist',
    description: 'Upper west return lane.',
    layers: makeStallLayers('demo-stall-west-return-n'), isoX: -60, isoY: 15, scale: 1.0,
    footprint: footprint2x2(-60, 15) },
  { assetId: 'demo-stall-west-return-s', unlockType: 'stall', displayName: 'Wood Carver',
    description: 'Lower west return lane.',
    layers: makeStallLayers('demo-stall-west-return-s'), isoX: -45, isoY: 35, scale: 1.0,
    footprint: footprint2x2(-45, 35) },

  // Market row west extension — SW anchor at (-30, 50).
  { assetId: 'market-stall-west-ext', unlockType: 'stall', displayName: 'Night Noodles',
    description: 'West end of market row.',
    layers: makeStallLayers('market-stall-west-ext'), isoX: -30, isoY: 50, scale: 1.0,
    footprint: footprint2x2(-30, 50) },
];

// ---------------------------------------------------------------------------
// Derived structures — built once at module load.
// ---------------------------------------------------------------------------

export const TILE_GRAPH = buildTileGraph(TILES, DEMO_STALLS);

export const TILE_MAP: Map<string, TileDef> = TILE_GRAPH.tiles;

// Floor tile sprite — every walkable tile renders this.
export const FLOOR_TILE_IMAGE_PATH = floorImgUrl;

// Source width of floor.png in pixels. The asset is a square containing a
// near-full-bleed isometric diamond. One tile spans TILE_SIZE iso units, which
// is TILE_SIZE * TILE_WIDTH px wide on screen, so the sprite scale is
// (TILE_SIZE * TILE_WIDTH) / source-width.
const FLOOR_SOURCE_WIDTH_PX = 1080;
export const FLOOR_TILE_SCALE = (TILE_SIZE * TILE_WIDTH) / FLOOR_SOURCE_WIDTH_PX;

// ---------------------------------------------------------------------------
// Pedestrian factory.
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

/** Pick a random walkable tile from the registry. */
function randomTile(): TileCoord {
  const tile = TILES[Math.floor(Math.random() * TILES.length)];
  return { isoX: tile.isoX, isoY: tile.isoY };
}

export function makeAmbientPedestrian(id: string, startTile: TileCoord): PedestrianState {
  return {
    id,
    sprite: defaultSprite,
    currentTile: startTile,
    localProgress: 0,
    pendingPath: [],
    agenda: [{ kind: 'Wander', dwellMs: 1500 }],
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
