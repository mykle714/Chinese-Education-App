/**
 * Walkway Registry — Demo Scene
 *
 * Hand-authored walkway + POI layout for the night market. This file is the
 * authoring surface for scene infrastructure (walkways are always-present,
 * not unlockable).
 *
 * The demo showcases:
 *   - Straight spokes from the hub (wk-north, wk-west)
 *   - A bend modeled as two walkways sharing an endpoint (wk-east, wk-east-stub)
 *   - A Z modeled as two walkways (wk-south, wk-south-cross) meeting at a node
 *   - Two dead-end spurs off the southern junction (wk-south-east-spur, wk-south-spur)
 *   - A long market row (wk-market-row) with 8 stalls on alternating sides
 *   - All junctions derived automatically from coincident endpoints
 *
 * All walkways are single axis-aligned segments (2 points). Bends and corners
 * are two walkways sharing an endpoint — a node with 2 edges is valid.
 * POIs are derived from stall frontage declarations via buildPoisFromStalls().
 */

import type {
  WalkwayDef,
  PoiDef,
  NightMarketAssetDef,
  PedestrianState,
  SpriteDef,
} from './nightMarketRegistry';
import { buildGraph, bfsRouteStrategy } from '../utils/walkwayGraph';
import { buildPoisFromStalls } from '../utils/stallPoi';

// Demo stall sprites — reuse existing test assets.
import baseImgUrl from '../assets/test assets/base.png';
import floorImgUrl from '../assets/test assets/floor.png';
import humanImgUrl from '../assets/test assets/human.png';
import roofImgUrl from '../assets/test assets/roof.png';

// ---------------------------------------------------------------------------
// Walkways — all single axis-aligned segments (exactly 2 points each).
//
// Naming convention: wk-<semantic>
// Bends are two walkways sharing an endpoint; the graph merges them automatically.
// ---------------------------------------------------------------------------

export const WALKWAYS: WalkwayDef[] = [
  // Two straight spokes from the central hub (0, 0):
  {
    walkwayId: 'wk-north',
    displayName: 'North Lane',
    polyline: [[0, 0], [0, -80]],
    traversalKind: 'linear',
    speedIsoPerSec: 12.5,
  },
  {
    walkwayId: 'wk-west',
    displayName: 'West Lane',
    polyline: [[0, 0], [-100, 0]],
    traversalKind: 'linear',
    speedIsoPerSec: 12.5,
  },

  // East bend: hub → (100,0) → (100,20). Two segments share node at (100,0).
  {
    walkwayId: 'wk-east',
    displayName: 'East Promenade',
    polyline: [[0, 0], [100, 0]],
    traversalKind: 'linear',
    speedIsoPerSec: 12.5,
  },
  {
    walkwayId: 'wk-east-stub',
    displayName: 'East Stall Row',
    polyline: [[100, 0], [100, 20]],
    traversalKind: 'linear',
    speedIsoPerSec: 12.5,
  },

  // South Z: hub → (0,40) → (40,40). Two segments share node at (0,40).
  {
    walkwayId: 'wk-south',
    displayName: 'South Lane',
    polyline: [[0, 0], [0, 40]],
    traversalKind: 'linear',
    speedIsoPerSec: 12.5,
  },
  {
    walkwayId: 'wk-south-cross',
    displayName: 'South Cross Street',
    polyline: [[0, 40], [40, 40]],
    traversalKind: 'linear',
    speedIsoPerSec: 12.5,
  },

  // Two dead-end spurs off the southern junction at (40, 40):
  {
    walkwayId: 'wk-south-east-spur',
    displayName: 'SE Alley',
    polyline: [[40, 40], [70, 40]],
    traversalKind: 'linear',
    speedIsoPerSec: 10,
  },
  {
    walkwayId: 'wk-south-spur',
    displayName: 'S Alley',
    polyline: [[40, 40], [40, 80]],
    traversalKind: 'linear',
    speedIsoPerSec: 10,
  },

  // Market row: extends south from the (0,40) node, then runs east with 8 stalls.
  // wk-south-ext shares its start node with wk-south and wk-south-cross at (0,40).
  {
    walkwayId: 'wk-south-ext',
    displayName: 'South Extension',
    polyline: [[0, 40], [0, 120]],
    traversalKind: 'linear',
    speedIsoPerSec: 12.5,
  },
  {
    walkwayId: 'wk-market-row',
    displayName: 'Market Row',
    polyline: [[0, 120], [160, 120]],
    traversalKind: 'linear',
    speedIsoPerSec: 10,
  },
];

// ---------------------------------------------------------------------------
// Demo stalls — rendered unconditionally on the page as scene props.
// Each stall declares a `frontage` so its POI is derived automatically.
// ---------------------------------------------------------------------------

const makeStallLayers = (groupId: string): NightMarketAssetDef['layers'] => [
  { imagePath: floorImgUrl, slot: 'background', groupId },
  { imagePath: humanImgUrl, slot: 'entity', groupId: `${groupId}-merchant` },
  { imagePath: baseImgUrl, slot: 'foreground', groupId },
  { imagePath: roofImgUrl, slot: 'foreground', groupId },
];

export const DEMO_STALLS: NightMarketAssetDef[] = [
  {
    assetId: 'demo-stall-north',
    unlockType: 'stall',
    displayName: 'Lantern Shop',
    description: 'At the north end of the plaza.',
    layers: makeStallLayers('demo-stall-north'),
    isoX: 0, isoY: -80, scale: 1.0,
    frontage: { walkwayId: 'wk-north', side: 'right' },
  },
  {
    assetId: 'demo-stall-west',
    unlockType: 'stall',
    displayName: 'Tea House',
    description: 'At the west end of the plaza.',
    layers: makeStallLayers('demo-stall-west'),
    isoX: -100, isoY: 0, scale: 1.0,
    frontage: { walkwayId: 'wk-west', side: 'right' },
  },
  {
    assetId: 'demo-stall-east',
    unlockType: 'stall',
    displayName: 'Fish Monger',
    description: 'At the far end of the east stall row.',
    layers: makeStallLayers('demo-stall-east'),
    isoX: 100, isoY: 20, scale: 1.0,
    frontage: { walkwayId: 'wk-east-stub', side: 'right' },
  },
  {
    assetId: 'demo-stall-se',
    unlockType: 'stall',
    displayName: 'Spice Merchant',
    description: 'Down the SE alley.',
    layers: makeStallLayers('demo-stall-se'),
    isoX: 70, isoY: 40, scale: 1.0,
    frontage: { walkwayId: 'wk-south-east-spur', side: 'right' },
  },
  {
    assetId: 'demo-stall-s',
    unlockType: 'stall',
    displayName: 'Silk Weaver',
    description: 'Down the S alley.',
    layers: makeStallLayers('demo-stall-s'),
    isoX: 40, isoY: 80, scale: 1.0,
    frontage: { walkwayId: 'wk-south-spur', side: 'right' },
  },

  // 8 stalls along wk-market-row, alternating left (isoY=113) and right (isoY=127),
  // spaced every 20 units from isoX=20 to isoX=160.
  {
    assetId: 'market-stall-1',
    unlockType: 'stall',
    displayName: 'Jade Jeweller',
    description: 'Fine jade ornaments and pendants.',
    layers: makeStallLayers('market-stall-1'),
    isoX: 20, isoY: 113, scale: 1.0,
    frontage: { walkwayId: 'wk-market-row', side: 'left' },
  },
  {
    assetId: 'market-stall-2',
    unlockType: 'stall',
    displayName: 'Dumpling House',
    description: 'Steamed dumplings, fresh every hour.',
    layers: makeStallLayers('market-stall-2'),
    isoX: 40, isoY: 127, scale: 1.0,
    frontage: { walkwayId: 'wk-market-row', side: 'right' },
  },
  {
    assetId: 'market-stall-3',
    unlockType: 'stall',
    displayName: 'Ink & Brush',
    description: 'Calligraphy supplies and handmade scrolls.',
    layers: makeStallLayers('market-stall-3'),
    isoX: 60, isoY: 113, scale: 1.0,
    frontage: { walkwayId: 'wk-market-row', side: 'left' },
  },
  {
    assetId: 'market-stall-4',
    unlockType: 'stall',
    displayName: 'Lotus Tea',
    description: 'Rare teas sourced from mountain gardens.',
    layers: makeStallLayers('market-stall-4'),
    isoX: 80, isoY: 127, scale: 1.0,
    frontage: { walkwayId: 'wk-market-row', side: 'right' },
  },
  {
    assetId: 'market-stall-5',
    unlockType: 'stall',
    displayName: 'Dragon Kites',
    description: 'Handpainted kites in every shape.',
    layers: makeStallLayers('market-stall-5'),
    isoX: 100, isoY: 113, scale: 1.0,
    frontage: { walkwayId: 'wk-market-row', side: 'left' },
  },
  {
    assetId: 'market-stall-6',
    unlockType: 'stall',
    displayName: 'Five Spice Grill',
    description: 'Skewers grilled over charcoal.',
    layers: makeStallLayers('market-stall-6'),
    isoX: 120, isoY: 127, scale: 1.0,
    frontage: { walkwayId: 'wk-market-row', side: 'right' },
  },
  {
    assetId: 'market-stall-7',
    unlockType: 'stall',
    displayName: 'Paper Lanterns',
    description: 'Lanterns of every colour and size.',
    layers: makeStallLayers('market-stall-7'),
    isoX: 140, isoY: 113, scale: 1.0,
    frontage: { walkwayId: 'wk-market-row', side: 'left' },
  },
  {
    assetId: 'market-stall-8',
    unlockType: 'stall',
    displayName: 'Fortune Teller',
    description: 'Wisdom from the stars, for a small fee.',
    layers: makeStallLayers('market-stall-8'),
    isoX: 160, isoY: 127, scale: 1.0,
    frontage: { walkwayId: 'wk-market-row', side: 'right' },
  },
];

// ---------------------------------------------------------------------------
// Derived walkway structures — built once at module load, before POIs.
// ---------------------------------------------------------------------------

export const WALKWAY_GRAPH = buildGraph(WALKWAYS);

export const WALKWAY_MAP: Map<string, WalkwayDef> = new Map(
  WALKWAYS.map(w => [w.walkwayId, w])
);

// ---------------------------------------------------------------------------
// POIs — derived from stall frontage declarations.
// ---------------------------------------------------------------------------

export const POIS: PoiDef[] = buildPoisFromStalls(DEMO_STALLS, WALKWAY_MAP);

export const POI_MAP: Map<string, PoiDef> = new Map(POIS.map(p => [p.poiId, p]));

export const DEFAULT_ROUTE_STRATEGY = bfsRouteStrategy;

// ---------------------------------------------------------------------------
// Pedestrian factory — builds an ambient pedestrian spawned on a given walkway.
// ---------------------------------------------------------------------------

const defaultSprite: SpriteDef = {
  imagePath: humanImgUrl,
  scale: 1.0,
};

export const DEMO_PEDESTRIAN_COUNT = 3;

export function makeAmbientPedestrian(id: string, spawnWalkwayId: string): PedestrianState {
  return {
    id,
    sprite: defaultSprite,
    currentWalkwayId: spawnWalkwayId,
    localProgress: Math.random(), // scatter start positions so they don't stack
    direction: Math.random() < 0.5 ? 1 : -1,
    pendingRoute: [],
    routeTargetT: null,
    agenda: [{ kind: 'Wander', dwellMs: 1500 }],
    fsmState: 'Idle',
  };
}

/** Round-robin spawn across available walkways so pedestrians start in varied places. */
export function makeDemoPedestrians(count = DEMO_PEDESTRIAN_COUNT): PedestrianState[] {
  const result: PedestrianState[] = [];
  for (let i = 0; i < count; i++) {
    const walkway = WALKWAYS[i % WALKWAYS.length];
    result.push(makeAmbientPedestrian(`ped-${i}`, walkway.walkwayId));
  }
  return result;
}
