/**
 * Pedestrian finite state machine.
 *
 *   Idle ──pop agenda──▶ Planning ──route found──▶ Traveling ──reached POI──▶ Interacting ──dwell elapsed──▶ Idle
 *
 * All state transitions are computed here. `tickPedestrian` is a pure function
 * of (prev state, dtMs, ctx) — no React, no timers, no DOM.
 *
 * Ctx provides the graph, walkways, POIs, and (later) peer pedestrians so
 * collision-aware strategies slot in without agent changes.
 */

import {
  RECENT_POI_HISTORY_LIMIT,
  type PedestrianState,
  type WalkwayDef,
  type PoiDef,
  type AgendaGoal,
  type PedestrianFsmState,
} from '../config/nightMarketRegistry';
import {
  getTraversalStrategy,
  pointAtT,
  polylineLength,
  type TraversalContext,
} from './walkwayTraversal';
import {
  routeBetweenWalkways,
  type WalkwayGraph,
  type RouteStrategy,
} from './walkwayGraph';

export interface PedestrianTickContext {
  graph: WalkwayGraph;
  /** walkwayId → WalkwayDef lookup. */
  walkways: Map<string, WalkwayDef>;
  /** poiId → PoiDef lookup. */
  pois: Map<string, PoiDef>;
  /** Routing strategy — defaults to BFS at call site. */
  routeStrategy: RouteStrategy;
  /** Current time in ms for dwell timing. */
  tMs: number;
  /** Optional: all pedestrians, for future collision. */
  allPedestrians?: PedestrianState[];
}

/**
 * Visible output of a pedestrian at render time. Derived from state, not stored.
 */
export interface PedestrianDrawable {
  id: string;
  isoX: number;
  isoY: number;
  heading: [number, number];
  imagePath: string;
  scale: number;
  /** Current FSM state — used by debug overlay. */
  fsmState: PedestrianFsmState;
  /** Display name of the target POI when Traveling; undefined otherwise. */
  targetPoiDisplayName?: string;
}

/** Cardinal isometric direction used to pick a walk-cycle frame. */
export type IsoDir = 'N' | 'E' | 'S' | 'W';

/**
 * Quantize a heading vector (in iso-space) to the nearest iso cardinal.
 * Larger-magnitude axis wins; ties favor the E/W axis.
 *   +hx → E (backward-right), -hx → W (forward-left)
 *   +hy → N (backward-left),  -hy → S (forward-right)
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

/** Project a pedestrian's current state to a render-space drawable. */
export function computeDrawable(
  p: PedestrianState,
  walkways: Map<string, WalkwayDef>,
  tMs: number,
  pois?: Map<string, PoiDef>
): PedestrianDrawable | null {
  const w = walkways.get(p.currentWalkwayId);
  if (!w) return null;
  const { isoPos, headingIso } = pointAtT(w.polyline, p.localProgress);
  const heading: [number, number] =
    p.direction === 1 ? headingIso : [-headingIso[0], -headingIso[1]];

  // Resolve image path. Directional walk animation (if present) wins over
  // static imagePath: pick the frame list matching the quantized heading,
  // then cycle at the configured fps while Traveling. When Idle/Interacting/
  // Planning, freeze on frame 0 of the last-faced direction.
  let imagePath = p.sprite.imagePath;
  const walk = p.sprite.directionalWalk;
  if (walk) {
    const dir = headingToIsoDir(heading);
    const frames = walk[DIR_KEY[dir]];
    if (frames && frames.length > 0) {
      const moving = p.fsmState === 'Traveling';
      const idx = moving
        ? Math.floor((tMs * walk.fps) / 1000) % frames.length
        : 0;
      imagePath = frames[idx];
    }
  }

  const targetPoiDisplayName =
    p.fsmState === 'Traveling' && p.targetPoiId && pois
      ? pois.get(p.targetPoiId)?.displayName
      : undefined;
  return {
    id: p.id,
    isoX: isoPos[0],
    isoY: isoPos[1],
    heading,
    imagePath,
    scale: p.sprite.scale ?? 1.0,
    fsmState: p.fsmState,
    targetPoiDisplayName,
  };
}

/**
 * Resolve an agenda Wander goal.
 *
 * Candidate set:
 *  - all POIs on the pedestrian's current walkway, PLUS
 *  - POIs on walkways connected at either endpoint of the current walkway,
 *    but only if the POI sits near the shared junction (t <= 0.2 if the
 *    junction is that walkway's polyline[0] end; t >= 0.8 if the junction
 *    is its polyline[N-1] end).
 *
 * This keeps wandering local — peds drift to nearby stalls instead of
 * teleporting goals to the far side of the map. If the local candidate set
 * is empty (e.g. ped is on a walkway with no nearby POIs), falls back to a
 * uniform pick from all POIs so the ped doesn't stall.
 */
function resolveWanderTarget(
  p: PedestrianState,
  pois: Map<string, PoiDef>,
  ctx: PedestrianTickContext
): PoiDef | null {
  const candidates: PoiDef[] = [];
  const allPois = [...pois.values()];
  const recentlyVisited = new Set(p.recentlyVisitedPoiIds);

  // Same-walkway POIs are always eligible (unless recently visited).
  for (const poi of allPois) {
    if (poi.walkwayId !== p.currentWalkwayId) continue;
    if (recentlyVisited.has(poi.poiId)) continue;
    candidates.push(poi);
  }

  // Connected walkways via either endpoint of the current walkway.
  const currentEnds = ctx.graph.walkwayEndpoints.get(p.currentWalkwayId);
  if (currentEnds) {
    for (const junctionNodeId of currentEnds) {
      const incident = ctx.graph.adjacency.get(junctionNodeId) ?? [];
      for (const neighborWalkwayId of incident) {
        if (neighborWalkwayId === p.currentWalkwayId) continue;
        const neighborEnds = ctx.graph.walkwayEndpoints.get(neighborWalkwayId);
        if (!neighborEnds) continue;
        // Which end of the neighbor is the shared junction?
        const junctionAtStart = neighborEnds[0] === junctionNodeId;
        const junctionAtEnd = neighborEnds[1] === junctionNodeId;
        if (!junctionAtStart && !junctionAtEnd) continue;
        // 20% of the neighbor walkway's length — scales with walkway size.
        const neighborWalkway = ctx.walkways.get(neighborWalkwayId);
        if (!neighborWalkway) continue;
        const neighborLen = polylineLength(neighborWalkway.polyline);
        const nearThreshold = 0.2 * neighborLen;
        for (const poi of allPois) {
          if (poi.walkwayId !== neighborWalkwayId) continue;
          if (recentlyVisited.has(poi.poiId)) continue;
          if (junctionAtStart && poi.t <= nearThreshold) candidates.push(poi);
          else if (junctionAtEnd && poi.t >= neighborLen - nearThreshold) candidates.push(poi);
        }
      }
    }
  }

  if (candidates.length === 0) {
    if (allPois.length === 0) return null;
    return allPois[Math.floor(Math.random() * allPois.length)];
  }
  return candidates[Math.floor(Math.random() * candidates.length)];
}

/**
 * Plan a route to the current agenda goal. Mutates nothing; returns the new
 * pendingRoute + final-walkway clampT, or null if planning failed (caller
 * should re-queue or drop the goal).
 */
function planRoute(
  p: PedestrianState,
  ctx: PedestrianTickContext
): { pendingRoute: string[]; routeTargetT: number; targetPoiId: string } | null {
  const goal = p.agenda[0];
  if (!goal) return null;

  let targetPoi: PoiDef | null = null;
  if (goal.kind === 'VisitPoi' || goal.kind === 'Exit') {
    targetPoi = ctx.pois.get(goal.poiId) ?? null;
  } else if (goal.kind === 'Wander') {
    targetPoi = resolveWanderTarget(p, ctx.pois, ctx);
  }
  if (!targetPoi) return null;

  const currentEnds = ctx.graph.walkwayEndpoints.get(p.currentWalkwayId);
  if (!currentEnds) return null;

  // Same walkway already — no macro routing, just adjust clampT and go.
  if (targetPoi.walkwayId === p.currentWalkwayId) {
    // Determine direction to reach POI from current progress.
    const newDirection: 1 | -1 = targetPoi.t >= p.localProgress ? 1 : -1;
    p.direction = newDirection;
    return {
      pendingRoute: [],
      routeTargetT: targetPoi.t,
      targetPoiId: targetPoi.poiId,
    };
  }

  // Try BOTH endpoints of the current walkway as candidate starting nodes
  // and pick the shorter route. The pedestrian can reverse on the current
  // walkway, so committing to the endpoint they happen to be heading toward
  // forces unnecessary detours (e.g. walking to the end of a walkway and
  // then doubling all the way back).
  //
  // Try the current-direction endpoint first so ties preserve direction.
  const primary = p.direction === 1 ? currentEnds[1] : currentEnds[0];
  const secondary = p.direction === 1 ? currentEnds[0] : currentEnds[1];
  let best: { route: ReturnType<typeof routeBetweenWalkways>; fromNode: string } | null = null;
  for (const candidate of [primary, secondary]) {
    const r = routeBetweenWalkways(
      ctx.graph,
      p.currentWalkwayId,
      candidate,
      targetPoi.walkwayId,
      ctx.routeStrategy
    );
    if (!r) continue;
    if (!best || r.walkways.length < best.route!.walkways.length) {
      best = { route: r, fromNode: candidate };
    }
  }
  if (!best || !best.route) return null;

  // Orient the ped toward the chosen fromNode so local traversal carries them there.
  p.direction = best.fromNode === currentEnds[1] ? 1 : -1;

  return {
    pendingRoute: best.route.walkways,
    routeTargetT: targetPoi.t,
    targetPoiId: targetPoi.poiId,
  };
}

/**
 * Pick travel direction for a freshly-entered walkway so the pedestrian moves
 * AWAY from the endpoint it just entered through.
 */
function directionForEnteringWalkway(
  walkway: WalkwayDef,
  enteredAtNodeId: string,
  graph: WalkwayGraph
): 1 | -1 {
  const ends = graph.walkwayEndpoints.get(walkway.walkwayId);
  if (!ends) return 1;
  // If entered at polyline[0] node → go toward polyline[N-1] (direction=1), else reverse.
  return ends[0] === enteredAtNodeId ? 1 : -1;
}

/** Advance a single pedestrian one tick. Returns a NEW state object. */
export function tickPedestrian(
  prev: PedestrianState,
  dtMs: number,
  ctx: PedestrianTickContext
): PedestrianState {
  // Work on a shallow clone so the caller can treat the return as immutable.
  const p: PedestrianState = {
    ...prev,
    agenda: [...prev.agenda],
    pendingRoute: [...prev.pendingRoute],
    recentlyVisitedPoiIds: [...prev.recentlyVisitedPoiIds],
  };

  switch (p.fsmState) {
    case 'Idle': {
      // Need a goal. Ambient pedestrians always have a Wander refill outside
      // the FSM (see usePedestrians), so an empty agenda means "stay put".
      if (p.agenda.length === 0) return p;
      p.fsmState = 'Planning';
      return p;
    }

    case 'Planning': {
      const plan = planRoute(p, ctx);
      if (!plan) {
        // Drop this goal; the crowd loop will refill.
        p.agenda.shift();
        p.fsmState = 'Idle';
        return p;
      }
      p.pendingRoute = plan.pendingRoute;
      p.routeTargetT = plan.routeTargetT;
      p.targetPoiId = plan.targetPoiId;
      p.fsmState = 'Traveling';
      return p;
    }

    case 'Traveling': {
      const walkway = ctx.walkways.get(p.currentWalkwayId);
      if (!walkway) {
        // Data error — reset to Idle; caller can recover.
        p.fsmState = 'Idle';
        return p;
      }

      const isFinalWalkway = p.pendingRoute.length === 0;
      const clampT = isFinalWalkway ? p.routeTargetT : null;

      const traversal = getTraversalStrategy(walkway.traversalKind);
      const peers = ctx.allPedestrians
        ?.filter(o => o.id !== p.id && o.currentWalkwayId === p.currentWalkwayId)
        .map(o => ({ id: o.id, t: o.localProgress, direction: o.direction }));
      const travCtx: TraversalContext = { peersOnWalkway: peers };

      const step = traversal.advance(walkway, p.localProgress, p.direction, dtMs, clampT, travCtx);
      p.localProgress = step.t;

      if (step.reachedEnd) {
        if (isFinalWalkway) {
          // Reached the POI — enter Interacting.
          const currentGoal = p.agenda[0];
          const dwellMs = currentGoal && (currentGoal.kind === 'VisitPoi' || currentGoal.kind === 'Wander')
            ? currentGoal.dwellMs
            : 0;
          p.fsmState = 'Interacting';
          p.interactUntilMs = ctx.tMs + dwellMs;
          return p;
        }
        // Cross junction to next walkway in the route.
        const nextWalkwayId = p.pendingRoute.shift()!;
        const nextWalkway = ctx.walkways.get(nextWalkwayId);
        if (!nextWalkway) {
          p.fsmState = 'Idle';
          return p;
        }
        // The junction node we just arrived at is the endpoint of current walkway
        // in the direction of travel.
        const currentEnds = ctx.graph.walkwayEndpoints.get(p.currentWalkwayId);
        if (!currentEnds) {
          p.fsmState = 'Idle';
          return p;
        }
        const arrivedNodeId = p.direction === 1 ? currentEnds[1] : currentEnds[0];

        p.currentWalkwayId = nextWalkwayId;
        p.direction = directionForEnteringWalkway(nextWalkway, arrivedNodeId, ctx.graph);
        // Reset local progress to the entering endpoint (in iso units).
        p.localProgress = p.direction === 1 ? 0 : polylineLength(nextWalkway.polyline);
      }
      return p;
    }

    case 'Interacting': {
      if (p.interactUntilMs !== undefined && ctx.tMs >= p.interactUntilMs) {
        // Record this visit so local wander avoids re-picking the same stalls.
        // Cap the history at RECENT_POI_HISTORY_LIMIT (drop oldest).
        if (p.targetPoiId) {
          p.recentlyVisitedPoiIds.push(p.targetPoiId);
          if (p.recentlyVisitedPoiIds.length > RECENT_POI_HISTORY_LIMIT) {
            p.recentlyVisitedPoiIds.splice(0, p.recentlyVisitedPoiIds.length - RECENT_POI_HISTORY_LIMIT);
          }
        }
        p.agenda.shift();
        p.interactUntilMs = undefined;
        p.routeTargetT = null;
        p.targetPoiId = undefined;
        p.fsmState = 'Idle';
      }
      return p;
    }
  }
}

/** Helper: refill agenda for ambient pedestrians so they wander forever. */
export function ensureAmbientAgenda(p: PedestrianState, wanderDwellMs: number): PedestrianState {
  if (p.agenda.length > 0) return p;
  const goal: AgendaGoal = { kind: 'Wander', dwellMs: wanderDwellMs };
  return { ...p, agenda: [goal] };
}
