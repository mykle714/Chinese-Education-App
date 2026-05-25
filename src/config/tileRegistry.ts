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
 * Walkways are authored as `Street` records (see below) and expanded into
 * tile lists via `streetTiles`.
 *
 * The demo reproduces the previous polyline layout:
 *   - Two straight spokes (north, west)
 *   - East bend, south Z, two dead-end spurs
 *   - Long market row with stalls on both sides
 *   - North T-junction
 *   - East and west loops returning to the market row
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
import { buildTileGraph, tileKey } from '../utils/tileGraph';
import { buildStreetGraph } from '../utils/streetGraph';
import { TILE_WIDTH } from '../utils/isometric';

// Stall sprite layers — reuse existing test assets.
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

function assertGridAligned(label: string, ...values: number[]): void {
  for (const v of values) {
    if (v % TILE_SIZE !== 0) {
      throw new Error(`[tileRegistry] ${label}: value ${v} is not a multiple of TILE_SIZE=${TILE_SIZE}`);
    }
  }
}

/**
 * Expand a street into its tiles in priority order, building the final TILES
 * array. Streets are sorted thickest-first, with NS before EW on ties. The
 * first street to claim a coordinate slot wins; later streets skip that slot.
 * This means narrower streets can appear non-contiguous at intersections, but
 * all coordinates are present in the output exactly once.
 */
function buildTilesFromStreets(streets: Street[]): TileDef[] {
  const sorted = [...streets].sort((a, b) => {
    if (b.width !== a.width) return b.width - a.width;           // thickest first
    if (a.isNorthSouth !== b.isNorthSouth) return a.isNorthSouth ? -1 : 1; // NS before EW
    return 0;
  });
  const claimed = new Map<string, TileDef>();
  // Every street that wanted a given coord, in priority order (winner first).
  // Tiles whose claim list has length >= 2 are intersection tiles.
  const allClaimants = new Map<string, Street[]>();
  for (const street of sorted) {
    for (const tile of streetTiles(street)) {
      const key = tileKey(tile.isoX, tile.isoY);
      const list = allClaimants.get(key);
      if (list) {
        list.push(street);
      } else {
        allClaimants.set(key, [street]);
        claimed.set(key, tile); // first (priority winner) gets visual ownership
      }
    }
  }
  // Attach the full claimant list to each winning tile for street-graph use.
  for (const [key, tile] of claimed) {
    tile.intersectingStreets = allClaimants.get(key);
  }
  return Array.from(claimed.values());
}

/**
 * Expand a Street into the dense set of TileDefs it covers. Endpoints of the
 * primary-axis range are inclusive on both ends. Each tile carries a `street`
 * reference back to `s`; ownership is finalised by `buildTilesFromStreets`.
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
// Walkable tiles — the demo layout, expressed as named streets.
// ---------------------------------------------------------------------------

// Widths are scaled from each street's length: width = clamp(round(length/10), 1, 8).
// Streets that were colinear (same orientation + offset) and touching have been
// merged into the bigger of the two, keeping its name and width.
// Global translation applied to every authored street + stand position. Lets us
// shift the entire market in iso space without editing every literal coordinate.
// (+isoX = east, +isoY = north; so a southward shift is a NEGATIVE isoY delta.)
const SHIFT_ISO_X = 25;
const SHIFT_ISO_Y = -25;

const RAW_STREETS: Street[] = [
  // Main N–S axis through the hub: merged North Spoke + South Spoke (upper+lower).
  { name: 'North Spoke',        isNorthSouth: true,  start: -40, end: 60,  offset: 0,   width: 4 },
  // Main E–W axis through the hub: merged West Spoke + East Promenade + East Promenade Ext.
  { name: 'West Spoke',         isNorthSouth: false, start: -50, end: 80,  offset: 0,   width: 5 },

  // East-side stub off the main E–W axis.
  { name: 'East Stub',          isNorthSouth: true,  start: 0,   end: 5,   offset: 50,  width: 1 },

  // South cross + SE spur, now continuous.
  { name: 'South Cross',        isNorthSouth: false, start: 0,   end: 30,  offset: 20,  width: 2 },
  { name: 'South Spur',         isNorthSouth: true,  start: 20,  end: 35,  offset: 20,  width: 2 },

  // Market row, extended in both directions to accommodate scattered stalls.
  { name: 'Market Row',         isNorthSouth: false, start: -100, end: 130, offset: 60,  width: 8 },

  // North T-junction merged into a single cross-street.
  { name: 'North Cross (west)', isNorthSouth: false, start: -30, end: 30,  offset: -40, width: 3 },

  // Return lanes (unchanged).
  { name: 'East Return',        isNorthSouth: true,  start: 0,   end: 60,  offset: 80,  width: 6 },
  { name: 'West Return',        isNorthSouth: true,  start: 0,   end: 60,  offset: -50, width: 6 },
];

// ---------------------------------------------------------------------------
// Demo stalls
//
// Each stand has an 8×8 footprint anchored at its SW corner (lowest isoX/isoY,
// projecting to the BOTTOM vertex of the footprint diamond on screen). The
// connection tile must be 4-adjacent at T=1 to one of the footprint tiles and
// must itself be walkable. `applyConnections` writes the assetId onto the
// matching walkable tile after streets are expanded.
// ---------------------------------------------------------------------------

const STALL_FOOTPRINT_TILES = 8;
const STALL_SPRITE_SCALE = 0.875;

function stallFootprint(swX: number, swY: number): TileCoord[] {
  const out: TileCoord[] = [];
  for (let dy = 0; dy < STALL_FOOTPRINT_TILES; dy++) {
    for (let dx = 0; dx < STALL_FOOTPRINT_TILES; dx++) {
      out.push({ isoX: swX + dx, isoY: swY + dy });
    }
  }
  return out;
}

const makeStallLayers = (groupId: string): NightMarketAssetDef['layers'] => [
  { imagePath: floorImgUrl, slot: 'background', groupId },
  { imagePath: humanImgUrl, slot: 'entity', groupId: `${groupId}-merchant` },
  { imagePath: baseImgUrl, slot: 'foreground', groupId },
  { imagePath: roofImgUrl, slot: 'foreground', groupId },
];

interface StandSpec {
  assetId: string;
  displayName: string;
  description: string;
  /** SW corner of the 8×8 footprint. */
  swX: number;
  swY: number;
  /** Walkable connection tile (must be 4-adjacent to a footprint tile). */
  connX: number;
  connY: number;
}

const RAW_STAND_SPECS: StandSpec[] = [
  // ─── Market Row, south side (footprint y=52..59, conn at y=60) ───────────
  // (+isoY = north on screen, so lower isoY values draw further south.)
  { assetId: 'mn-lantern-maker',   displayName: 'Lantern Maker',       description: 'Far west of the market row.',       swX: -95, swY: 52, connX: -95, connY: 60 },
  { assetId: 'mn-night-noodles',   displayName: 'Night Noodles',       description: 'Steaming bowls served past midnight.', swX: -80, swY: 52, connX: -80, connY: 60 },
  { assetId: 'mn-jade-jeweller',   displayName: 'Jade Jeweller',       description: 'Fine jade ornaments and pendants.', swX: -65, swY: 52, connX: -65, connY: 60 },
  { assetId: 'mn-mooncake',        displayName: 'Moon Cake Bakery',    description: 'Pastries by the lunar calendar.',   swX: -30, swY: 52, connX: -30, connY: 60 },
  { assetId: 'mn-dragon-kites',    displayName: 'Dragon Kites',        description: 'Handpainted kites in every shape.', swX: 5,   swY: 52, connX: 5,   connY: 60 },
  { assetId: 'mn-paper-lanterns',  displayName: 'Paper Lanterns',      description: 'Lanterns of every colour and size.', swX: 20,  swY: 52, connX: 20,  connY: 60 },
  { assetId: 'mn-ink-brush',       displayName: 'Ink & Brush',         description: 'Calligraphy supplies and scrolls.', swX: 40,  swY: 52, connX: 40,  connY: 60 },
  { assetId: 'mn-fortune-teller',  displayName: 'Fortune Teller',      description: 'Wisdom from the stars, for a fee.', swX: 55,  swY: 52, connX: 55,  connY: 60 },
  { assetId: 'mn-copper-smith',    displayName: 'Copper Smith',        description: 'Pots, kettles, hammered by hand.',  swX: 95,  swY: 52, connX: 95,  connY: 60 },
  { assetId: 'mn-bamboo-flute',    displayName: 'Bamboo Flute Maker',  description: 'Reedy notes from carved bamboo.',   swX: 115, swY: 52, connX: 115, connY: 60 },

  // ─── Market Row, north side (footprint y=68..75, conn at y=67) ───────────
  { assetId: 'ms-dumpling',        displayName: 'Dumpling House',      description: 'Steamed dumplings, fresh every hour.', swX: -95, swY: 68, connX: -95, connY: 67 },
  { assetId: 'ms-lotus-tea',       displayName: 'Lotus Tea',           description: 'Rare teas from mountain gardens.',   swX: -75, swY: 68, connX: -75, connY: 67 },
  { assetId: 'ms-fish-monger',     displayName: 'Fish Monger',         description: 'River fish on ice.',                  swX: -55, swY: 68, connX: -55, connY: 67 },
  { assetId: 'ms-spice-merchant',  displayName: 'Spice Merchant',      description: 'Sacks of star anise and peppercorn.', swX: -30, swY: 68, connX: -30, connY: 67 },
  { assetId: 'ms-silk-weaver',     displayName: 'Silk Weaver',         description: 'Bolts of patterned silk.',           swX: -10, swY: 68, connX: -10, connY: 67 },
  { assetId: 'ms-five-spice',      displayName: 'Five Spice Grill',    description: 'Skewers grilled over charcoal.',     swX: 10,  swY: 68, connX: 10,  connY: 67 },
  { assetId: 'ms-tea-house',       displayName: 'Tea House',           description: 'Quiet pots and small tables.',       swX: 30,  swY: 68, connX: 30,  connY: 67 },
  { assetId: 'ms-wood-carver',     displayName: 'Wood Carver',         description: 'Whittled animals and beads.',        swX: 50,  swY: 68, connX: 50,  connY: 67 },
  { assetId: 'ms-porcelain',       displayName: 'Porcelain Works',     description: 'Blue-white pieces, wheel-thrown.',   swX: 70,  swY: 68, connX: 70,  connY: 67 },
  { assetId: 'ms-herbalist',       displayName: 'Herbalist',           description: 'Dried herbs by the gram.',           swX: 90,  swY: 68, connX: 90,  connY: 67 },
  { assetId: 'ms-incense',         displayName: 'Incense House',       description: 'Sandalwood and agarwood sticks.',    swX: 110, swY: 68, connX: 110, connY: 67 },

  // ─── West Return (x=-50..-45), stalls on the west side ──────────────────
  { assetId: 'wr-mountain-tea',    displayName: 'Mountain Tea',        description: 'Above the misty stalls.',           swX: -58, swY: 15, connX: -50, connY: 15 },
  { assetId: 'wr-salt-trader',     displayName: 'Salt Trader',         description: 'Sea and rock salt by weight.',      swX: -58, swY: 30, connX: -50, connY: 30 },
  { assetId: 'wr-jade-carver',     displayName: 'Jade Carver',         description: 'Carved pendants for sale.',          swX: -58, swY: 42, connX: -50, connY: 42 },

  // ─── East Return (x=80..85), stalls on the east side ───────────────────
  { assetId: 'er-star-reader',     displayName: 'Star Reader',         description: 'Charts the night sky for visitors.', swX: 86,  swY: 10, connX: 85,  connY: 10 },
  { assetId: 'er-coin-polisher',   displayName: 'Coin Polisher',       description: 'Antique cash coins, restored.',      swX: 86,  swY: 30, connX: 85,  connY: 30 },
  { assetId: 'er-brass-bell',      displayName: 'Brass Bell',          description: 'Hand-cast bells of every size.',     swX: 86,  swY: 50, connX: 85,  connY: 50 },

  // ─── West Spoke (y=0..4), stalls north and south of the main avenue ────
  { assetId: 'wn-lacquerware',     displayName: 'Lacquerware',         description: 'Glossy red and black trays.',        swX: -40, swY: -8, connX: -40, connY: 0 },
  { assetId: 'wn-iron-smith',      displayName: 'Iron Smith',          description: 'Knives, tongs, and hooks.',          swX: -20, swY: -8, connX: -20, connY: 0 },
  { assetId: 'es-tobacco',         displayName: 'Tobacco Stall',       description: 'Pressed leaf and slim pipes.',       swX: 51,  swY: 5,  connX: 50, connY: 5 },

  { assetId: 'ws-bone-carver',     displayName: 'Bone Carver',         description: 'Pins, needles, combs.',              swX: -30, swY: 5,  connX: -30, connY: 4 },
  { assetId: 'ws-persimmon',       displayName: 'Persimmon Stand',     description: 'Sun-dried and fresh.',               swX: -15, swY: 5,  connX: -15, connY: 4 },
  { assetId: 'ws-cloud-tea',       displayName: 'Cloud Tea',           description: 'High-mountain white tea.',           swX: 5,   swY: 5,  connX: 5,   connY: 4 },
  { assetId: 'ws-saddle-maker',    displayName: 'Saddle Maker',        description: 'Leather goods for horse and ox.',    swX: 35,  swY: 5,  connX: 35,  connY: 4 },
  { assetId: 'ws-brushwood',       displayName: 'Brushwood',           description: 'Tied bundles for kitchen fires.',    swX: 60,  swY: 5,  connX: 60,  connY: 4 },
  { assetId: 'ws-coal-seller',     displayName: 'Coal Seller',         description: 'Hardwood coal by the sack.',         swX: 70,  swY: 5,  connX: 70,  connY: 4 },

  // ─── North Spoke (x=0..3), stalls east and west ────────────────────────
  { assetId: 'ne-paper-maker',     displayName: 'Paper Maker',         description: 'Mulberry-fibre sheets.',             swX: 4,   swY: -33, connX: 3,   connY: -33 },
  { assetId: 'ne-bronze-forge',    displayName: 'Bronze Forge',        description: 'Cast incense burners.',              swX: 4,   swY: -20, connX: 3,   connY: -20 },
  { assetId: 'ne-cricket-cages',   displayName: 'Cricket Cages',       description: 'Tiny woven homes for crickets.',     swX: 4,   swY: -12, connX: 3,   connY: -12 },
  { assetId: 'ne-bamboo-crafts',   displayName: 'Bamboo Crafts',       description: 'Baskets, mats, and steamers.',       swX: 4,   swY: 25,  connX: 3,   connY: 25 },
  { assetId: 'ne-knife-sharpener', displayName: 'Knife Sharpener',     description: 'Brings your blade back to a edge.',  swX: 4,   swY: 40,  connX: 3,   connY: 40 },

  { assetId: 'nw-tea-master',      displayName: 'Tea Master',          description: 'Pours by appointment.',              swX: -8,  swY: -33, connX: 0,   connY: -33 },
  { assetId: 'nw-silver-smith',    displayName: 'Silver Smith',        description: 'Filigree pins and earrings.',        swX: -8,  swY: -11, connX: 0,   connY: -11 },
  { assetId: 'nw-goldfish',        displayName: 'Goldfish Seller',     description: 'Bowls of orange-red fish.',          swX: -8,  swY: 25,  connX: 0,   connY: 25 },
  { assetId: 'nw-drum-maker',      displayName: 'Drum Maker',          description: 'Skinned barrel drums.',              swX: -8,  swY: 40,  connX: 0,   connY: 40 },

  // ─── South Cross (y=20..21), stalls north and south ────────────────────
  { assetId: 'sc-tile-glazer',     displayName: 'Tile Glazer',         description: 'Fired roof tiles, jewel-glazed.',    swX: 20,  swY: 12,  connX: 20,  connY: 20 },

  // ─── South Spur (x=20..21), stalls east and west ───────────────────────
  { assetId: 'sp-kite-painter',    displayName: 'Kite Painter',        description: 'Custom dragons on paper kites.',     swX: 22,  swY: 30,  connX: 21,  connY: 30 },

  // ─── North Cross (y=-40..-38), stalls on either side ──────────────────
  { assetId: 'nc-sutra-scribe',    displayName: 'Sutra Scribe',        description: 'Copies sacred texts on order.',      swX: -25, swY: -48, connX: -25, connY: -40 },
  { assetId: 'nc-inkstone',        displayName: 'Inkstone',            description: 'Carved stones for grinding ink.',    swX: 10,  swY: -48, connX: 10,  connY: -40 },
  { assetId: 'ncs-bird-cage',      displayName: 'Bird Cage',           description: 'Bamboo cages, fittings included.',   swX: -25, swY: -37, connX: -25, connY: -38 },
  { assetId: 'ncs-fan-maker',      displayName: 'Fan Maker',           description: 'Folding and round fans.',            swX: 15,  swY: -37, connX: 15,  connY: -38 },
];

// Apply the global shift. For streets, start/end run along the primary axis and
// offset runs along the perpendicular — but a uniform (+isoX, +isoY) translation
// adds the same shift to start, end, and offset regardless of orientation.
export const STREETS: Street[] = RAW_STREETS.map(s => ({
  ...s,
  start:  s.start  + (s.isNorthSouth ? SHIFT_ISO_Y : SHIFT_ISO_X),
  end:    s.end    + (s.isNorthSouth ? SHIFT_ISO_Y : SHIFT_ISO_X),
  offset: s.offset + (s.isNorthSouth ? SHIFT_ISO_X : SHIFT_ISO_Y),
}));

const STAND_SPECS: StandSpec[] = RAW_STAND_SPECS.map(spec => ({
  ...spec,
  swX:   spec.swX   + SHIFT_ISO_X,
  swY:   spec.swY   + SHIFT_ISO_Y,
  connX: spec.connX + SHIFT_ISO_X,
  connY: spec.connY + SHIFT_ISO_Y,
}));

export const DEMO_STALLS: NightMarketAssetDef[] = STAND_SPECS.map(spec => ({
  assetId: spec.assetId,
  unlockType: 'stall',
  displayName: spec.displayName,
  description: spec.description,
  layers: makeStallLayers(spec.assetId),
  isoX: spec.swX,
  isoY: spec.swY,
  scale: STALL_SPRITE_SCALE,
  footprint: stallFootprint(spec.swX, spec.swY),
}));

/**
 * Attach each stand's assetId as a connection on its named walkable tile.
 * Runs after street tiles are expanded so connections survive priority claims.
 */
function applyConnections(tiles: TileDef[], specs: StandSpec[]): TileDef[] {
  const map = new Map<string, TileDef>();
  for (const t of tiles) map.set(tileKey(t.isoX, t.isoY), { ...t });
  for (const spec of specs) {
    const k = tileKey(spec.connX, spec.connY);
    const t = map.get(k);
    if (!t) {
      throw new Error(
        `[tileRegistry] Stand ${spec.assetId} connection tile (${spec.connX}, ${spec.connY}) is not walkable`,
      );
    }
    t.connections = [...(t.connections ?? []), spec.assetId];
    map.set(k, t);
  }
  return Array.from(map.values());
}

export const TILES: TileDef[] = applyConnections(buildTilesFromStreets(STREETS), STAND_SPECS);

// ---------------------------------------------------------------------------
// Derived structures — built once at module load.
// ---------------------------------------------------------------------------

export const TILE_GRAPH = buildTileGraph(TILES, DEMO_STALLS);

export const TILE_MAP: Map<string, TileDef> = TILE_GRAPH.tiles;

// Coarse traversal graph: intersections-as-nodes, streets-as-edges. Used by
// the pedestrian planner for high-level routing; the tile graph handles
// per-tile stepping and the access-tile last-mile.
export const STREET_GRAPH = buildStreetGraph(STREETS, TILES);

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

/** Lower bound for per-pedestrian random speed; PEDESTRIAN_SPEED_ISO_PER_SEC is the upper bound. */
const MIN_PEDESTRIAN_SPEED_ISO_PER_SEC = 3;

/** Pick a random walkable tile from the registry. */
function randomTile(): TileCoord {
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
