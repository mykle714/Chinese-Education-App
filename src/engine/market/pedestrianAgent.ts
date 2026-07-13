/**
 * Pedestrian finite state machine — lane-free axial walking.
 *
 *   VisitStand:  Idle ─▶ Planning ─path found─▶ Traveling ─reached goal─▶ Interacting ─dwell─▶ Idle
 *   Wander:      Idle ─▶ Wandering ─burst done / wall─▶ Interacting ─pause─▶ Idle
 *
 * `VisitStand` goals route across the street graph via `planPath` and walk it
 * with the axial `Traveling` primitive described below. `Wander` goals ignore
 * the street graph entirely: the `Wandering` state does a free tile-level
 * random walk — pick a random walkable cardinal direction, stroll 1–4 tiles
 * (stopping early at a non-walkable tile), then pause and repeat. Both states
 * share the same smooth-lerp movement, destination-ownership occupancy, and
 * sidestep/forward-jump collision avoidance. (Currently only `Wander` goals are
 * seeded — see `ensureAmbientAgenda` — so `Traveling` is dormant until
 * `VisitStand` goals are introduced.)
 *
 * State transitions are pure functions of (prev state, dtMs, ctx). Pedestrians
 * walk tile-by-tile along the primary axis of each leg's edge. The
 * perpendicular ("lane") coord is read fresh from `currentTile` every step —
 * it is never pinned to the leg.
 *
 * Each `NavLeg` is `(edge, target)`:
 *   - `target.kind === 'node'`: on first entry to the target node's tile set,
 *     sample a random depth along the leg's primary axis and mutate the leg
 *     target to that specific tile. Once mutated, the leg behaves as a tile
 *     target.
 *   - `target.kind === 'tile'`: walk axially along the edge until `currentTile`
 *     matches the target's primary coord, then step perpendicularly until
 *     `currentTile === tile`.
 *
 * Non-target node tiles met along the way are walked through as if they were
 * edge body tiles — same axial step keeps moving the ped forward. Only the
 * *target* node triggers the random-depth sample.
 *
 * Destination-ownership occupancy: a pedestrian owns the tile it is *walking
 * toward*, not the tile it is *walking away from*. Ownership transfers at
 * the instant the ped commits to a step (`localProgress` 0 → >0). Render
 * position is `lerp(committedFromTile, currentTile, localProgress)`.
 *
 * Local collision avoidance: at the start of every step, if the forward
 * tile is occupied, the ped attempts to sidestep right (90° CW from
 * heading); if blocked, then left; if both blocked, stand still. Sidesteps
 * are instant teleports with a 1 s wall-clock cooldown.
 *
 * Stuck recovery: if a ped has been continuously in the waiting state for at
 * least `STUCK_FORWARD_JUMP_DELAY_MS`, on every tick it additionally attempts
 * a "forward jump" — an instant teleport to the tile two steps ahead (i.e.
 * directly in front of the blocker), if that tile is unoccupied and lies on
 * the current leg. This breaks nose-to-nose deadlocks on 1-wide legs where
 * no valid sidestep exists.
 *
 * See docs/PEDESTRIAN_WALKING_ALGORITHM.md for the full algorithm spec and
 * docs/NIGHT_MARKET_GRAPH_ASSUMPTIONS.md for the invariants it relies on.
 */

import {
  RECENT_VISIT_HISTORY_LIMIT,
  TILE_SIZE,
  type AgendaGoal,
  type NightMarketAssetDef,
  type PedestrianFsmState,
  type PedestrianState,
  type TileCoord,
} from './nightMarketRegistry';
import {
  parseTileKey,
  tileKey,
  type TileGraph,
} from './tileGraph';
import {
  bfsStreetPath,
  findEdge,
  type NavLeg,
  type StreetGraph,
  type StreetNode,
} from './streetGraph';
import {
  advanceLocalProgress,
  headingBetweenTiles,
  lerpTile,
} from './tileTraversal';

/**
 * Wall-clock duration (ms) a pedestrian must wait between consecutive
 * sidestep teleports.
 */
const SIDESTEP_COOLDOWN_MS = 1000;

/**
 * Continuous wait duration (ms) after which a stuck ped attempts a forward
 * jump — an instant teleport to the tile two steps ahead, skipping over the
 * blocker. Re-attempted every tick once the threshold is crossed.
 */
const STUCK_FORWARD_JUMP_DELAY_MS = 3000;

/** Inclusive bounds on how many tiles a single random-walk burst travels. */
const WANDER_MIN_STEPS = 1;
const WANDER_MAX_STEPS = 4;

/** The four cardinal step directions in iso units, used by the random walk. */
const CARDINAL_DIRS: ReadonlyArray<[number, number]> = [
  [TILE_SIZE, 0],
  [-TILE_SIZE, 0],
  [0, TILE_SIZE],
  [0, -TILE_SIZE],
];

export interface PedestrianTickContext {
  graph: TileGraph;
  streetGraph: StreetGraph;
  /** assetId → stand definition, used for display names on travel labels. */
  stands: Map<string, NightMarketAssetDef>;
  /** Current time in ms for dwell timing. */
  tMs: number;
  /** Optional: all pedestrians, for future collision. */
  allPedestrians?: PedestrianState[];
}

/** Visible output of a pedestrian at render time. */
export interface PedestrianDrawable {
  id: string;
  isoX: number;
  isoY: number;
  heading: [number, number];
  imagePath: string;
  scale: number;
  fsmState: PedestrianFsmState;
  /** Display name of the target stand when Traveling; undefined otherwise. */
  targetPoiDisplayName?: string;
}

/** Cardinal isometric direction used to pick a walk-cycle frame. */
export type IsoDir = 'N' | 'E' | 'S' | 'W';

/**
 * Quantize a heading vector to the nearest iso cardinal.
 *   +hx → E, -hx → W, +hy → N, -hy → S
 */
export function headingToIsoDir(heading: [number, number]): IsoDir {
  const [hx, hy] = heading;
  if (Math.abs(hx) >= Math.abs(hy)) return hx >= 0 ? 'E' : 'W';
  return hy >= 0 ? 'N' : 'S';
}

const DIR_KEY: Record<IsoDir, 'north' | 'east' | 'south' | 'west'> = {
  N: 'north',
  E: 'east',
  S: 'south',
  W: 'west',
};

// ---------------------------------------------------------------------------
// Axis helpers
// ---------------------------------------------------------------------------

/** Iso coord along a street's primary axis (Y for N-S streets, X for E-W). */
function primaryCoord(t: TileCoord, isNorthSouth: boolean): number {
  return isNorthSouth ? t.isoY : t.isoX;
}

/** Iso coord along a street's perpendicular axis (i.e. the lane axis). */
function perpCoord(t: TileCoord, isNorthSouth: boolean): number {
  return isNorthSouth ? t.isoX : t.isoY;
}

/** Build a TileCoord from (primary, perpendicular) coords for a street. */
function makeTile(isNorthSouth: boolean, primary: number, perpendicular: number): TileCoord {
  return isNorthSouth
    ? { isoX: perpendicular, isoY: primary }
    : { isoX: primary, isoY: perpendicular };
}

/** Primary-axis range of a node's tiles. */
function nodePrimaryRange(node: StreetNode, isNS: boolean): { min: number; max: number } {
  let min = Infinity;
  let max = -Infinity;
  for (const k of node.tileKeys) {
    const p = primaryCoord(parseTileKey(k), isNS);
    if (p < min) min = p;
    if (p > max) max = p;
  }
  return { min, max };
}

// ---------------------------------------------------------------------------
// Next-forward-tile computation
// ---------------------------------------------------------------------------

/**
 * Compute the next forward tile for the active leg, or null if the leg's
 * target has already been reached. Caller is responsible for shifting
 * `pendingLegs` on null.
 *
 * For a tile target: axial step toward target primary first; once primary
 * matches, perpendicular step toward target perp.
 *
 * For a node target: axial step toward the node along the edge's primary
 * axis. The transition "ped first enters the target node" → "sample random
 * depth and mutate target to a tile" is handled by `tickPedestrian` before
 * calling this function.
 */
export function nextForwardTile(
  current: TileCoord,
  leg: NavLeg | undefined,
): TileCoord | null {
  if (!leg) return null;
  const isNS = leg.edge.street.isNorthSouth;

  if (leg.target.kind === 'tile') {
    const tile = leg.target.tile;
    const curPrim = primaryCoord(current, isNS);
    const curPerp = perpCoord(current, isNS);
    const tarPrim = primaryCoord(tile, isNS);
    const tarPerp = perpCoord(tile, isNS);
    if (curPrim !== tarPrim) {
      const sign = tarPrim > curPrim ? +1 : -1;
      return makeTile(isNS, curPrim + sign * TILE_SIZE, curPerp);
    }
    if (curPerp !== tarPerp) {
      const sign = tarPerp > curPerp ? +1 : -1;
      return makeTile(isNS, curPrim, curPerp + sign * TILE_SIZE);
    }
    return null;
  }

  // Node target — walk axially toward the node's primary range.
  const { min: nMin, max: nMax } = nodePrimaryRange(leg.target.node, isNS);
  const cur = primaryCoord(current, isNS);
  const perp = perpCoord(current, isNS);
  if (cur >= nMin && cur <= nMax) return null; // already in node
  const sign = cur < nMin ? +1 : -1;
  return makeTile(isNS, cur + sign * TILE_SIZE, perp);
}

// ---------------------------------------------------------------------------
// Sidestep helpers
// ---------------------------------------------------------------------------

/**
 * Right/left candidate tiles relative to a forward heading. Right = rotate
 * heading 90° CW in iso (E→S, N→E, ...); left = 90° CCW.
 */
function sidestepCandidates(
  current: TileCoord,
  forward: [number, number],
): { right: TileCoord; left: TileCoord } {
  const [hx, hy] = forward;
  return {
    right: {
      isoX: current.isoX + hy * TILE_SIZE,
      isoY: current.isoY - hx * TILE_SIZE,
    },
    left: {
      isoX: current.isoX - hy * TILE_SIZE,
      isoY: current.isoY + hx * TILE_SIZE,
    },
  };
}

type SidestepFailReason = 'off-graph' | 'not-neighbor' | 'occupied' | 'off-edge';
type SidestepValidity = { ok: true } | { ok: false; reason: SidestepFailReason };

/**
 * Predicate deciding whether a candidate tile is a legal destination for the
 * current activity. `Traveling` passes a leg-membership test (stay on the
 * edge/endpoint nodes); `Wandering` passes `() => true` (any walkable tile is
 * fair game). Keeps the sidestep/forward-jump machinery shared between states.
 */
type OnTrackPredicate = (candidateKey: string) => boolean;

/** Build the on-track predicate for an axial `Traveling` leg. */
function legOnTrack(leg: NavLeg): OnTrackPredicate {
  return (key) =>
    leg.edge.bodyTileSet.has(key) ||
    leg.edge.nodeA.tileKeys.has(key) ||
    leg.edge.nodeB.tileKeys.has(key);
}

/** During a wander burst, any existing walkable tile is on-track. */
const wanderOnTrack: OnTrackPredicate = () => true;

function checkSidestepTile(
  candidate: TileCoord,
  currentKey: string,
  ctx: PedestrianTickContext,
  onTrack: OnTrackPredicate,
): SidestepValidity {
  const candKey = tileKey(candidate.isoX, candidate.isoY);
  const tile = ctx.graph.tiles.get(candKey);
  if (!tile) return { ok: false, reason: 'off-graph' };
  const neighbors = ctx.graph.neighbors.get(currentKey);
  if (!neighbors || !neighbors.includes(candKey)) {
    return { ok: false, reason: 'not-neighbor' };
  }
  if (tile.isOccupied) return { ok: false, reason: 'occupied' };
  // Sidestep must stay on-track (leg edge/nodes for Traveling; anywhere walkable
  // for Wandering).
  if (!onTrack(candKey)) {
    return { ok: false, reason: 'off-edge' };
  }
  return { ok: true };
}

type SidestepDecision =
  | { ok: true; tile: TileCoord; side: 'right' | 'left' }
  | { ok: false; rightReason: SidestepFailReason; leftReason: SidestepFailReason };

function pickSidestepTile(
  current: TileCoord,
  forward: [number, number],
  ctx: PedestrianTickContext,
  onTrack: OnTrackPredicate,
): SidestepDecision {
  const { right, left } = sidestepCandidates(current, forward);
  const currentKey = tileKey(current.isoX, current.isoY);
  const rightCheck = checkSidestepTile(right, currentKey, ctx, onTrack);
  if (rightCheck.ok) return { ok: true, tile: right, side: 'right' };
  const leftCheck = checkSidestepTile(left, currentKey, ctx, onTrack);
  if (leftCheck.ok) return { ok: true, tile: left, side: 'left' };
  return { ok: false, rightReason: rightCheck.reason, leftReason: leftCheck.reason };
}

/**
 * Is `candidate` a legal forward-jump destination for a ped stuck on `leg`?
 * Unlike `checkSidestepTile`, we don't require tile-graph adjacency to the
 * ped's current tile — the jump is two steps away. We still require the
 * tile exists, is unoccupied, and is on-track (leg edge/nodes for Traveling;
 * anywhere walkable for Wandering).
 */
function isForwardJumpTileValid(
  candidate: TileCoord,
  ctx: PedestrianTickContext,
  onTrack: OnTrackPredicate,
): boolean {
  const candKey = tileKey(candidate.isoX, candidate.isoY);
  const tile = ctx.graph.tiles.get(candKey);
  if (!tile) return false;
  if (tile.isOccupied) return false;
  if (!onTrack(candKey)) return false;
  return true;
}

/**
 * Attempt a forward jump for a ped that has been waiting at least
 * `STUCK_FORWARD_JUMP_DELAY_MS`. Mutates `p` and tile occupancy and returns
 * true if the teleport happened; returns false otherwise (caller stays in
 * the waiting state).
 */
function tryForwardJump(
  p: PedestrianState,
  next: TileCoord,
  currentTileDef: import('./nightMarketRegistry').TileDef | undefined,
  ctx: PedestrianTickContext,
  onTrack: OnTrackPredicate,
): boolean {
  if (
    p.waitingSinceMs === undefined ||
    ctx.tMs - p.waitingSinceMs < STUCK_FORWARD_JUMP_DELAY_MS
  ) {
    return false;
  }
  const forward = headingBetweenTiles(p.currentTile, next);
  const jumpTile: TileCoord = {
    isoX: next.isoX + forward[0] * TILE_SIZE,
    isoY: next.isoY + forward[1] * TILE_SIZE,
  };
  if (!isForwardJumpTileValid(jumpTile, ctx, onTrack)) return false;

  if (currentTileDef) currentTileDef.isOccupied = false;
  const jumpKey = tileKey(jumpTile.isoX, jumpTile.isoY);
  const jumpTileDef = ctx.graph.tiles.get(jumpKey);
  if (jumpTileDef) jumpTileDef.isOccupied = true;

  p.isWaiting = false;
  p.waitingSinceMs = undefined;
  p.committedFromTile = undefined;
  p.currentTile = jumpTile;
  return true;
}

// ---------------------------------------------------------------------------
// Random-depth sampling at target-node entry
// ---------------------------------------------------------------------------

/**
 * Pick a random tile within `node` to stop at. Stays on the ped's current
 * perpendicular (axial walk continues straight); samples a random primary
 * coord across the node's full primary range. N1 (rectangular nodes) +
 * N2 (node perpendicular range matches connected edges) guarantee the
 * sampled tile exists in the node.
 */
function sampleNodeStopTile(
  entryTile: TileCoord,
  node: StreetNode,
  isNS: boolean,
): TileCoord {
  const { min, max } = nodePrimaryRange(node, isNS);
  const span = max - min + 1;
  const sampled = min + Math.floor(Math.random() * span);
  return makeTile(isNS, sampled, perpCoord(entryTile, isNS));
}

// ---------------------------------------------------------------------------
// Drawable projection
// ---------------------------------------------------------------------------

/** Project a pedestrian's current state to a render-space drawable. */
export function computeDrawable(
  p: PedestrianState,
  _graph: TileGraph,
  tMs: number,
  stands?: Map<string, NightMarketAssetDef>,
): PedestrianDrawable | null {
  let isoX: number;
  let isoY: number;
  let heading: [number, number] = [1, 0];
  if (p.committedFromTile) {
    [isoX, isoY] = lerpTile(p.committedFromTile, p.currentTile, p.localProgress);
    heading = headingBetweenTiles(p.committedFromTile, p.currentTile);
  } else {
    isoX = p.currentTile.isoX;
    isoY = p.currentTile.isoY;
    // Between steps: face the pending direction. Wander bursts carry their own
    // direction vector; Traveling derives it from the next forward tile.
    if (p.fsmState === 'Wandering' && p.wanderDir) {
      heading = p.wanderDir;
    } else {
      const next = nextForwardTile(p.currentTile, p.pendingLegs[0]);
      if (next) heading = headingBetweenTiles(p.currentTile, next);
    }
  }

  let imagePath = p.sprite.imagePath;
  const walk = p.sprite.directionalWalk;
  if (walk) {
    const dir = headingToIsoDir(heading);
    const frames = walk[DIR_KEY[dir]];
    if (frames && frames.length > 0) {
      const moving =
        (p.fsmState === 'Traveling' || p.fsmState === 'Wandering') &&
        !p.isWaiting;
      const idx = moving
        ? Math.floor((tMs * walk.fps) / 1000) % frames.length
        : 0;
      imagePath = frames[idx];
    }
  }

  const targetPoiDisplayName =
    p.fsmState === 'Traveling' && p.targetAssetId && stands
      ? stands.get(p.targetAssetId)?.displayName
      : undefined;

  return {
    id: p.id,
    isoX,
    isoY,
    heading,
    imagePath,
    scale: p.sprite.scale ?? 1.0,
    fsmState: p.fsmState,
    targetPoiDisplayName,
  };
}

// ---------------------------------------------------------------------------
// Random-walk burst planning (Wander)
// ---------------------------------------------------------------------------

/**
 * Start a new random-walk burst from the ped's current tile. Considers only
 * cardinal directions whose immediate neighbor is walkable (i.e. "directions
 * not touching a non-walkable cell"), picks one uniformly at random, and
 * samples a stroll length in `[WANDER_MIN_STEPS, WANDER_MAX_STEPS]`. Returns
 * null when the ped is fully boxed in (no walkable neighbor) — the caller then
 * pauses and retries.
 *
 * "Walkable" = the tile exists in `ctx.graph.tiles` (that map holds only
 * street/communal tiles; any absent tile is non-walkable).
 */
function startWanderBurst(
  p: PedestrianState,
  ctx: PedestrianTickContext,
): { dir: [number, number]; steps: number } | null {
  const eligible: Array<[number, number]> = [];
  for (const [dx, dy] of CARDINAL_DIRS) {
    const neighborKey = tileKey(p.currentTile.isoX + dx, p.currentTile.isoY + dy);
    if (ctx.graph.tiles.has(neighborKey)) eligible.push([dx, dy]);
  }
  if (eligible.length === 0) return null;
  const dir = eligible[Math.floor(Math.random() * eligible.length)];
  const span = WANDER_MAX_STEPS - WANDER_MIN_STEPS + 1;
  const steps = WANDER_MIN_STEPS + Math.floor(Math.random() * span);
  return { dir, steps };
}

// ---------------------------------------------------------------------------
// Path planning
// ---------------------------------------------------------------------------

/**
 * Plan a route from the ped's current tile to the active agenda goal as a
 * sequence of `(edge, target)` legs.
 *
 * Only `VisitStand` goals reach here (Wander goals use the `Wandering` state's
 * free random walk, not the street graph).
 *
 * Algorithm:
 *   1. Resolve goalTile from the stand's access tile.
 *   2. Classify start and goal as on-edge or in-node.
 *   3. Short-circuit when start and goal share an edge / node / adjacency.
 *   4. Otherwise BFS the street graph between candidate anchor nodes (the
 *      endpoints of the ped's current edge, or the ped's current node)
 *      and the goal anchors, pick the shortest path.
 *   5. Emit one `(edge, target: node)` leg per consecutive node pair in
 *      the BFS result, optionally prepending an edge→nodeStart leg if the
 *      ped started mid-edge.
 *   6. Replace the last leg's target with `{kind: 'tile', tile: goalTile}`
 *      so the final approach lands on the exact tile.
 */
function planPath(
  p: PedestrianState,
  ctx: PedestrianTickContext,
): { legs: NavLeg[]; targetAssetId?: string } | null {
  const goal = p.agenda[0];
  if (!goal) return null;

  const fromKey = tileKey(p.currentTile.isoX, p.currentTile.isoY);

  // Resolve goal tile + bookkeeping. Only VisitStand goals are planned here.
  if (goal.kind !== 'VisitStand') return null;
  const access = ctx.graph.standAccessTiles.get(goal.assetId);
  if (!access || access.length === 0) return null;
  const goalTileKey: string = access[0];
  const targetAssetId: string | undefined = goal.assetId;

  if (fromKey === goalTileKey) {
    return { legs: [], targetAssetId };
  }

  const goalTile = parseTileKey(goalTileKey);
  const startEdge = ctx.streetGraph.tileToEdge.get(fromKey);
  const startNode = ctx.streetGraph.tileToNode.get(fromKey);
  const goalEdge = ctx.streetGraph.tileToEdge.get(goalTileKey);
  const goalNode = ctx.streetGraph.tileToNode.get(goalTileKey);

  // Every walkable tile belongs to a street, so either edge or node must be set.
  if (!startEdge && !startNode) return null;
  if (!goalEdge && !goalNode) return null;

  // Short-circuits — no street-graph BFS needed.
  if (startEdge && goalEdge && startEdge === goalEdge) {
    return {
      legs: [{ edge: startEdge, target: { kind: 'tile', tile: goalTile } }],
      targetAssetId,
    };
  }
  if (startEdge && goalNode &&
      (goalNode === startEdge.nodeA || goalNode === startEdge.nodeB)) {
    return {
      legs: [{ edge: startEdge, target: { kind: 'tile', tile: goalTile } }],
      targetAssetId,
    };
  }
  if (startNode && goalEdge &&
      (startNode === goalEdge.nodeA || startNode === goalEdge.nodeB)) {
    return {
      legs: [{ edge: goalEdge, target: { kind: 'tile', tile: goalTile } }],
      targetAssetId,
    };
  }
  if (startNode && goalNode && startNode === goalNode) {
    // Same node, no edge to anchor — pick any connected edge for axis direction.
    const adj = ctx.streetGraph.adjacency.get(startNode.id) ?? [];
    if (adj.length === 0) return null;
    return {
      legs: [{ edge: adj[0].edge, target: { kind: 'tile', tile: goalTile } }],
      targetAssetId,
    };
  }

  // General case: BFS across the street graph.
  const startAnchors: StreetNode[] = startNode
    ? [startNode]
    : [startEdge!.nodeA, startEdge!.nodeB];
  const goalAnchors: StreetNode[] = goalNode
    ? [goalNode]
    : [goalEdge!.nodeA, goalEdge!.nodeB];

  let bestPath: string[] | null = null;
  let bestStart: StreetNode | null = null;
  let bestGoal: StreetNode | null = null;
  for (const s of startAnchors) {
    for (const g of goalAnchors) {
      const path = bfsStreetPath(ctx.streetGraph, s.id, g.id);
      if (path && (!bestPath || path.length < bestPath.length)) {
        bestPath = path;
        bestStart = s;
        bestGoal = g;
      }
    }
  }
  if (!bestPath || !bestStart || !bestGoal) return null;

  const legs: NavLeg[] = [];

  // Prelude: if start is on an edge, walk to the chosen start anchor node.
  if (startEdge) {
    legs.push({ edge: startEdge, target: { kind: 'node', node: bestStart } });
  }

  // Middle: one leg per consecutive node pair.
  for (let i = 0; i < bestPath.length - 1; i++) {
    const edge = findEdge(ctx.streetGraph, bestPath[i], bestPath[i + 1]);
    if (!edge) return null;
    const bNode = ctx.streetGraph.nodes.get(bestPath[i + 1])!;
    legs.push({ edge, target: { kind: 'node', node: bNode } });
  }

  // Last-mile: from the goal-side anchor to the goal tile.
  if (goalEdge) {
    legs.push({ edge: goalEdge, target: { kind: 'tile', tile: goalTile } });
  } else {
    // Goal is in goalNode (== bestGoal). Convert the trailing node-target leg
    // into a tile-target so the in-node walk lands precisely on goalTile.
    if (legs.length === 0) {
      // Single-node BFS path with in-node start — handled by short-circuit (4).
      // Defensive: pick any adjacency for axis.
      const adj = ctx.streetGraph.adjacency.get(bestGoal.id) ?? [];
      if (adj.length === 0) return null;
      legs.push({ edge: adj[0].edge, target: { kind: 'tile', tile: goalTile } });
    } else {
      legs[legs.length - 1].target = { kind: 'tile', tile: goalTile };
    }
  }

  return { legs, targetAssetId };
}

// ---------------------------------------------------------------------------
// Shared movement primitives (Traveling + Wandering)
// ---------------------------------------------------------------------------

/**
 * Handle a blocked forward step (the `next` tile is occupied by another ped):
 * attempt a sidestep (subject to cooldown), then the stuck-recovery forward
 * jump, else enter the waiting state. Mutates `p` and tile occupancy. Shared
 * by the Traveling and Wandering states — `onTrack` scopes which tiles are
 * legal teleport destinations (leg edge/nodes vs. anywhere walkable).
 */
function handleForwardBlocked(
  p: PedestrianState,
  next: TileCoord,
  currentTileDef: import('./nightMarketRegistry').TileDef | undefined,
  ctx: PedestrianTickContext,
  onTrack: OnTrackPredicate,
): void {
  const enterWaiting = () => {
    p.isWaiting = true;
    if (p.waitingSinceMs === undefined) p.waitingSinceMs = ctx.tMs;
  };

  if (
    p.sidestepCooldownUntilMs !== undefined &&
    ctx.tMs < p.sidestepCooldownUntilMs
  ) {
    // Sidestep on cooldown — try forward-jump recovery first.
    if (tryForwardJump(p, next, currentTileDef, ctx, onTrack)) return;
    enterWaiting();
    return;
  }

  const forward = headingBetweenTiles(p.currentTile, next);
  const decision = pickSidestepTile(p.currentTile, forward, ctx, onTrack);
  if (!decision.ok) {
    // No sidestep available — try forward-jump recovery.
    if (tryForwardJump(p, next, currentTileDef, ctx, onTrack)) return;
    enterWaiting();
    return;
  }

  // Instant teleport: release current, claim side.
  if (currentTileDef) currentTileDef.isOccupied = false;
  const sideKey = tileKey(decision.tile.isoX, decision.tile.isoY);
  const sideTileDef = ctx.graph.tiles.get(sideKey);
  if (sideTileDef) sideTileDef.isOccupied = true;

  p.isWaiting = false;
  p.waitingSinceMs = undefined;
  p.sidestepCooldownUntilMs = ctx.tMs + SIDESTEP_COOLDOWN_MS;
  p.committedFromTile = undefined;
  p.currentTile = { ...decision.tile };
}

// ---------------------------------------------------------------------------
// FSM tick
// ---------------------------------------------------------------------------

/** Advance a single pedestrian one tick. Returns a NEW state object. */
export function tickPedestrian(
  prev: PedestrianState,
  dtMs: number,
  ctx: PedestrianTickContext,
): PedestrianState {
  const p: PedestrianState = {
    ...prev,
    agenda: [...prev.agenda],
    // Legs are shallow-copied with fresh target objects so mutation (node →
    // tile target on entry) doesn't bleed across pedestrians sharing a leg.
    pendingLegs: prev.pendingLegs.map(leg => ({ edge: leg.edge, target: { ...leg.target } })),
    recentlyVisitedAssetIds: [...prev.recentlyVisitedAssetIds],
    currentTile: { ...prev.currentTile },
  };

  switch (p.fsmState) {
    case 'Idle': {
      if (p.agenda.length === 0) return p;
      // Wander goals do a free random walk; everything else routes the street
      // graph via Planning.
      p.fsmState = p.agenda[0].kind === 'Wander' ? 'Wandering' : 'Planning';
      return p;
    }

    case 'Planning': {
      const plan = planPath(p, ctx);
      if (!plan) {
        p.agenda.shift();
        p.fsmState = 'Idle';
        return p;
      }
      p.pendingLegs = plan.legs;
      p.targetAssetId = plan.targetAssetId;
      if (plan.legs.length === 0) {
        const dwellMs = goalDwell(p.agenda[0]);
        p.fsmState = 'Interacting';
        p.interactUntilMs = ctx.tMs + dwellMs;
      } else {
        p.localProgress = 0;
        p.isWaiting = false;
        p.waitingSinceMs = undefined;
        p.fsmState = 'Traveling';
      }
      return p;
    }

    case 'Traveling': {
      // Mid-step: just advance the lerp.
      if (p.localProgress > 0) {
        const step = advanceLocalProgress(p.localProgress, dtMs, p.speedIsoPerSec);
        p.localProgress = step.progress;
        if (step.completed) {
          p.localProgress = 0;
          p.committedFromTile = undefined;
        }
        return p;
      }

      // Between steps: cascade completed legs and convert node-targets to
      // tile-targets on first entry to the target node.
      while (p.pendingLegs.length > 0) {
        const cur = p.pendingLegs[0];
        const isNS = cur.edge.street.isNorthSouth;
        if (cur.target.kind === 'node') {
          const inNode = cur.target.node.tileKeys.has(
            tileKey(p.currentTile.isoX, p.currentTile.isoY),
          );
          if (inNode) {
            const stopTile = sampleNodeStopTile(p.currentTile, cur.target.node, isNS);
            cur.target = { kind: 'tile', tile: stopTile };
            // Fall through — may already be at the sampled tile.
          } else {
            break;
          }
        }
        // tile target
        const t = cur.target.tile;
        if (p.currentTile.isoX === t.isoX && p.currentTile.isoY === t.isoY) {
          p.pendingLegs.shift();
          continue;
        }
        break;
      }

      if (p.pendingLegs.length === 0) {
        const dwellMs = goalDwell(p.agenda[0]);
        p.fsmState = 'Interacting';
        p.interactUntilMs = ctx.tMs + dwellMs;
        p.isWaiting = false;
        p.waitingSinceMs = undefined;
        return p;
      }

      const currentLeg = p.pendingLegs[0];
      const next = nextForwardTile(p.currentTile, currentLeg);
      if (!next) {
        p.pendingLegs.shift();
        return p;
      }

      const currentKey = tileKey(p.currentTile.isoX, p.currentTile.isoY);
      const nextKey = tileKey(next.isoX, next.isoY);
      const currentTileDef = ctx.graph.tiles.get(currentKey);
      const nextTileDef = ctx.graph.tiles.get(nextKey);

      // Forward blocked: sidestep (subject to cooldown) then stuck-recovery
      // forward jump, scoped to the current leg's edge/endpoint nodes.
      if (nextTileDef?.isOccupied) {
        handleForwardBlocked(p, next, currentTileDef, ctx, legOnTrack(currentLeg));
        return p;
      }

      // Forward clear: commit. Release current, claim next, transfer ownership.
      if (currentTileDef) currentTileDef.isOccupied = false;
      if (nextTileDef) nextTileDef.isOccupied = true;

      p.isWaiting = false;
      p.waitingSinceMs = undefined;
      p.committedFromTile = { ...p.currentTile };
      p.currentTile = { ...next };

      const step = advanceLocalProgress(0, dtMs, p.speedIsoPerSec);
      p.localProgress = step.progress;
      if (step.completed) {
        p.localProgress = 0;
        p.committedFromTile = undefined;
      }
      return p;
    }

    case 'Wandering': {
      // Mid-step: advance the lerp (shared with Traveling).
      if (p.localProgress > 0) {
        const step = advanceLocalProgress(p.localProgress, dtMs, p.speedIsoPerSec);
        p.localProgress = step.progress;
        if (step.completed) {
          p.localProgress = 0;
          p.committedFromTile = undefined;
        }
        return p;
      }

      // Between steps: start a fresh burst when the previous one is exhausted
      // (0 or undefined steps left). A boxed-in ped (no walkable neighbor)
      // pauses and retries next burst.
      if (!p.wanderDir || !p.wanderStepsLeft) {
        const burst = startWanderBurst(p, ctx);
        if (!burst) {
          endWanderBurst(p, ctx);
          return p;
        }
        p.wanderDir = burst.dir;
        p.wanderStepsLeft = burst.steps;
      }
      const dir = p.wanderDir!; // guaranteed set by the block above

      const next: TileCoord = {
        isoX: p.currentTile.isoX + dir[0],
        isoY: p.currentTile.isoY + dir[1],
      };
      const currentKey = tileKey(p.currentTile.isoX, p.currentTile.isoY);
      const nextKey = tileKey(next.isoX, next.isoY);
      const currentTileDef = ctx.graph.tiles.get(currentKey);
      const nextTileDef = ctx.graph.tiles.get(nextKey);

      // Hit a non-walkable tile — stop the burst early and pause.
      if (!nextTileDef) {
        endWanderBurst(p, ctx);
        return p;
      }

      // Forward blocked by another ped: reuse the shared sidestep / forward-jump
      // handler. Any walkable tile is on-track while wandering.
      if (nextTileDef.isOccupied) {
        handleForwardBlocked(p, next, currentTileDef, ctx, wanderOnTrack);
        return p;
      }

      // Forward clear: commit one step and consume it from the burst.
      if (currentTileDef) currentTileDef.isOccupied = false;
      nextTileDef.isOccupied = true;
      p.isWaiting = false;
      p.waitingSinceMs = undefined;
      p.committedFromTile = { ...p.currentTile };
      p.currentTile = { ...next };
      p.wanderStepsLeft -= 1;

      const step = advanceLocalProgress(0, dtMs, p.speedIsoPerSec);
      p.localProgress = step.progress;
      if (step.completed) {
        p.localProgress = 0;
        p.committedFromTile = undefined;
      }
      return p;
    }

    case 'Interacting': {
      if (p.interactUntilMs !== undefined && ctx.tMs >= p.interactUntilMs) {
        if (p.targetAssetId) {
          p.recentlyVisitedAssetIds.push(p.targetAssetId);
          if (p.recentlyVisitedAssetIds.length > RECENT_VISIT_HISTORY_LIMIT) {
            p.recentlyVisitedAssetIds.splice(
              0,
              p.recentlyVisitedAssetIds.length - RECENT_VISIT_HISTORY_LIMIT,
            );
          }
        }
        p.agenda.shift();
        p.interactUntilMs = undefined;
        p.targetAssetId = undefined;
        p.fsmState = 'Idle';
      }
      return p;
    }
  }
}

function goalDwell(goal: AgendaGoal | undefined): number {
  if (!goal) return 0;
  if (goal.kind === 'VisitStand' || goal.kind === 'Wander') return goal.dwellMs;
  return 0;
}

/**
 * End the current random-walk burst: clear the burst direction/count and
 * transition to Interacting for the Wander goal's `dwellMs` pause. When the
 * pause elapses the ped returns to Idle, where `ensureAmbientAgenda` re-arms a
 * Wander goal → a new burst in a freshly-chosen direction.
 */
function endWanderBurst(p: PedestrianState, ctx: PedestrianTickContext): void {
  p.fsmState = 'Interacting';
  p.interactUntilMs = ctx.tMs + goalDwell(p.agenda[0]);
  p.wanderDir = undefined;
  p.wanderStepsLeft = undefined;
  p.isWaiting = false;
  p.waitingSinceMs = undefined;
}

/** Refill a pedestrian's agenda with a Wander goal so it never stalls. */
export function ensureAmbientAgenda(p: PedestrianState, wanderDwellMs: number): PedestrianState {
  if (p.agenda.length > 0) return p;
  const goal: AgendaGoal = { kind: 'Wander', dwellMs: wanderDwellMs };
  return { ...p, agenda: [goal] };
}

/**
 * Resync tile occupancy with each pedestrian's `currentTile`. `tickPedestrian`
 * already mutates `isOccupied` synchronously at commit, sidestep, and
 * step-completion, so this is a per-frame sanity sync — guards against state
 * drift and handles initial setup.
 */
export function updateTileOccupancy(
  pedestrians: PedestrianState[],
  tileMap: Map<string, import('./nightMarketRegistry').TileDef>,
): void {
  for (const tile of tileMap.values()) {
    tile.isOccupied = false;
  }
  for (const p of pedestrians) {
    const k = tileKey(p.currentTile.isoX, p.currentTile.isoY);
    const t = tileMap.get(k);
    if (t) t.isOccupied = true;
  }
}

export type { NavLeg } from './streetGraph';
