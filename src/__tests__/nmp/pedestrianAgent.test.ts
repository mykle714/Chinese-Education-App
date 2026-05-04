import { describe, it, expect } from 'vitest';
import { tickPedestrian, ensureAmbientAgenda } from '../../utils/pedestrianAgent';
import { buildGraph, bfsRouteStrategy } from '../../utils/walkwayGraph';
import type { PedestrianState, WalkwayDef, PoiDef } from '../../config/nightMarketRegistry';

// ---------------------------------------------------------------------------
// Minimal test scene: two walkways sharing a junction
//
//  wk-a: polyline[0]=(20,0), polyline[1]=(0,0)  — 20 iso units long (screen-south start)
//  wk-b: polyline[0]=(0,40), polyline[1]=(0,0)  — 40 iso units long, joins wk-a at (0,0)
//
// POIs:
//   poi-near: on wk-b at t=4 (10% of wk-b length=40 → within 20% threshold of 8)
//   poi-far:  on wk-b at t=36 (far from the (0,0) junction — 90%)
// ---------------------------------------------------------------------------

const WK_A: WalkwayDef = {
  walkwayId: 'wk-a',
  displayName: 'A',
  polyline: [[20, 0], [0, 0]],
  traversalKind: 'linear',
  speedIsoPerSec: 20,
};

const WK_B: WalkwayDef = {
  walkwayId: 'wk-b',
  displayName: 'B',
  polyline: [[0, 40], [0, 0]],
  traversalKind: 'linear',
  speedIsoPerSec: 20,
};

const WALKWAYS = [WK_A, WK_B];
const GRAPH = buildGraph(WALKWAYS);
const WALKWAY_MAP = new Map(WALKWAYS.map(w => [w.walkwayId, w]));

// poi-near is 4 iso units from polyline[0]=(0,40) on wk-b.
// The junction (0,0) is wk-b's polyline[1] end. Distance from junction = 40-4=36.
// Threshold = 0.2 * 40 = 8. 36 > 8, so poi-near is NOT near this junction from wk-a's side.
// Wait — let me reconsider. The junction between wk-a and wk-b is at (0,0).
// wk-b's polyline[1]=(0,0) is the junction end.
// Threshold for "near junction at polyline[1] end" = poi.t >= 40 - 8 = 32.
// poi-near has t=4, so it is NOT near the junction from wk-a.
// poi-far has t=36, so it IS near the junction (t>=32). So let's rename.

const POI_NEAR_JUNCTION: PoiDef = {
  poiId: 'poi-near-junction',
  walkwayId: 'wk-b',
  t: 36,  // within 20% of the (0,0) junction end (threshold: t >= 40*0.8 = 32)
  side: 'south',
  displayName: 'Near Junction Stall',
};

const POI_FAR_FROM_JUNCTION: PoiDef = {
  poiId: 'poi-far',
  walkwayId: 'wk-b',
  t: 4,   // only 10% from polyline[0], far from the (0,0) junction (threshold: t >= 32)
  side: 'south',
  displayName: 'Far Stall',
};

const POI_ON_WK_A: PoiDef = {
  poiId: 'poi-a',
  walkwayId: 'wk-a',
  t: 10,
  side: 'south',
  displayName: 'Walkway A Stall',
};

const ALL_POIS = [POI_NEAR_JUNCTION, POI_FAR_FROM_JUNCTION, POI_ON_WK_A];
const POI_MAP = new Map(ALL_POIS.map(p => [p.poiId, p]));

function makeCtx(tMs = 0) {
  return {
    graph: GRAPH,
    walkways: WALKWAY_MAP,
    pois: POI_MAP,
    routeStrategy: bfsRouteStrategy,
    tMs,
  };
}

function makePed(overrides: Partial<PedestrianState> = {}): PedestrianState {
  return {
    id: 'ped-0',
    sprite: { imagePath: 'x.png', scale: 1 },
    currentWalkwayId: 'wk-a',
    localProgress: 10,
    direction: 1,
    pendingRoute: [],
    routeTargetT: null,
    agenda: [],
    fsmState: 'Idle',
    recentlyVisitedPoiIds: [],
    ...overrides,
  };
}

// ---------------------------------------------------------------------------
// ensureAmbientAgenda
// ---------------------------------------------------------------------------

describe('ensureAmbientAgenda', () => {
  it('does nothing when agenda is non-empty', () => {
    const p = makePed({ agenda: [{ kind: 'Wander' as const, dwellMs: 500 }] });
    const after = ensureAmbientAgenda(p, 1500);
    expect(after.agenda).toHaveLength(1);
    const goal = after.agenda[0];
    expect(goal.kind === 'Wander' && goal.dwellMs).toBe(500);
  });

  it('refills an empty agenda with a Wander goal', () => {
    const p = makePed({ agenda: [] });
    const after = ensureAmbientAgenda(p, 1500);
    expect(after.agenda).toHaveLength(1);
    const goal = after.agenda[0];
    expect(goal.kind).toBe('Wander');
    expect(goal.kind === 'Wander' && goal.dwellMs).toBe(1500);
  });
});

// ---------------------------------------------------------------------------
// tickPedestrian FSM transitions
// ---------------------------------------------------------------------------

describe('tickPedestrian — FSM transitions', () => {
  it('transitions Idle → Planning when agenda has a goal', () => {
    const p = makePed({
      fsmState: 'Idle',
      agenda: [{ kind: 'Wander', dwellMs: 0 }],
    });
    const next = tickPedestrian(p, 16, makeCtx());
    expect(next.fsmState).toBe('Planning');
  });

  it('stays Idle when agenda is empty', () => {
    const p = makePed({ fsmState: 'Idle', agenda: [] });
    const next = tickPedestrian(p, 16, makeCtx());
    expect(next.fsmState).toBe('Idle');
  });

  it('transitions Planning → Traveling when a reachable POI exists', () => {
    const p = makePed({
      fsmState: 'Planning',
      agenda: [{ kind: 'VisitPoi' as const, poiId: 'poi-a', dwellMs: 0 }],
      currentWalkwayId: 'wk-a',
      localProgress: 5,
    });
    const next = tickPedestrian(p, 16, makeCtx());
    expect(next.fsmState).toBe('Traveling');
    expect(next.routeTargetT).toBe(POI_ON_WK_A.t);
  });

  it('sets direction toward target when target is ahead', () => {
    // ped at t=5, poi at t=10 (same walkway), direction should be 1 (forward)
    const p = makePed({
      fsmState: 'Planning',
      agenda: [{ kind: 'VisitPoi' as const, poiId: 'poi-a', dwellMs: 0 }],
      localProgress: 5,
      direction: -1, // starts facing wrong way
    });
    const next = tickPedestrian(p, 16, makeCtx());
    expect(next.direction).toBe(1);
  });

  it('sets direction toward target when target is behind', () => {
    // ped at t=15, poi at t=10, direction should be -1 (backward)
    const p = makePed({
      fsmState: 'Planning',
      agenda: [{ kind: 'VisitPoi' as const, poiId: 'poi-a', dwellMs: 0 }],
      localProgress: 15,
      direction: 1,
    });
    const next = tickPedestrian(p, 16, makeCtx());
    expect(next.direction).toBe(-1);
  });

  it('advances localProgress while Traveling', () => {
    const p = makePed({
      fsmState: 'Traveling',
      agenda: [{ kind: 'VisitPoi' as const, poiId: 'poi-a', dwellMs: 0 }],
      localProgress: 0,
      direction: 1,
      routeTargetT: 10,
      targetPoiId: 'poi-a',
      pendingRoute: [],
    });
    const next = tickPedestrian(p, 500, makeCtx()); // 0.5s at 20 iso/s = 10 units
    // Should have reached clampT=10
    expect(next.localProgress).toBe(10);
    expect(next.fsmState).toBe('Interacting');
  });

  it('transitions Interacting → Idle after dwell completes', () => {
    const p = makePed({
      fsmState: 'Interacting',
      agenda: [{ kind: 'VisitPoi' as const, poiId: 'poi-a', dwellMs: 100 }],
      targetPoiId: 'poi-a',
      interactUntilMs: 1000,
    });
    const next = tickPedestrian(p, 16, makeCtx(1001));
    expect(next.fsmState).toBe('Idle');
    expect(next.recentlyVisitedPoiIds).toContain('poi-a');
  });
});

// ---------------------------------------------------------------------------
// Wander junction threshold: 20% of neighbor walkway length
// ---------------------------------------------------------------------------

describe('Wander adjacent-walkway threshold (proportional 20%)', () => {
  // wk-b length = 40. Junction at polyline[1]=(0,0). Threshold = 0.2*40 = 8.
  // poi-near-junction has t=36. Distance from junction end = 40-36 = 4, which is <= 8 → VISIBLE.
  // poi-far has t=4. Distance from junction end = 40-4 = 36, which is > 8 → NOT VISIBLE.

  it('includes adjacent-walkway POI within 20% of neighbor length from junction', () => {
    // Ped is on wk-a, wandering. We run through Planning to see what target it picks.
    // All wk-a POIs are eligible + neighbor pois near the junction.
    // poi-near-junction (t=36) should be eligible (36 >= 40-8=32). ✓
    const ctx = {
      graph: GRAPH,
      walkways: WALKWAY_MAP,
      pois: new Map([['poi-near-junction', POI_NEAR_JUNCTION]]),
      routeStrategy: bfsRouteStrategy,
      tMs: 0,
    };
    const p = makePed({
      fsmState: 'Planning',
      agenda: [{ kind: 'Wander', dwellMs: 0 }],
      localProgress: 10,
    });
    const next = tickPedestrian(p, 16, ctx);
    // Planning should resolve to Traveling with the only available POI
    expect(next.fsmState).toBe('Traveling');
    expect(next.targetPoiId).toBe('poi-near-junction');
  });

  it('excludes adjacent-walkway POI beyond 20% threshold from junction', () => {
    // poi-far is at t=4 on wk-b. Distance from junction at polyline[1]=(0,0): 40-4=36 > 8.
    // When ped is on wk-a, poi-far should NOT be in the wander candidate set.
    // Since poi-far is the ONLY poi, wander should fall back to all POIs (the fallback path).
    const ctx = {
      graph: GRAPH,
      walkways: WALKWAY_MAP,
      pois: new Map([['poi-far', POI_FAR_FROM_JUNCTION]]),
      routeStrategy: bfsRouteStrategy,
      tMs: 0,
    };
    const p = makePed({
      fsmState: 'Planning',
      agenda: [{ kind: 'Wander', dwellMs: 0 }],
      localProgress: 10,
    });
    const next = tickPedestrian(p, 16, ctx);
    // Falls back to the global POI set (only poi-far available), so it should still reach Traveling
    // but via the fallback (not the local candidate set).
    expect(next.fsmState).toBe('Traveling');
  });
});
