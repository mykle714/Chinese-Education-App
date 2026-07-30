import { describe, it, expect } from 'vitest';
import {
  footprintScreenBounds,
  fitZoomForBounds,
  computeMinZoom,
  clampPan,
  visibleCellWindow,
  ABSOLUTE_MIN_ZOOM,
  type CellFootprint,
} from '../engine/market/cameraFit';

/**
 * Tests for the size-derived zoom-out floor shared by nmp ({@link ../features/nightmarket/MarketEngineViewer})
 * and nms ({@link ../features/nightmarket/TemplateSandboxViewer}) — see
 * docs/NIGHT_MARKET_FEATURE.md § "Zoom-out floor scales with the world".
 */

const hub: CellFootprint = { offsetCol: 0, offsetRow: 0, width: 20, height: 20 };

describe('footprintScreenBounds', () => {
  it('returns null for an empty world', () => {
    expect(footprintScreenBounds([])).toBeNull();
  });

  it('spans a single footprint symmetrically in X around the diamond', () => {
    const b = footprintScreenBounds([hub])!;
    // X extremes are the east/west corner cells: ±(19 · 16) plus a half-tile margin.
    expect(b.maxX).toBeCloseTo(19 * 16 + 16);
    expect(b.minX).toBeCloseTo(-(19 * 16) - 16);
    expect(b.maxY).toBeGreaterThan(b.minY);
  });

  it('grows with a template placed far from the origin', () => {
    const near = footprintScreenBounds([hub])!;
    const far = footprintScreenBounds([hub, { offsetCol: 200, offsetRow: 0, width: 20, height: 20 }])!;
    expect(far.maxX - far.minX).toBeGreaterThan(near.maxX - near.minX);
  });

  it('handles negative offsets (templates spawned south/west of the hub)', () => {
    const b = footprintScreenBounds([hub, { offsetCol: -50, offsetRow: -50, width: 10, height: 10 }])!;
    expect(b.maxY).toBeGreaterThan(footprintScreenBounds([hub])!.maxY);
  });
});

describe('fitZoomForBounds', () => {
  it('is degenerate-safe (zero viewport → Infinity, so callers keep their static floor)', () => {
    const b = footprintScreenBounds([hub])!;
    expect(fitZoomForBounds(b, 0, 0)).toBe(Infinity);
  });

  it('shrinks as the world grows', () => {
    const small = fitZoomForBounds(footprintScreenBounds([hub])!, 1000, 800);
    const large = fitZoomForBounds(
      footprintScreenBounds([hub, { offsetCol: 300, offsetRow: 300, width: 20, height: 20 }])!,
      1000,
      800,
    );
    expect(large).toBeLessThan(small);
  });
});

describe('computeMinZoom', () => {
  it('keeps the authored crisp floor for a small world (no behavior change)', () => {
    expect(computeMinZoom([hub], 1200, 900, 0.5)).toBe(0.5);
    expect(computeMinZoom([hub], 1200, 900, 1)).toBe(1);
  });

  it('keeps the crisp floor when nothing is placed', () => {
    expect(computeMinZoom([], 1200, 900, 1)).toBe(1);
  });

  it('drops below the crisp floor once the world outgrows the viewport', () => {
    const sprawl: CellFootprint[] = [
      hub,
      { offsetCol: 400, offsetRow: 0, width: 20, height: 20 },
      { offsetCol: 0, offsetRow: 400, width: 20, height: 20 },
    ];
    const min = computeMinZoom(sprawl, 1200, 900, 0.5);
    expect(min).toBeLessThan(0.5);
    expect(min).toBeGreaterThanOrEqual(ABSOLUTE_MIN_ZOOM);
  });

  it('never pulls back past the absolute floor, however absurd the world', () => {
    const absurd: CellFootprint[] = [hub, { offsetCol: 100_000, offsetRow: 100_000, width: 20, height: 20 }];
    expect(computeMinZoom(absurd, 1200, 900, 0.5)).toBe(ABSOLUTE_MIN_ZOOM);
  });
});

// ─── Pan clamp ────────────────────────────────────────────────────────────────

/**
 * The clamp keeps the world point under the SCREEN CENTRE inside the placement bbox — nothing more.
 * It is deliberately viewport-independent (the viewport cancels out of the inversion), so these
 * tests pass no viewport at all. Exercised by nmp only: the authoring surfaces (nms/nme) pass no
 * `clampPan`, because placing a template requires dragging into empty space.
 */
describe('clampPan', () => {
  const wide: CellFootprint[] = [hub, { offsetCol: 300, offsetRow: -300, width: 20, height: 20 }];

  /** The world point the camera is looking at, inverted out of the pan — see `clampPan`'s docblock. */
  const centreOf = (pan: { x: number; y: number }, zoom: number) => ({
    x: -pan.x / zoom,
    y: -pan.y / zoom,
  });

  it('is a no-op when nothing is placed', () => {
    const pan = { x: 5000, y: -5000 };
    expect(clampPan(pan, [], 1)).toBe(pan);
  });

  it('is a no-op for a degenerate zoom', () => {
    const pan = { x: 9999, y: 9999 };
    expect(clampPan(pan, [hub], 0)).toBe(pan);
  });

  it('leaves a pan whose centre is already inside the bbox untouched', () => {
    // pan 0 looks at world (0,0), which is inside the hub's bbox.
    expect(clampPan({ x: 0, y: 0 }, wide, 1)).toEqual({ x: 0, y: 0 });
  });

  it('stops a runaway drag with the screen centre exactly on the bbox edge', () => {
    const b = footprintScreenBounds(wide)!;
    const centre = centreOf(clampPan({ x: 100_000, y: 100_000 }, wide, 1), 1);
    // A huge +pan drags the world right/down, i.e. the camera looks at the bbox's min corner.
    expect(centre.x).toBeCloseTo(b.minX);
    expect(centre.y).toBeCloseTo(b.minY);
  });

  it('clamps to the opposite corner for the opposite drag', () => {
    const b = footprintScreenBounds(wide)!;
    const centre = centreOf(clampPan({ x: -100_000, y: -100_000 }, wide, 1), 1);
    expect(centre.x).toBeCloseTo(b.maxX);
    expect(centre.y).toBeCloseTo(b.maxY);
  });

  it('clamps each axis independently', () => {
    const b = footprintScreenBounds(wide)!;
    // Runaway in x only; y asks for a centre well inside the bbox and is left alone.
    expect(-100).toBeGreaterThan(b.minY);
    expect(-100).toBeLessThan(b.maxY);
    const clamped = clampPan({ x: 100_000, y: 100 }, wide, 1);
    expect(centreOf(clamped, 1).x).toBeCloseTo(b.minX);
    expect(clamped.y).toBe(100);
  });

  it('scales the pan limit with zoom, so the reachable WORLD area is zoom-invariant', () => {
    const b = footprintScreenBounds(wide)!;
    for (const zoom of [0.5, 1, 2, 8]) {
      // However far in or out the camera is, the centre may reach exactly the bbox edge — no more.
      expect(centreOf(clampPan({ x: 1e6, y: 0 }, wide, zoom), zoom).x).toBeCloseTo(b.minX);
    }
    // The pan VALUE that corresponds to that edge is proportional to zoom.
    expect(clampPan({ x: 1e6, y: 0 }, wide, 2).x).toBeCloseTo(clampPan({ x: 1e6, y: 0 }, wide, 1).x * 2);
  });

  it('lets the centre roam a small world instead of pinning it centred', () => {
    // Documents the deliberate behaviour change: the old rule snapped an axis the world could not
    // cover to centred, so both of these collapsed to one value. Now the bbox is simply the set of
    // points the camera may look at, whatever its size.
    const a = clampPan({ x: 900, y: 900 }, [hub], 1);
    const b = clampPan({ x: -900, y: -900 }, [hub], 1);
    expect(a.x).not.toBeCloseTo(b.x);
    const bounds = footprintScreenBounds([hub])!;
    expect(centreOf(a, 1).x).toBeCloseTo(bounds.minX);
    expect(centreOf(b, 1).x).toBeCloseTo(bounds.maxX);
  });
});

// ─── Visible-cell window ──────────────────────────────────────────────────────

describe('visibleCellWindow', () => {
  it('brackets the cell under the viewport centre', () => {
    const w = visibleCellWindow({ x: 0, y: 0 }, 1, 400, 800);
    // Camera centre is the origin cell, so the window must contain (0,0).
    expect(w.minCol).toBeLessThanOrEqual(0);
    expect(w.maxCol).toBeGreaterThanOrEqual(0);
    expect(w.minRow).toBeLessThanOrEqual(0);
    expect(w.maxRow).toBeGreaterThanOrEqual(0);
  });

  it('covers more cells the further out the camera is', () => {
    const near = visibleCellWindow({ x: 0, y: 0 }, 2, 400, 800);
    const far = visibleCellWindow({ x: 0, y: 0 }, 0.5, 400, 800);
    expect(far.maxCol - far.minCol).toBeGreaterThan(near.maxCol - near.minCol);
  });

  it('follows the pan', () => {
    const home = visibleCellWindow({ x: 0, y: 0 }, 1, 400, 800);
    // Panning the world right moves the visible cells the other way.
    const shifted = visibleCellWindow({ x: -2000, y: 0 }, 1, 400, 800);
    expect(shifted.minCol).toBeGreaterThan(home.minCol);
  });

  it('is quantised, so small drags do not move it (memoisation depends on this)', () => {
    const a = visibleCellWindow({ x: 0, y: 0 }, 1, 400, 800);
    const b = visibleCellWindow({ x: 3, y: 3 }, 1, 400, 800);
    expect(b).toEqual(a);
  });
});
