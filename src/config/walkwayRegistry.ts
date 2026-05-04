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
 *   - A T-junction at the north tip (wk-north-cross-west, wk-north-cross-east)
 *   - An east loop: hub → east → promenade-ext → south-return → market-row end
 *   - A west loop: hub → west → west-south → row-west-ext → market-row start
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
import { polylineLength } from '../utils/walkwayTraversal';

// Demo stall sprites — reuse existing test assets.
import baseImgUrl from '../assets/test-assets/base.png';
import floorImgUrl from '../assets/test-assets/floor.png';
import humanImgUrl from '../assets/test-assets/human.png';
import roofImgUrl from '../assets/test-assets/roof.png';

// Pedestrian 4-direction walk cycle frames. See DirectionalWalkAnimation in
// nightMarketRegistry.ts for the direction ↔ screen mapping.
import walkBackLeft1 from '../assets/test-assets/test-walk-animation/walk_backward_left_1.png';
import walkBackLeft2 from '../assets/test-assets/test-walk-animation/walk_backward_left_2.png';
import walkBackRight1 from '../assets/test-assets/test-walk-animation/walk_backward_right_1.png';
import walkBackRight2 from '../assets/test-assets/test-walk-animation/walk_backward_right_2.png';
import walkFwdLeft1 from '../assets/test-assets/test-walk-animation/walk_forward_left_1.png';
import walkFwdLeft2 from '../assets/test-assets/test-walk-animation/walk_forward_left_2.png';
import walkFwdRight1 from '../assets/test-assets/test-walk-animation/walk_forward_right_1.png';
import walkFwdRight2 from '../assets/test-assets/test-walk-animation/walk_forward_right_2.png';

// ---------------------------------------------------------------------------
// Walkways — all single axis-aligned segments (exactly 2 points each).
//
// Naming convention: wk-<semantic>
// Bends are two walkways sharing an endpoint; the graph merges them automatically.
//
// Polyline convention: polyline[0] is the screen-south start (max isoX + isoY).
// t=0 is at polyline[0]; t increases toward polyline[1] (screen north).
// ---------------------------------------------------------------------------

export const WALKWAYS: WalkwayDef[] = [
  // Two straight spokes from the central hub (0, 0):
  // (0,0) sum=0 > (0,-40) sum=-40 → (0,0) is screen-south. ✓
  {
    walkwayId: 'wk-north',
    displayName: 'North Lane',
    polyline: [[0, 0], [0, -40]],
    traversalKind: 'linear',
    speedIsoPerSec: 25,
  },
  // (0,0) sum=0 > (-50,0) sum=-50 → (0,0) is screen-south. ✓
  {
    walkwayId: 'wk-west',
    displayName: 'West Lane',
    polyline: [[0, 0], [-50, 0]],
    traversalKind: 'linear',
    speedIsoPerSec: 25,
  },

  // East bend: hub → (50,0) → (50,10). Two segments share node at (50,0).
  // (50,0) sum=50 > (0,0) sum=0 → (50,0) is screen-south.
  {
    walkwayId: 'wk-east',
    displayName: 'East Promenade',
    polyline: [[50, 0], [0, 0]],
    traversalKind: 'linear',
    speedIsoPerSec: 25,
  },
  // (50,10) sum=60 > (50,0) sum=50 → (50,10) is screen-south.
  {
    walkwayId: 'wk-east-stub',
    displayName: 'East Stall Row',
    polyline: [[50, 10], [50, 0]],
    traversalKind: 'linear',
    speedIsoPerSec: 25,
  },

  // South Z: hub → (0,20) → (20,20). Two segments share node at (0,20).
  // (0,20) sum=20 > (0,0) sum=0 → (0,20) is screen-south.
  {
    walkwayId: 'wk-south',
    displayName: 'South Lane',
    polyline: [[0, 20], [0, 0]],
    traversalKind: 'linear',
    speedIsoPerSec: 25,
  },
  // (20,20) sum=40 > (0,20) sum=20 → (20,20) is screen-south.
  {
    walkwayId: 'wk-south-cross',
    displayName: 'South Cross Street',
    polyline: [[20, 20], [0, 20]],
    traversalKind: 'linear',
    speedIsoPerSec: 25,
  },

  // Two dead-end spurs off the southern junction at (20, 20):
  // (35,20) sum=55 > (20,20) sum=40 → (35,20) is screen-south.
  {
    walkwayId: 'wk-south-east-spur',
    displayName: 'SE Alley',
    polyline: [[35, 20], [20, 20]],
    traversalKind: 'linear',
    speedIsoPerSec: 20,
  },
  // (20,40) sum=60 > (20,20) sum=40 → (20,40) is screen-south.
  {
    walkwayId: 'wk-south-spur',
    displayName: 'S Alley',
    polyline: [[20, 40], [20, 20]],
    traversalKind: 'linear',
    speedIsoPerSec: 20,
  },

  // Market row: extends south from the (0,20) node, then runs east with stalls.
  // wk-south-ext shares its start node with wk-south and wk-south-cross at (0,20).
  // (0,60) sum=60 > (0,20) sum=20 → (0,60) is screen-south.
  {
    walkwayId: 'wk-south-ext',
    displayName: 'South Extension',
    polyline: [[0, 60], [0, 20]],
    traversalKind: 'linear',
    speedIsoPerSec: 25,
  },
  // (80,60) sum=140 > (0,60) sum=60 → (80,60) is screen-south.
  {
    walkwayId: 'wk-market-row',
    displayName: 'Market Row',
    polyline: [[80, 60], [0, 60]],
    traversalKind: 'linear',
    speedIsoPerSec: 20,
  },

  // North cross-street: T-junction at (0, -40) splits into two arms.
  // (0,-40) sum=-40 > (-30,-40) sum=-70 → (0,-40) is screen-south.
  {
    walkwayId: 'wk-north-cross-west',
    displayName: 'North Cross West',
    polyline: [[0, -40], [-30, -40]],
    traversalKind: 'linear',
    speedIsoPerSec: 22,
  },
  // (30,-40) sum=-10 > (0,-40) sum=-40 → (30,-40) is screen-south.
  {
    walkwayId: 'wk-north-cross-east',
    displayName: 'North Cross East',
    polyline: [[30, -40], [0, -40]],
    traversalKind: 'linear',
    speedIsoPerSec: 22,
  },

  // East loop: promenade extends east from the (50,0) bend, then drops south
  // to (80, 60), which coincides with the east end of wk-market-row.
  // (80,0) sum=80 > (50,0) sum=50 → (80,0) is screen-south.
  {
    walkwayId: 'wk-east-promenade-ext',
    displayName: 'East Promenade Extension',
    polyline: [[80, 0], [50, 0]],
    traversalKind: 'linear',
    speedIsoPerSec: 25,
  },
  // (80,60) sum=140 > (80,0) sum=80 → (80,60) is screen-south.
  {
    walkwayId: 'wk-east-south-return',
    displayName: 'East Return Lane',
    polyline: [[80, 60], [80, 0]],
    traversalKind: 'linear',
    speedIsoPerSec: 25,
  },

  // West loop: drops south from the (-50, 0) west tip to (-50, 60), then
  // runs east to (0, 60), coinciding with the west end of wk-market-row.
  // (-50,60) sum=10 > (-50,0) sum=-50 → (-50,60) is screen-south.
  {
    walkwayId: 'wk-west-south',
    displayName: 'West Return Lane',
    polyline: [[-50, 60], [-50, 0]],
    traversalKind: 'linear',
    speedIsoPerSec: 25,
  },
  // (0,60) sum=60 > (-50,60) sum=10 → (0,60) is screen-south.
  {
    walkwayId: 'wk-south-row-west-ext',
    displayName: 'Market Row West Extension',
    polyline: [[0, 60], [-50, 60]],
    traversalKind: 'linear',
    speedIsoPerSec: 20,
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

// side convention: 'north' = screen-north side (smaller isoY for horizontal streets,
// smaller isoX for vertical streets). 'south' = the opposite side.
export const DEMO_STALLS: NightMarketAssetDef[] = [
  // Endpoint stalls — physically at the walkway tip, side is conventional.
  {
    assetId: 'demo-stall-north',
    unlockType: 'stall',
    displayName: 'Lantern Shop',
    description: 'At the north end of the plaza.',
    layers: makeStallLayers('demo-stall-north'),
    isoX: 0, isoY: -40, scale: 1.0,
    frontage: { walkwayId: 'wk-north', side: 'south' },
  },
  {
    assetId: 'demo-stall-west',
    unlockType: 'stall',
    displayName: 'Tea House',
    description: 'At the west end of the plaza.',
    layers: makeStallLayers('demo-stall-west'),
    isoX: -50, isoY: 0, scale: 1.0,
    frontage: { walkwayId: 'wk-west', side: 'south' },
  },
  {
    assetId: 'demo-stall-east',
    unlockType: 'stall',
    displayName: 'Fish Monger',
    description: 'At the far end of the east stall row.',
    layers: makeStallLayers('demo-stall-east'),
    isoX: 50, isoY: 10, scale: 1.0,
    frontage: { walkwayId: 'wk-east-stub', side: 'south' },
  },
  {
    assetId: 'demo-stall-se',
    unlockType: 'stall',
    displayName: 'Spice Merchant',
    description: 'Down the SE alley.',
    layers: makeStallLayers('demo-stall-se'),
    isoX: 35, isoY: 20, scale: 1.0,
    frontage: { walkwayId: 'wk-south-east-spur', side: 'south' },
  },
  {
    assetId: 'demo-stall-s',
    unlockType: 'stall',
    displayName: 'Silk Weaver',
    description: 'Down the S alley.',
    layers: makeStallLayers('demo-stall-s'),
    isoX: 20, isoY: 40, scale: 1.0,
    frontage: { walkwayId: 'wk-south-spur', side: 'south' },
  },

  // wk-market-row (isoY=60): isoY<60 = screen north, isoY>60 = screen south.
  // After polyline reversal, t = |stall.isoX - 80| (polyline[0] is at isoX=80).
  {
    assetId: 'market-stall-1',
    unlockType: 'stall',
    displayName: 'Jade Jeweller',
    description: 'Fine jade ornaments and pendants.',
    layers: makeStallLayers('market-stall-1'),
    isoX: 10, isoY: 56.5, scale: 1.0,
    frontage: { walkwayId: 'wk-market-row', side: 'north' },
  },
  {
    assetId: 'market-stall-2',
    unlockType: 'stall',
    displayName: 'Dumpling House',
    description: 'Steamed dumplings, fresh every hour.',
    layers: makeStallLayers('market-stall-2'),
    isoX: 20, isoY: 63.5, scale: 1.0,
    frontage: { walkwayId: 'wk-market-row', side: 'south' },
  },
  {
    assetId: 'market-stall-3',
    unlockType: 'stall',
    displayName: 'Ink & Brush',
    description: 'Calligraphy supplies and handmade scrolls.',
    layers: makeStallLayers('market-stall-3'),
    isoX: 30, isoY: 56.5, scale: 1.0,
    frontage: { walkwayId: 'wk-market-row', side: 'north' },
  },
  {
    assetId: 'market-stall-4',
    unlockType: 'stall',
    displayName: 'Lotus Tea',
    description: 'Rare teas sourced from mountain gardens.',
    layers: makeStallLayers('market-stall-4'),
    isoX: 40, isoY: 63.5, scale: 1.0,
    frontage: { walkwayId: 'wk-market-row', side: 'south' },
  },
  // Opposing-side pair: both at isoX=40 (t=40 from screen-south start at isoX=80).
  // market-stall-4 occupies the south side; this one takes the north side.
  // The duplicate guard must NOT throw — sides differ.
  {
    assetId: 'market-stall-4-north',
    unlockType: 'stall',
    displayName: 'Lotus Tea North',
    description: 'Across from Lotus Tea.',
    layers: makeStallLayers('market-stall-4-north'),
    isoX: 40, isoY: 56.5, scale: 1.0,
    frontage: { walkwayId: 'wk-market-row', side: 'north' },
  },
  {
    assetId: 'market-stall-5',
    unlockType: 'stall',
    displayName: 'Dragon Kites',
    description: 'Handpainted kites in every shape.',
    layers: makeStallLayers('market-stall-5'),
    isoX: 50, isoY: 56.5, scale: 1.0,
    frontage: { walkwayId: 'wk-market-row', side: 'north' },
  },
  {
    assetId: 'market-stall-6',
    unlockType: 'stall',
    displayName: 'Five Spice Grill',
    description: 'Skewers grilled over charcoal.',
    layers: makeStallLayers('market-stall-6'),
    isoX: 60, isoY: 63.5, scale: 1.0,
    frontage: { walkwayId: 'wk-market-row', side: 'south' },
  },
  {
    assetId: 'market-stall-7',
    unlockType: 'stall',
    displayName: 'Paper Lanterns',
    description: 'Lanterns of every colour and size.',
    layers: makeStallLayers('market-stall-7'),
    isoX: 70, isoY: 56.5, scale: 1.0,
    frontage: { walkwayId: 'wk-market-row', side: 'north' },
  },
  {
    assetId: 'market-stall-8',
    unlockType: 'stall',
    displayName: 'Fortune Teller',
    description: 'Wisdom from the stars, for a small fee.',
    layers: makeStallLayers('market-stall-8'),
    isoX: 80, isoY: 63.5, scale: 1.0,
    frontage: { walkwayId: 'wk-market-row', side: 'south' },
  },

  // North cross-street stalls (isoY=-40): isoY<-40 = screen north.
  {
    assetId: 'demo-stall-nw',
    unlockType: 'stall',
    displayName: 'Moon Cake Bakery',
    description: 'At the west arm of the north cross.',
    layers: makeStallLayers('demo-stall-nw'),
    isoX: -20, isoY: -43.5, scale: 1.0,
    frontage: { walkwayId: 'wk-north-cross-west', side: 'north' },
  },
  {
    assetId: 'demo-stall-ne',
    unlockType: 'stall',
    displayName: 'Bamboo Flute Maker',
    description: 'At the east arm of the north cross.',
    layers: makeStallLayers('demo-stall-ne'),
    isoX: 20, isoY: -43.5, scale: 1.0,
    frontage: { walkwayId: 'wk-north-cross-east', side: 'north' },
  },

  // East promenade ext (isoY=0): isoY<0 = screen north.
  {
    assetId: 'demo-stall-east-promenade',
    unlockType: 'stall',
    displayName: 'Copper Smith',
    description: 'Along the east promenade.',
    layers: makeStallLayers('demo-stall-east-promenade'),
    isoX: 65, isoY: -3.5, scale: 1.0,
    frontage: { walkwayId: 'wk-east-promenade-ext', side: 'north' },
  },
  // East return lane (isoX=80, vertical): isoX>80 = screen south, isoX<80 = screen north.
  {
    assetId: 'demo-stall-east-return-n',
    unlockType: 'stall',
    displayName: 'Incense House',
    description: 'Upper east return lane.',
    layers: makeStallLayers('demo-stall-east-return-n'),
    isoX: 83.5, isoY: 20, scale: 1.0,
    frontage: { walkwayId: 'wk-east-south-return', side: 'south' },
  },
  {
    assetId: 'demo-stall-east-return-s',
    unlockType: 'stall',
    displayName: 'Porcelain Works',
    description: 'Lower east return lane.',
    layers: makeStallLayers('demo-stall-east-return-s'),
    isoX: 76.5, isoY: 40, scale: 1.0,
    frontage: { walkwayId: 'wk-east-south-return', side: 'north' },
  },

  // West return lane (isoX=-50, vertical): isoX<-50 = screen north, isoX>-50 = screen south.
  {
    assetId: 'demo-stall-west-return-n',
    unlockType: 'stall',
    displayName: 'Herbalist',
    description: 'Upper west return lane.',
    layers: makeStallLayers('demo-stall-west-return-n'),
    isoX: -53.5, isoY: 20, scale: 1.0,
    frontage: { walkwayId: 'wk-west-south', side: 'north' },
  },
  {
    assetId: 'demo-stall-west-return-s',
    unlockType: 'stall',
    displayName: 'Wood Carver',
    description: 'Lower west return lane.',
    layers: makeStallLayers('demo-stall-west-return-s'),
    isoX: -46.5, isoY: 40, scale: 1.0,
    frontage: { walkwayId: 'wk-west-south', side: 'south' },
  },

  // Market row west extension (isoY=60): isoY<60 = screen north.
  {
    assetId: 'market-stall-west-ext',
    unlockType: 'stall',
    displayName: 'Night Noodles',
    description: 'West end of market row.',
    layers: makeStallLayers('market-stall-west-ext'),
    isoX: -25, isoY: 56.5, scale: 1.0,
    frontage: { walkwayId: 'wk-south-row-west-ext', side: 'north' },
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
  imagePath: humanImgUrl, // fallback if directionalWalk frames fail to resolve
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

export function makeAmbientPedestrian(id: string, walkway: WalkwayDef): PedestrianState {
  const len = polylineLength(walkway.polyline);
  return {
    id,
    sprite: defaultSprite,
    currentWalkwayId: walkway.walkwayId,
    // Scatter start positions along the walkway in iso units so peds don't stack.
    localProgress: Math.random() * len,
    direction: Math.random() < 0.5 ? 1 : -1,
    pendingRoute: [],
    routeTargetT: null,
    agenda: [{ kind: 'Wander', dwellMs: 1500 }],
    fsmState: 'Idle',
    recentlyVisitedPoiIds: [],
  };
}

/** Round-robin spawn across available walkways so pedestrians start in varied places. */
export function makeDemoPedestrians(count = DEMO_PEDESTRIAN_COUNT): PedestrianState[] {
  const result: PedestrianState[] = [];
  for (let i = 0; i < count; i++) {
    const walkway = WALKWAYS[i % WALKWAYS.length];
    result.push(makeAmbientPedestrian(`ped-${i}`, walkway));
  }
  return result;
}
