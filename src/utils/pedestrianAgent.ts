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

import type {
  PedestrianState,
  WalkwayDef,
  PoiDef,
  AgendaGoal,
  PedestrianFsmState,
} from '../config/nightMarketRegistry';
import {
  getTraversalStrategy,
  pointAtT,
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

/** Project a pedestrian's current state to a render-space drawable. */
export function computeDrawable(
  p: PedestrianState,
  walkways: Map<string, WalkwayDef>,
  pois?: Map<string, PoiDef>
): PedestrianDrawable | null {
  const w = walkways.get(p.currentWalkwayId);
  if (!w) return null;
  const { isoPos, headingIso } = pointAtT(w.polyline, p.localProgress);
  const targetPoiDisplayName =
    p.fsmState === 'Traveling' && p.targetPoiId && pois
      ? pois.get(p.targetPoiId)?.displayName
      : undefined;
  return {
    id: p.id,
    isoX: isoPos[0],
    isoY: isoPos[1],
    heading: p.direction === 1 ? headingIso : [-headingIso[0], -headingIso[1]],
    imagePath: p.sprite.imagePath,
    scale: p.sprite.scale ?? 1.0,
    fsmState: p.fsmState,
    targetPoiDisplayName,
  };
}

/** Resolve an agenda Wander goal by picking any random POI. */
function resolveWanderTarget(
  _p: PedestrianState,
  pois: Map<string, PoiDef>
): PoiDef | null {
  const all = [...pois.values()];
  if (all.length === 0) return null;
  return all[Math.floor(Math.random() * all.length)];
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
    targetPoi = resolveWanderTarget(p, ctx.pois);
  }
  if (!targetPoi) return null;

  // Determine which graph node the pedestrian is leaving from. Pedestrians
  // route from the endpoint they're CURRENTLY HEADED TOWARD — their local
  // traversal will carry them there, then the route takes over.
  const currentEnds = ctx.graph.walkwayEndpoints.get(p.currentWalkwayId);
  if (!currentEnds) return null;
  const fromNode = p.direction === 1 ? currentEnds[1] : currentEnds[0];

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

  const route = routeBetweenWalkways(
    ctx.graph,
    p.currentWalkwayId,
    fromNode,
    targetPoi.walkwayId,
    ctx.routeStrategy
  );
  if (!route) return null;

  return {
    pendingRoute: route.walkways,
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
  const p: PedestrianState = { ...prev, agenda: [...prev.agenda], pendingRoute: [...prev.pendingRoute] };

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
        // Reset local progress to the entering endpoint.
        p.localProgress = p.direction === 1 ? 0 : 1;
      }
      return p;
    }

    case 'Interacting': {
      if (p.interactUntilMs !== undefined && ctx.tMs >= p.interactUntilMs) {
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
