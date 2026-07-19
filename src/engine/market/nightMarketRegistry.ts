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

// Type-only import — `streetGraph.ts` imports value types (TILE_SIZE, etc.)
// from this file. Using `import type` keeps the cycle erased at runtime.
import type { NavLeg } from './streetGraph';

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
  /** Position along the isometric X axis (continuous float, toward top-right on screen / east) */
  isoX: number;
  /** Position along the isometric Y axis (continuous float, toward top-left on screen / north) */
  isoY: number;
  /** Default render scale for sub-layers (1.0 = original size) */
  scale: number;
  /** Motion applied to the whole asset (composes with any per-layer motion) */
  motion?: MotionSpec;
  /**
   * Tiles this stand occupies in the navigation graph. None of these may
   * coincide with a walkable tile, and at least one must be 4-adjacent to the
   * tile that declares this stand in its `connections`. When omitted, the
   * footprint defaults to a single tile at `snapToTile(isoX, isoY)`.
   */
  footprint?: TileCoord[];
}

// ---------------------------------------------------------------------------
// Tile graph & pedestrian types
//
// The night market's walkable space is a discrete set of 1×1 iso-unit tiles.
// Adjacent tiles (4-neighbor: N/E/S/W) form the navigation graph. A stand is
// only accessible from a tile that explicitly lists it in `connections`; a
// stand whose footprint tile happens to be adjacent to a walkable tile but is
// NOT named in that tile's `connections` is unreachable from there.
//
// Authoring rule (enforced at graph build time):
//   - For each connection assetId, the stand's footprint tile (rounded isoX,
//     isoY) must be a 4-neighbor of the connecting tile.
//   - Each stand may be referenced by at most one tile (single access point).
//   - A walkable tile must not coincide with a stand footprint tile.
// ---------------------------------------------------------------------------

/**
 * A named, oriented walkway segment. Streets are the top-level authoring
 * primitive for walkable space. Each street is expanded into a dense block of
 * TileDefs by `streetTiles()`. Width always expands in the +offset direction.
 */
export interface Street {
  name: string;
  /** true: street runs N–S (varies isoY); false: street runs E–W (varies isoX). */
  isNorthSouth: boolean;
  /** Inclusive start coord along the street's primary axis (isoY for N–S, isoX for E–W). */
  start: number;
  /** Inclusive end coord along the street's primary axis. */
  end: number;
  /** Perpendicular coord of the street's first tile (isoX for N–S, isoY for E–W). */
  offset: number;
  /** Number of tiles wide; always expands in +offset direction. Must be ≥ 1. */
  width: number;
}

/** Discrete walkable tile. Coordinates are integer iso units. */
export interface TileDef {
  isoX: number;
  isoY: number;
  /** assetIds of stands accessible from this tile. Each must be a 4-neighbor stand. */
  connections?: string[];
  /**
   * The street that owns this tile. Ownership is assigned at build time by
   * priority (thickest street first, NS before EW on ties). The first street
   * to claim a coordinate wins; later streets skip that slot.
   */
  street?: Street;
  /**
   * Every street that tried to claim this tile (including the winner above).
   * When length >= 2, this tile sits at an intersection — it belongs to
   * multiple streets and becomes part of a street-graph node. When length
   * === 1, the tile is on a single street's body. Populated by
   * `buildTilesFromStreets`.
   */
  intersectingStreets?: Street[];
  /**
   * True while any pedestrian occupies this tile. Mutated each simulation tick
   * by `updateTileOccupancy`. A pedestrian in mid-step claims both the tile it
   * is leaving and the tile it is entering, so both are marked occupied.
   * Used by the pathfinder to avoid routing through claimed tiles.
   */
  isOccupied?: boolean;
}

/**
 * Tile edge length in iso units. A larger TILE_SIZE produces a sparser
 * navigation graph (fewer tiles per area). Adjacency offsets are ±TILE_SIZE
 * along each axis. Stand footprints are snapped to the nearest TILE_SIZE
 * multiple. Must be a positive integer.
 */
export const TILE_SIZE = 1;

/** Default pedestrian speed in iso units per second (independent of TILE_SIZE). */
export const PEDESTRIAN_SPEED_ISO_PER_SEC = 8;

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
  /** Walk to a tile that has the given assetId in its `connections`, then dwell. */
  | { kind: 'VisitStand'; assetId: string; dwellMs: number }
  /**
   * Free tile-level random walk (ignores the street graph): pick a random
   * walkable cardinal direction, stroll 1–4 tiles that way (stopping early at
   * a non-walkable tile), then pause `dwellMs` before picking again. Refilled
   * endlessly. See the `Wandering` state in pedestrianAgent + the "Random-walk
   * Wander" section of docs/PEDESTRIAN_WALKING_ALGORITHM.md.
   */
  | { kind: 'Wander'; dwellMs: number };

/** Pedestrian FSM states. */
export type PedestrianFsmState =
  | 'Idle'
  | 'Planning'
  | 'Traveling'
  | 'Wandering'
  | 'Interacting';

/** Tile coordinate pair. Always integer iso units. */
export interface TileCoord {
  isoX: number;
  isoY: number;
}

/**
 * Runtime state of a single pedestrian. A pedestrian always occupies a tile;
 * while traveling it is interpolated between `currentTile` and the next
 * forward tile (derived from `pendingLegs[0]`) by `localProgress` ∈ [0, 1].
 */
export interface PedestrianState {
  id: string;
  sprite: SpriteDef;
  /** Per-pedestrian walk speed in iso units/sec. */
  speedIsoPerSec: number;
  /**
   * The tile the pedestrian currently *owns*. Under the destination-ownership
   * model, this is the tile a moving ped has committed to walking toward
   * (not the tile it visually sits on mid-step). Ownership transfers at step
   * commit (`localProgress` 0 → >0), so `currentTile` and the rendered
   * position diverge while `localProgress < 1`; the render position is
   * `lerp(committedFromTile, currentTile, localProgress)`.
   */
  currentTile: TileCoord;
  /**
   * The tile the pedestrian most recently departed from. Set at step commit
   * (when `localProgress` flips from 0 → >0) and cleared at step completion
   * (`localProgress` reaches 1). Also cleared on sidestep teleport.
   * `computeDrawable` uses it as the lerp origin while a step is in flight.
   */
  committedFromTile?: TileCoord;
  /** 0..1 progress between committedFromTile and currentTile; 0 when stationary. */
  localProgress: number;
  /**
   * Remaining navigation legs in order. Each leg is `(edge, target)` — the
   * ped walks axially along `edge` until reaching `target` (a node or a
   * specific tile). Empty when idle/interacting. See NavLeg in streetGraph.ts.
   */
  pendingLegs: NavLeg[];
  /**
   * Random-walk burst direction while in the `Wandering` state — a cardinal
   * unit vector `[±1, 0]` or `[0, ±1]` in iso units. Undefined outside a
   * wander burst. Set by `startWanderBurst`, cleared when the burst ends.
   */
  wanderDir?: [number, number];
  /**
   * Tiles left to step in the current wander burst (initial value sampled in
   * `[WANDER_MIN_STEPS, WANDER_MAX_STEPS]`). Decremented at each forward
   * commit; when it hits 0 the burst ends and the ped pauses (Interacting).
   */
  wanderStepsLeft?: number;
  /** Goals queued; current goal is agenda[0]. */
  agenda: AgendaGoal[];
  fsmState: PedestrianFsmState;
  /** performance.now() timestamp at which Interacting should end. */
  interactUntilMs?: number;
  /** Stand the pedestrian is currently routing toward (set during Planning, cleared on Idle). */
  targetAssetId?: string;
  /**
   * AssetIds of the most recent stands this pedestrian visited (oldest first).
   * Used to suppress repeat visits during local wander. Capped at
   * `RECENT_VISIT_HISTORY_LIMIT` entries.
   */
  recentlyVisitedAssetIds: string[];
  /**
   * True when forward + both sidestep candidates are blocked. Forces the
   * walk-cycle to freeze on the idle frame. Cleared as soon as any
   * successful step starts.
   */
  isWaiting?: boolean;
  /**
   * Wall-clock timestamp (`ctx.tMs` basis, ms) until which the pedestrian
   * is forbidden from sidestepping again. Set at sidestep teleport commit
   * to `ctx.tMs + SIDESTEP_COOLDOWN_MS`; expires naturally without any
   * step-completion bookkeeping. Forward motion is not gated by this
   * cooldown — only fresh teleports are.
   */
  sidestepCooldownUntilMs?: number;
  /**
   * Wall-clock timestamp (`ctx.tMs` basis, ms) at which the pedestrian most
   * recently entered the waiting state. Set when `isWaiting` flips false →
   * true and preserved across subsequent waiting ticks; cleared when
   * `isWaiting` flips back to false. Used by the stuck-recovery forward-jump
   * logic in `pedestrianAgent.ts` (see `STUCK_FORWARD_JUMP_DELAY_MS`).
   */
  waitingSinceMs?: number;
  /**
   * The last cardinal heading the pedestrian actually moved along, as an iso
   * unit vector (`[±1, 0]` / `[0, ±1]`). Persisted at every forward commit so
   * that idle/interacting peds keep facing where they last walked instead of
   * snapping back to a default. Undefined until the ped takes its first step;
   * `computeDrawable` falls back to east (`[1, 0]`) only in that initial case.
   */
  lastHeading?: [number, number];
}

/** Max length of `PedestrianState.recentlyVisitedAssetIds`. */
export const RECENT_VISIT_HISTORY_LIMIT = 8;

/** Configuration constants */
export const NIGHT_MARKET_CONFIG = {
  /** Work points required per unlock (1 unlock per 60 points = 1 hour of study) */
  POINTS_PER_UNLOCK: 60,
};

/**
 * Base set — items every user receives automatically on first visit.
 * These are seeded server-side with unlockOrder = 0.
 *
 * Currently empty: the demo "Market Ground" stand was rendered outside the
 * tile-graph system at iso (0,0) and has been removed. Users with stale
 * `base-ground-01` unlock rows will simply log a one-time "Unknown assetId"
 * warning and the entry is skipped at render.
 */
export const NIGHT_MARKET_BASE_SET: NightMarketAssetDef[] = [];

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
