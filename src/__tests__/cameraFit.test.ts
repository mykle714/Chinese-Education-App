import { describe, it, expect } from 'vitest';
import {
  footprintScreenBounds,
  fitZoomForBounds,
  computeMinZoom,
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
