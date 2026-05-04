import { describe, it, expect } from 'vitest';
import {
  polylineLength,
  pointAtT,
  linearTraversal,
} from '../../utils/walkwayTraversal';
import type { WalkwayDef } from '../../config/nightMarketRegistry';

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function makeWalkway(polyline: [[number, number], ...Array<[number, number]>], speed = 20): WalkwayDef {
  return { walkwayId: 'test', displayName: 'Test', polyline: polyline as [[number, number], [number, number]], traversalKind: 'linear', speedIsoPerSec: speed };
}

// ---------------------------------------------------------------------------
// polylineLength
// ---------------------------------------------------------------------------

describe('polylineLength', () => {
  it('returns 0 for a degenerate single-point polyline', () => {
    expect(polylineLength([[0, 0]])).toBe(0);
  });

  it('measures a horizontal segment correctly', () => {
    expect(polylineLength([[0, 0], [80, 0]])).toBe(80);
  });

  it('measures a vertical segment correctly', () => {
    expect(polylineLength([[0, 0], [0, 60]])).toBe(60);
  });

  it('sums multiple segments', () => {
    // L-shape: 30 + 40 = 70
    expect(polylineLength([[0, 0], [30, 0], [30, 40]])).toBe(70);
  });
});

// ---------------------------------------------------------------------------
// pointAtT (t is now iso distance from polyline[0])
// ---------------------------------------------------------------------------

describe('pointAtT', () => {
  it('returns polyline[0] at t=0', () => {
    const { isoPos } = pointAtT([[10, 20], [90, 20]], 0);
    expect(isoPos).toEqual([10, 20]);
  });

  it('returns polyline[N-1] at t=totalLength', () => {
    const { isoPos } = pointAtT([[10, 20], [90, 20]], 80);
    expect(isoPos).toEqual([90, 20]);
  });

  it('returns the midpoint at t=totalLength/2', () => {
    const { isoPos } = pointAtT([[0, 0], [100, 0]], 50);
    expect(isoPos[0]).toBeCloseTo(50);
    expect(isoPos[1]).toBeCloseTo(0);
  });

  it('clamps t below 0 to polyline[0]', () => {
    const { isoPos } = pointAtT([[0, 0], [50, 0]], -10);
    expect(isoPos).toEqual([0, 0]);
  });

  it('clamps t above totalLength to polyline[N-1]', () => {
    const { isoPos } = pointAtT([[0, 0], [50, 0]], 999);
    expect(isoPos).toEqual([50, 0]);
  });

  it('reports correct heading for a horizontal east-going segment', () => {
    const { headingIso } = pointAtT([[0, 0], [100, 0]], 30);
    expect(headingIso[0]).toBeCloseTo(1);
    expect(headingIso[1]).toBeCloseTo(0);
  });
});

// ---------------------------------------------------------------------------
// linearTraversal.advance — speed is in iso units
// ---------------------------------------------------------------------------

describe('linearTraversal.advance', () => {
  it('advances by speedIsoPerSec iso units per second (direction=1)', () => {
    const w = makeWalkway([[0, 0], [200, 0]], 25);
    const step = linearTraversal.advance(w, 0, 1, 1000, null);
    expect(step.t).toBeCloseTo(25);
  });

  it('advances backward by speedIsoPerSec iso units per second (direction=-1)', () => {
    const w = makeWalkway([[0, 0], [200, 0]], 25);
    const step = linearTraversal.advance(w, 100, -1, 1000, null);
    expect(step.t).toBeCloseTo(75);
  });

  it('clamps at walkway end (totalLength), not 1', () => {
    const w = makeWalkway([[0, 0], [40, 0]], 100); // speed=100, so 1s overshoots
    const step = linearTraversal.advance(w, 35, 1, 1000, null);
    expect(step.t).toBe(40);
    expect(step.reachedEnd).toBe(true);
  });

  it('clamps at 0 when traveling backward past start', () => {
    const w = makeWalkway([[0, 0], [40, 0]], 100);
    const step = linearTraversal.advance(w, 5, -1, 1000, null);
    expect(step.t).toBe(0);
    expect(step.reachedEnd).toBe(true);
  });

  it('stops at clampT when traveling forward', () => {
    const w = makeWalkway([[0, 0], [200, 0]], 100);
    const step = linearTraversal.advance(w, 0, 1, 1000, 30);
    expect(step.t).toBe(30);
    expect(step.reachedEnd).toBe(true);
  });

  it('stops at clampT when traveling backward', () => {
    const w = makeWalkway([[0, 0], [200, 0]], 100);
    const step = linearTraversal.advance(w, 100, -1, 1000, 80);
    expect(step.t).toBe(80);
    expect(step.reachedEnd).toBe(true);
  });

  it('does not reach end when clampT is not crossed', () => {
    const w = makeWalkway([[0, 0], [200, 0]], 10); // slow: 10 iso/s
    const step = linearTraversal.advance(w, 0, 1, 500, 30); // moves 5 units, target 30
    expect(step.t).toBeCloseTo(5);
    expect(step.reachedEnd).toBe(false);
  });
});
