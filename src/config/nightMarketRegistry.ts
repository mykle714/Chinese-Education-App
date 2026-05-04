/**
 * Night Market Asset Registry (Frontend)
 *
 * Defines all unlockable items for the night market feature.
 * This is the source of truth for frontend rendering.
 *
 * Assets are imported as Vite modules from src/assets/ so they are
 * correctly hashed and resolved at build time. Each StandLayer's
 * `imagePath` holds a Vite-resolved URL, not a plain filename string.
 *
 * Assets are positioned using isometric grid coordinates (isoX, isoY).
 * These are converted to screen coordinates via isoToScreen() at render time.
 * See src/utils/isometric.ts for the coordinate system documentation.
 */

// Asset imports — Vite resolves these to hashed URLs at build time
import baseImgUrl from '../assets/test-assets/base.png';
import floorImgUrl from '../assets/test-assets/floor.png';
import humanImgUrl from '../assets/test-assets/human.png';
import roofImgUrl from '../assets/test-assets/roof.png';

/**
 * Render slot determines sub-layer ordering within a stand's depth.
 * Back-to-front order: background → entity → foreground → overlay
 */
export type RenderSlot = 'background' | 'entity' | 'foreground' | 'overlay';

/** Fractional z-offsets per render slot (must sum to < 1.0) */
export const RENDER_SLOT_Z: Record<RenderSlot, number> = {
  background: 0.0,   // shadows, floor details, back walls
  entity: 0.25,      // humans, merchants
  foreground: 0.5,   // counters, roofs
  overlay: 0.75,     // tall signs, floating effects
};

/**
 * Frame-by-frame sprite animation spec for a single StandLayer.
 * When present, the renderer cycles through `imagePaths` at `fps` and ignores
 * the layer's static `imagePath`. All frames are preloaded.
 */
export interface FrameAnimation {
  imagePaths: string[];    // Vite-resolved URLs, in play order
  fps: number;             // frames per second
  loop?: boolean;          // default true; non-loop clamps to last frame
}

/**
 * Time-driven motion primitive. Evaluated each render tick by the canvas
 * loop and applied as a delta on top of the asset's / layer's base isoX,isoY.
 *
 * Offsets are in isometric grid units; the viewer converts them to screen
 * deltas via isoToScreen (which is linear, so deltas compose cleanly).
 */
export type MotionSpec =
  | {
      kind: 'loopLinear';
      fromIso: [number, number];
      toIso: [number, number];
      durationMs: number;
      // ping-pong reverses direction each half-cycle instead of teleporting back
      pingPong?: boolean;
    }
  | { kind: 'sineBob'; amplitudeIsoY: number; periodMs: number }
  | { kind: 'orbit'; radiusIso: number; periodMs: number; phase?: number };

/** A single sub-image within a stand's layer stack */
export interface StandLayer {
  imagePath: string;       // Vite-resolved URL (imported as a module)
  slot: RenderSlot;        // which render slot this sub-image belongs to
  offsetX?: number;        // screen-pixel offset from stand anchor (default 0)
  offsetY?: number;        // screen-pixel offset from stand anchor (default 0)
  scale?: number;          // overrides parent asset's default scale if set
  groupId?: string;        // overrides the asset's default groupId for hit-testing
  frameAnimation?: FrameAnimation;  // cycle through N images at fps
  motion?: MotionSpec;     // translate this sub-layer over time
}

/** Static definition of an unlockable asset */
export interface NightMarketAssetDef {
  assetId: string;
  unlockType: 'stall' | 'person';
  displayName: string;
  description: string;
  /** Sub-images composing this asset, each assigned to a render slot */
  layers: StandLayer[];
  /** Position along the isometric X axis (continuous float, toward bottom-right on screen) */
  isoX: number;
  /** Position along the isometric Y axis (continuous float, toward bottom-left on screen) */
  isoY: number;
  /** Default render scale for sub-layers (1.0 = original size) */
  scale: number;
  /** Motion applied to the whole asset (composes with any per-layer motion) */
  motion?: MotionSpec;
  /** If set, a POI is auto-derived by projecting this asset's iso position onto the walkway. */
  frontage?: StallFrontage;
}

// ---------------------------------------------------------------------------
// Walkway & pedestrian types
//
// Two-layer navigation:
//   1. Macro layer — a graph where each edge is ONE walkway. Pedestrians
//      consult it only when they need to choose between multiple walkways
//      at a junction.
//   2. Micro layer — once on a walkway, a per-walkway TraversalStrategy
//      decides moment-to-moment position (linear now; laned / collision-aware
//      later). Keeps pedestrian code agnostic to local motion details.
// ---------------------------------------------------------------------------

/** Which local traversal strategy a walkway uses. Extend as new strategies land. */
export type TraversalKind = 'linear';

/**
 * A walkway is a single axis-aligned segment — a straight line running along
 * either the isoX or isoY axis. polyline always has exactly 2 points.
 *
 * Corners and bends are modeled as two walkways sharing an endpoint node;
 * the graph merges coincident endpoints automatically. Keeping walkways
 * single-segment means POI projection is a trivial 1D operation.
 */
export interface WalkwayDef {
  walkwayId: string;
  /** Exactly 2 iso points. Must be axis-aligned: dx=0 or dy=0. */
  polyline: [[number, number], [number, number]];
  /** Selects the per-walkway traversal strategy. */
  traversalKind: TraversalKind;
  /** Pedestrian speed along this walkway in iso-units per second. */
  speedIsoPerSec: number;
  /** Human-readable label for debugging / tooling. */
  displayName?: string;
}

/**
 * Declares that a stall fronts a specific walkway.
 * The POI position is derived by projecting the stall's iso coordinate onto
 * the walkway segment — no manual t calculation needed.
 *
 * `side` records which side of the walkway the stall sits on in screen space.
 * 'north' = screen-north (smaller isoY side of the street).
 * 'south' = screen-south (larger isoY side of the street).
 * Used for pedestrian approach offsets and duplicate-POI enforcement.
 */
export interface StallFrontage {
  walkwayId: string;
  side: 'north' | 'south';
}

/**
 * A point of interest a pedestrian can target (e.g. a stall's entry point).
 * Anchored to exactly one walkway at parameter t in iso units from polyline[0].
 * polyline[0] is always the screen-south end (max isoX + isoY).
 * Typically derived via computePoiFromStall() rather than authored by hand.
 */
export interface PoiDef {
  poiId: string;
  walkwayId: string;
  /** Iso distance from polyline[0] (the screen-south start of the walkway). */
  t: number;
  /** Which screen side of the walkway this POI faces. */
  side: 'north' | 'south';
  /** The stall asset this POI leads to. */
  linkedAssetId?: string;
  displayName?: string;
}

/**
 * 4-direction walk cycle for a pedestrian. Frames are selected by the ped's
 * isometric heading (see `headingToIsoDir` in pedestrianAgent). Each direction
 * holds an ordered list of frame URLs; frame 0 is used as the idle pose when
 * the ped is not Traveling.
 *
 * Direction ↔ screen semantics:
 *   north = backward-left   (isoY increasing)
 *   east  = backward-right  (isoX increasing)
 *   south = forward-right   (isoY decreasing)
 *   west  = forward-left    (isoX decreasing)
 */
export interface DirectionalWalkAnimation {
  north: string[];
  east: string[];
  south: string[];
  west: string[];
  fps: number;
}

/** Sprite describing how a pedestrian is rendered. */
export interface SpriteDef {
  imagePath: string;
  scale?: number;
  frameAnimation?: FrameAnimation;
  /** Optional per-direction walk cycle. When present, overrides `imagePath` at render. */
  directionalWalk?: DirectionalWalkAnimation;
}

/** A single item in a pedestrian's agenda. */
export type AgendaGoal =
  | { kind: 'VisitPoi'; poiId: string; dwellMs: number }
  /** Pick a random POI from the scene and visit it. Refilled endlessly for ambient crowd. */
  | { kind: 'Wander'; dwellMs: number }
  /** Reserved for VIPs: walk to POI and despawn when reached. */
  | { kind: 'Exit'; poiId: string };

/** Pedestrian FSM states. */
export type PedestrianFsmState = 'Idle' | 'Planning' | 'Traveling' | 'Interacting';

/**
 * Runtime state of a single pedestrian. A pedestrian is ALWAYS on exactly one
 * walkway (even when idle or interacting) so rendering has a defined position.
 */
export interface PedestrianState {
  id: string;
  sprite: SpriteDef;
  /** Walkway the pedestrian is currently positioned on. */
  currentWalkwayId: string;
  /** Position along `currentWalkwayId`'s polyline. */
  localProgress: number;
  /** +1 = progressing toward polyline[N-1], -1 = toward polyline[0]. */
  direction: 1 | -1;
  /** Macro route to follow after finishing current walkway. List of walkwayIds. */
  pendingRoute: string[];
  /** Final target progress on the final walkway in the route (POI t-value). */
  routeTargetT: number | null;
  /** Goals queued; current goal is agenda[0]. */
  agenda: AgendaGoal[];
  fsmState: PedestrianFsmState;
  /** performance.now() timestamp at which Interacting should end. */
  interactUntilMs?: number;
  /** POI the pedestrian is currently routing toward (set during Planning, cleared on Idle). */
  targetPoiId?: string;
  /**
   * IDs of the most recent POIs this pedestrian visited (oldest first, newest last).
   * Used by `resolveWanderTarget` to suppress repeat visits during local wander —
   * the global fallback ignores this list so the ped never gets fully blocked.
   * Capped at `RECENT_POI_HISTORY_LIMIT` entries.
   */
  recentlyVisitedPoiIds: string[];
}

/** Max length of `PedestrianState.recentlyVisitedPoiIds`. */
export const RECENT_POI_HISTORY_LIMIT = 8;

/** Configuration constants */
export const NIGHT_MARKET_CONFIG = {
  /** Work points required per unlock (1 unlock per 60 points = 1 hour of study) */
  POINTS_PER_UNLOCK: 60,
};

/**
 * Base set — items every user receives automatically on first visit.
 * These are seeded server-side with unlockOrder = 0.
 */
export const NIGHT_MARKET_BASE_SET: NightMarketAssetDef[] = [
  {
    assetId: 'base-ground-01',
    unlockType: 'stall',
    displayName: 'Market Ground',
    description: 'The foundation of your night market.',
    layers: [
      { imagePath: floorImgUrl, slot: 'background', groupId: 'stand-assembly-01' },
      {
        imagePath: humanImgUrl,
        slot: 'entity',
        groupId: 'merchant-01',
        // Demo motion — validates the animation foundation end-to-end.
        motion: { kind: 'sineBob', amplitudeIsoY: 0.5, periodMs: 2000 },
      },
      { imagePath: baseImgUrl, slot: 'foreground', groupId: 'stand-assembly-01' },
      { imagePath: roofImgUrl, slot: 'foreground', groupId: 'stand-assembly-01' },
    ],
    isoX: 0,
    isoY: 0,
    scale: 1.0,
  },
];

/**
 * Unlock pool — items available for random unlock as users earn work points.
 * Each item can only be unlocked once per user.
 */
export const NIGHT_MARKET_UNLOCK_POOL: NightMarketAssetDef[] = [];

/**
 * Combined lookup map for quick asset resolution by assetId.
 * Used by the frontend to map unlock records to render data.
 */
export const NIGHT_MARKET_ASSET_MAP: Map<string, NightMarketAssetDef> = new Map(
  [...NIGHT_MARKET_BASE_SET, ...NIGHT_MARKET_UNLOCK_POOL].map(asset => [asset.assetId, asset])
);
