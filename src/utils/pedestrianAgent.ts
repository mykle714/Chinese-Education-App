/**
 * Pedestrian finite state machine — lane-free axial walking.
 *
 *   Idle ──pop agenda──▶ Planning ──path found──▶ Traveling ──reached goal──▶ Interacting ──dwell──▶ Idle
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
 * are instant teleports with a 2 s wall-clock cooldown.
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
} from '../config/nightMarketRegistry';
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
const SIDESTEP_COOLDOWN_MS = 2000;

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

function checkSidestepTile(
  candidate: TileCoord,
  currentKey: string,
  ctx: PedestrianTickContext,
  leg: NavLeg,
): SidestepValidity {
  const candKey = tileKey(candidate.isoX, candidate.isoY);
  const tile = ctx.graph.tiles.get(candKey);
  if (!tile) return { ok: false, reason: 'off-graph' };
  const neighbors = ctx.graph.neighbors.get(currentKey);
  if (!neighbors || !neighbors.includes(candKey)) {
    return { ok: false, reason: 'not-neighbor' };
  }
  if (tile.isOccupied) return { ok: false, reason: 'occupied' };
  // Sidestep must stay on the current leg's edge or its endpoint nodes.
  if (
    !leg.edge.bodyTileSet.has(candKey) &&
    !leg.edge.nodeA.tileKeys.has(candKey) &&
    !leg.edge.nodeB.tileKeys.has(candKey)
  ) {
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
  leg: NavLeg,
): SidestepDecision {
  const { right, left } = sidestepCandidates(current, forward);
  const currentKey = tileKey(current.isoX, current.isoY);
  const rightCheck = checkSidestepTile(right, currentKey, ctx, leg);
  if (rightCheck.ok) return { ok: true, tile: right, side: 'right' };
  const leftCheck = checkSidestepTile(left, currentKey, ctx, leg);
  if (leftCheck.ok) return { ok: true, tile: left, side: 'left' };
  return { ok: false, rightReason: rightCheck.reason, leftReason: leftCheck.reason };
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
    const next = nextForwardTile(p.currentTile, p.pendingLegs[0]);
    if (next) heading = headingBetweenTiles(p.currentTile, next);
  }

  let imagePath = p.sprite.imagePath;
  const walk = p.sprite.directionalWalk;
  if (walk) {
    const dir = headingToIsoDir(heading);
    const frames = walk[DIR_KEY[dir]];
    if (frames && frames.length > 0) {
      const moving = p.fsmState === 'Traveling' && !p.isWaiting;
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
// Wander goal resolution
// ---------------------------------------------------------------------------

/**
 * Resolve a Wander goal. Prefers stand-access tiles not in
 * `recentlyVisitedAssetIds`; falls back to any walkable tile.
 */
function resolveWanderGoal(
  p: PedestrianState,
  ctx: PedestrianTickContext,
): { goalKey: string; assetId?: string } | null {
  const recent = new Set(p.recentlyVisitedAssetIds);
  const candidates: Array<{ key: string; assetId: string }> = [];
  for (const [assetId, tileKeys] of ctx.graph.standAccessTiles) {
    if (recent.has(assetId)) continue;
    for (const key of tileKeys) candidates.push({ key, assetId });
  }
  if (candidates.length > 0) {
    const pick = candidates[Math.floor(Math.random() * candidates.length)];
    return { goalKey: pick.key, assetId: pick.assetId };
  }
  const allTiles = Array.from(ctx.graph.tiles.keys());
  if (allTiles.length === 0) return null;
  const pick = allTiles[Math.floor(Math.random() * allTiles.length)];
  return { goalKey: pick };
}

// ---------------------------------------------------------------------------
// Path planning
// ---------------------------------------------------------------------------

/**
 * Plan a route from the ped's current tile to the active agenda goal as a
 * sequence of `(edge, target)` legs.
 *
 * Algorithm:
 *   1. Resolve goalTile (stand access or wander pick).
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
): { legs: NavLeg[]; targetAssetId?: string; wanderGoalKey?: string } | null {
  const goal = p.agenda[0];
  if (!goal) return null;

  const fromKey = tileKey(p.currentTile.isoX, p.currentTile.isoY);

  // Resolve goal tile + bookkeeping.
  let goalTileKey: string;
  let targetAssetId: string | undefined;
  let nextWanderGoalKey: string | undefined;
  if (goal.kind === 'VisitStand') {
    const access = ctx.graph.standAccessTiles.get(goal.assetId);
    if (!access || access.length === 0) return null;
    goalTileKey = access[0];
    targetAssetId = goal.assetId;
  } else {
    if (p.wanderGoalKey && ctx.graph.tiles.has(p.wanderGoalKey)) {
      goalTileKey = p.wanderGoalKey;
    } else {
      const wander = resolveWanderGoal(p, ctx);
      if (!wander) return null;
      goalTileKey = wander.goalKey;
      targetAssetId = wander.assetId;
      nextWanderGoalKey = wander.goalKey;
    }
  }

  if (fromKey === goalTileKey) {
    return { legs: [], targetAssetId, wanderGoalKey: nextWanderGoalKey };
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
      wanderGoalKey: nextWanderGoalKey,
    };
  }
  if (startEdge && goalNode &&
      (goalNode === startEdge.nodeA || goalNode === startEdge.nodeB)) {
    return {
      legs: [{ edge: startEdge, target: { kind: 'tile', tile: goalTile } }],
      targetAssetId,
      wanderGoalKey: nextWanderGoalKey,
    };
  }
  if (startNode && goalEdge &&
      (startNode === goalEdge.nodeA || startNode === goalEdge.nodeB)) {
    return {
      legs: [{ edge: goalEdge, target: { kind: 'tile', tile: goalTile } }],
      targetAssetId,
      wanderGoalKey: nextWanderGoalKey,
    };
  }
  if (startNode && goalNode && startNode === goalNode) {
    // Same node, no edge to anchor — pick any connected edge for axis direction.
    const adj = ctx.streetGraph.adjacency.get(startNode.id) ?? [];
    if (adj.length === 0) return null;
    return {
      legs: [{ edge: adj[0].edge, target: { kind: 'tile', tile: goalTile } }],
      targetAssetId,
      wanderGoalKey: nextWanderGoalKey,
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

  return { legs, targetAssetId, wanderGoalKey: nextWanderGoalKey };
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
      p.fsmState = 'Planning';
      return p;
    }

    case 'Planning': {
      const plan = planPath(p, ctx);
      if (!plan) {
        p.agenda.shift();
        p.wanderGoalKey = undefined;
        p.fsmState = 'Idle';
        return p;
      }
      p.pendingLegs = plan.legs;
      p.targetAssetId = plan.targetAssetId;
      if (plan.wanderGoalKey) p.wanderGoalKey = plan.wanderGoalKey;
      if (plan.legs.length === 0) {
        const dwellMs = goalDwell(p.agenda[0]);
        p.fsmState = 'Interacting';
        p.interactUntilMs = ctx.tMs + dwellMs;
      } else {
        p.localProgress = 0;
        p.isWaiting = false;
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

      // Forward blocked: try sidestep (subject to cooldown).
      if (nextTileDef?.isOccupied) {
        if (
          p.sidestepCooldownUntilMs !== undefined &&
          ctx.tMs < p.sidestepCooldownUntilMs
        ) {
          p.isWaiting = true;
          return p;
        }

        const forward = headingBetweenTiles(p.currentTile, next);
        const decision = pickSidestepTile(p.currentTile, forward, ctx, currentLeg);
        if (!decision.ok) {
          p.isWaiting = true;
          return p;
        }

        // Instant teleport: release current, claim side.
        if (currentTileDef) currentTileDef.isOccupied = false;
        const sideKey = tileKey(decision.tile.isoX, decision.tile.isoY);
        const sideTileDef = ctx.graph.tiles.get(sideKey);
        if (sideTileDef) sideTileDef.isOccupied = true;

        p.isWaiting = false;
        p.sidestepCooldownUntilMs = ctx.tMs + SIDESTEP_COOLDOWN_MS;
        p.committedFromTile = undefined;
        p.currentTile = { ...decision.tile };
        return p;
      }

      // Forward clear: commit. Release current, claim next, transfer ownership.
      if (currentTileDef) currentTileDef.isOccupied = false;
      if (nextTileDef) nextTileDef.isOccupied = true;

      p.isWaiting = false;
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
        p.wanderGoalKey = undefined;
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
  tileMap: Map<string, import('../config/nightMarketRegistry').TileDef>,
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
