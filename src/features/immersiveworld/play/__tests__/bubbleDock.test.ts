import { describe, it, expect } from 'vitest';
import { bubbleDock, bubbleOverhang, bubbleTopFloor, DOCK_MARGIN_PX, DOCK_RANGE_PX } from '../bubbleDock';

const LAYER = { width: 400, height: 700 };
const SIZE = { width: 200, height: 60 };

describe('bubbleOverhang', () => {
  it('is zero while the whole bubble fits', () => {
    expect(bubbleOverhang({ x: 200, y: 300 }, SIZE, LAYER)).toBe(0);
  });

  it('measures the worst edge', () => {
    // Bottom of the bubble is at y=300; its top is 60px above, i.e. 40px above the margin.
    expect(bubbleOverhang({ x: 200, y: DOCK_MARGIN_PX + 20 }, SIZE, LAYER)).toBe(40);
    // Off the right: right edge at 500 against a 400-wide layer minus the margin.
    expect(bubbleOverhang({ x: 400, y: 300 }, SIZE, LAYER)).toBe(108);
  });
});

describe('bubbleDock', () => {
  it('leaves an on-screen bubble exactly over the head', () => {
    const placed = bubbleDock({ anchor: { x: 200, y: 300 }, size: SIZE, layer: LAYER, stackOffset: 0 });
    expect(placed).toEqual({ x: 200, y: 300, t: 0 });
  });

  it('docks to the top centre once the overhang passes the blend range', () => {
    const placed = bubbleDock({
      anchor: { x: -DOCK_RANGE_PX * 2, y: 300 }, size: SIZE, layer: LAYER, stackOffset: 0,
    });
    expect(placed.t).toBe(1);
    expect(placed.x).toBe(LAYER.width / 2);
    expect(placed.y).toBe(DOCK_MARGIN_PX + SIZE.height);
  });

  it('blends continuously in between, never jumping', () => {
    // Walk the anchor off the left edge one pixel at a time; no step may move the painted
    // position more than a few pixels, which is what "transitions smoothly" means here.
    let prev = bubbleDock({ anchor: { x: 200, y: 300 }, size: SIZE, layer: LAYER, stackOffset: 0 });
    for (let x = 199; x > -300; x -= 1) {
      const next = bubbleDock({ anchor: { x, y: 300 }, size: SIZE, layer: LAYER, stackOffset: 0 });
      expect(next.t).toBeGreaterThanOrEqual(prev.t - 1e-9);
      expect(Math.abs(next.x - prev.x)).toBeLessThan(6);
      expect(Math.abs(next.y - prev.y)).toBeLessThan(6);
      prev = next;
    }
    expect(prev.t).toBe(1);
  });

  it('stacks a second docked bubble below the first', () => {
    const anchor = { x: -500, y: 300 };
    const first = bubbleDock({ anchor, size: SIZE, layer: LAYER, stackOffset: 0 });
    const second = bubbleDock({ anchor, size: SIZE, layer: LAYER, stackOffset: SIZE.height + 6 });
    expect(second.y).toBeGreaterThan(first.y);
    expect(second.y - first.y).toBe(SIZE.height + 6);
  });

  /**
   * The 2026-09-09 regression: a speaker standing high in the scene overhangs the top by a
   * few dozen pixels, so `t` is near zero and the blend alone leaves the bubble almost
   * exactly where it was — with its header row (name + replay button) sliced off by the
   * layer's `overflow: hidden`.
   */
  it('never lets the bubble top rise above the margin, however small the overhang', () => {
    // Bottom at 48 puts the 60-tall bubble's top at -12, i.e. 20px past the margin. That is
    // only 20/140 of the blend range, so docking on its own moves it by about a pixel.
    const anchor = { x: 200, y: DOCK_MARGIN_PX + 40 };
    const placed = bubbleDock({ anchor, size: SIZE, layer: LAYER, stackOffset: 0 });
    expect(placed.t).toBeLessThan(0.1);
    // What the blend alone would have painted: still clipped, by nearly the full 20px.
    expect(anchor.y + (DOCK_MARGIN_PX + SIZE.height - anchor.y) * placed.t).toBeLessThan(50);
    expect(placed.y).toBe(bubbleTopFloor(SIZE));
    expect(placed.y - SIZE.height).toBe(DOCK_MARGIN_PX);
  });

  it('keeps the clamped bubble in the speaker\'s own column', () => {
    // The clamp is vertical ONLY — x is untouched, which is what keeps attribution intact.
    const placed = bubbleDock({ anchor: { x: 200, y: 0 }, size: SIZE, layer: LAYER, stackOffset: 0 });
    expect(placed.x).toBeCloseTo(200, 5);
  });

  it('stays continuous as the anchor walks off the top edge', () => {
    let prev = bubbleDock({ anchor: { x: 200, y: 300 }, size: SIZE, layer: LAYER, stackOffset: 0 });
    for (let y = 299; y > -300; y -= 1) {
      const next = bubbleDock({ anchor: { x: 200, y }, size: SIZE, layer: LAYER, stackOffset: 0 });
      expect(next.y).toBeGreaterThanOrEqual(bubbleTopFloor(SIZE) - 1e-9);
      expect(Math.abs(next.y - prev.y)).toBeLessThan(6);
      expect(Math.abs(next.x - prev.x)).toBeLessThan(6);
      prev = next;
    }
  });

  it('does not dock when the layer has not been measured yet', () => {
    const placed = bubbleDock({
      anchor: { x: -500, y: 300 }, size: SIZE, layer: { width: 0, height: 0 }, stackOffset: 0,
    });
    expect(placed.t).toBe(0);
  });
});
