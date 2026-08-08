import { describe, it, expect } from 'vitest';
import { isoToScreen } from '../engine/market/isometric';
import {
  FOLLOW_LIFT_PX,
  FOLLOW_TAU_MS,
  approachPan,
  followPanFor,
} from '../engine/market/cameraFollow';

/**
 * Tests for the nmp pedestrian camera-lock math
 * ({@link ../engine/market/cameraFollow}), driven per frame by `PedestrianTicker` in
 * {@link ../features/nightmarket/MarketEngineViewer}.
 * See docs/NIGHT_MARKET_FEATURE.md § "Pedestrian camera lock".
 */

describe('followPanFor', () => {
  it('puts the ped at the viewport centre — pan is the negated, zoomed world point', () => {
    const { screenX, screenY } = isoToScreen(7, 3);
    const pan = followPanFor(7, 3, 2);
    // Re-deriving the on-screen position: centre + pan + world·zoom must land back on the centre.
    expect(screenX * 2 + pan.x).toBeCloseTo(0);
    expect((screenY - FOLLOW_LIFT_PX) * 2 + pan.y).toBeCloseTo(0);
  });

  it('aims above the foot point so the body, not the feet, sits on the centre', () => {
    const pan = followPanFor(0, 0, 1);
    const foot = followPanFor(0, 0, 1, 0);
    // Aiming higher up the sprite pushes the world DOWN the screen, so the foot point ends up just
    // below centre and the torso lands on it: a larger pan.y than the unlifted framing.
    expect(pan.y).toBeGreaterThan(foot.y);
    expect(pan.y - foot.y).toBeCloseTo(FOLLOW_LIFT_PX);
  });

  it('scales with zoom — the same ped needs twice the pan at twice the zoom', () => {
    const a = followPanFor(5, 5, 1);
    const b = followPanFor(5, 5, 2);
    expect(b.x).toBeCloseTo(a.x * 2);
  });
});

describe('approachPan', () => {
  const current = { x: 0, y: 0 };
  const target = { x: 100, y: -50 };

  it('closes 1 − 1/e of the gap in one time constant', () => {
    const next = approachPan(current, target, FOLLOW_TAU_MS);
    expect(next.x).toBeCloseTo(100 * (1 - Math.exp(-1)), 5);
    expect(next.y).toBeCloseTo(-50 * (1 - Math.exp(-1)), 5);
  });

  it('is frame-rate independent — two 8ms steps ≈ one 16ms step', () => {
    const oneBig = approachPan(current, target, 16);
    const twoSmall = approachPan(approachPan(current, target, 8), target, 8);
    expect(twoSmall.x).toBeCloseTo(oneBig.x, 6);
  });

  it('never overshoots, however long the frame', () => {
    const next = approachPan(current, target, 100_000);
    expect(next.x).toBeLessThanOrEqual(target.x);
    expect(next.x).toBeCloseTo(target.x, 5);
  });

  it('returns the target object itself once inside the settle epsilon', () => {
    // Sub-epsilon gap → identical object back, so the caller's `next.x !== pan.x` check goes false
    // and a stationary ped stops re-committing the pan every frame.
    const nearlyThere = { x: target.x - 0.001, y: target.y + 0.001 };
    expect(approachPan(nearlyThere, target, 16)).toBe(target);
    // A gap the eye can see still eases.
    expect(approachPan({ x: target.x - 5, y: target.y }, target, 16)).not.toBe(target);
  });

  it('treats a zero-length frame as no movement', () => {
    expect(approachPan(current, target, 0)).toEqual(current);
  });
});
