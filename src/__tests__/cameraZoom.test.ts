import { describe, it, expect } from 'vitest';
import {
  WHEEL_ZOOM_PER_NOTCH,
  clampZoom,
  easeOutCubic,
  lerpZoom,
  panAfterZoom,
  snapToLadder,
  wheelDeltaPixels,
  zoomForWheel,
} from '../engine/market/cameraZoom';

/**
 * Tests for the camera zoom math shared by all three night-market surfaces via
 * {@link ../hooks/useCameraZoom} — nmp ({@link ../features/nightmarket/MarketEngineViewer}),
 * nms ({@link ../features/nightmarket/TemplateSandboxViewer}) and nme
 * ({@link ../features/nightmarket/TemplateEditorViewer}).
 * See docs/NIGHT_MARKET_FEATURE.md § "Camera (pan / zoom)".
 */

describe('wheelDeltaPixels', () => {
  it('passes pixel-mode deltas through unchanged', () => {
    expect(wheelDeltaPixels(-100, 0)).toBe(-100);
  });

  it('scales line-mode and page-mode deltas up so the wheel is not dead in Firefox', () => {
    expect(wheelDeltaPixels(3, 1)).toBe(48);
    expect(wheelDeltaPixels(1, 2)).toBe(100);
  });
});

describe('zoomForWheel', () => {
  it('zooms IN on a negative delta (scroll up) by exactly one notch ratio', () => {
    expect(zoomForWheel(1, -100)).toBeCloseTo(WHEEL_ZOOM_PER_NOTCH, 10);
  });

  it('zooms OUT on a positive delta by the inverse ratio', () => {
    expect(zoomForWheel(WHEEL_ZOOM_PER_NOTCH, 100)).toBeCloseTo(1, 10);
  });

  it('is geometric — the same delta gives the same RATIO at any zoom', () => {
    const lowRatio = zoomForWheel(0.5, -40) / 0.5;
    const highRatio = zoomForWheel(7, -40) / 7;
    expect(lowRatio).toBeCloseTo(highRatio, 10);
  });

  it('moves continuously: a small trackpad delta is a small change, not a whole rung', () => {
    const next = zoomForWheel(1, -6);
    expect(next).toBeGreaterThan(1);
    expect(next).toBeLessThan(1.05);
  });
});

describe('snapToLadder', () => {
  it('lands on the nearest nmp half-step', () => {
    expect(snapToLadder(2.37, 0.5, 0.5, 8)).toBeCloseTo(2.5, 10);
    expect(snapToLadder(2.1, 0.5, 0.5, 8)).toBeCloseTo(2, 10);
  });

  it('lands on the nearest nms/nme whole number', () => {
    expect(snapToLadder(3.4, 1, 1, 10)).toBe(3);
    expect(snapToLadder(3.6, 1, 1, 10)).toBe(4);
  });

  it('never returns a rung outside [crispFloor, maxZoom]', () => {
    expect(snapToLadder(0.2, 0.5, 0.5, 8)).toBe(0.5);
    expect(snapToLadder(99, 0.5, 0.5, 8)).toBe(8);
  });

  it('degenerates to a clamp for a non-positive step rather than dividing by zero', () => {
    expect(snapToLadder(4.3, 0, 1, 10)).toBe(4.3);
  });
});

describe('clampZoom', () => {
  it('honours a sub-floor fitted minimum', () => {
    expect(clampZoom(0.1, 0.28, 8)).toBeCloseTo(0.28, 10);
    expect(clampZoom(0.4, 0.28, 8)).toBeCloseTo(0.4, 10);
  });
});

describe('panAfterZoom', () => {
  it('keeps the viewport centre fixed with no pan change', () => {
    const next = panAfterZoom({ x: 0, y: 0 }, 400, 300, 800, 600, 2);
    expect(next).toEqual({ x: 0, y: 0 });
  });

  it('pins an off-centre focal point across the zoom', () => {
    const viewportW = 800;
    const viewportH = 600;
    const pan = { x: 30, y: -20 };
    const focalX = 600;
    const focalY = 150;
    const oldZoom = 2;
    const newZoom = 3;
    const next = panAfterZoom(pan, focalX, focalY, viewportW, viewportH, newZoom / oldZoom);

    // The world point under the focal point before the zoom...
    const worldX = (focalX - viewportW / 2 - pan.x) / oldZoom;
    const worldY = (focalY - viewportH / 2 - pan.y) / oldZoom;
    // ...must still project to the same screen point after it.
    expect(viewportW / 2 + next.x + worldX * newZoom).toBeCloseTo(focalX, 8);
    expect(viewportH / 2 + next.y + worldY * newZoom).toBeCloseTo(focalY, 8);
  });

  it('is a no-op at ratio 1', () => {
    const pan = { x: 12, y: 34 };
    expect(panAfterZoom(pan, 100, 100, 800, 600, 1)).toEqual(pan);
  });
});

describe('lerpZoom / easeOutCubic', () => {
  it('hits both endpoints exactly', () => {
    expect(lerpZoom(2.37, 2.5, 0)).toBeCloseTo(2.37, 10);
    expect(lerpZoom(2.37, 2.5, 1)).toBeCloseTo(2.5, 10);
    expect(easeOutCubic(0)).toBe(0);
    expect(easeOutCubic(1)).toBe(1);
  });

  it('interpolates in log space — the midpoint is the geometric mean, not the arithmetic one', () => {
    expect(lerpZoom(1, 4, 0.5)).toBeCloseTo(2, 10);
  });

  it('eases OUT — more than half the distance is covered by the halfway point', () => {
    expect(easeOutCubic(0.5)).toBeGreaterThan(0.5);
  });
});
