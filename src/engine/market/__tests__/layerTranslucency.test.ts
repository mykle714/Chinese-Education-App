import { describe, expect, it } from 'vitest';
import { GHOST_ALPHA, SLOT_FADE, alphaForSlot, isSlotGhosted } from '../layerTranslucency';

/**
 * Tests for the zoom-peel fade curve ({@link ../layerTranslucency}).
 *
 * The invariants that matter to the render layers, in order of how badly a regression would show:
 *   1. Contents (entity/background) NEVER fade — a merchant dissolving is a visible bug.
 *   2. The shell is fully opaque at every zoom at or below its threshold.
 *   3. Outer layers peel BEFORE inner ones (overlay before foreground), so a zoom-in reads as
 *      "sign clears, then roof clears" instead of the whole building dissolving at once.
 */
describe('alphaForSlot', () => {
  it('never fades the layers the peel is meant to reveal', () => {
    for (const zoom of [0.5, 1, 3, 4, 8, 10, 1000]) {
      expect(alphaForSlot('entity', zoom)).toBe(1);
      expect(alphaForSlot('background', zoom)).toBe(1);
    }
  });

  it('holds a fading slot fully opaque up to and including its threshold', () => {
    const { fadeAt } = SLOT_FADE.overlay!;
    expect(alphaForSlot('overlay', fadeAt - 1)).toBe(1);
    expect(alphaForSlot('overlay', fadeAt)).toBe(1);
    expect(isSlotGhosted('overlay', fadeAt)).toBe(false);
  });

  it('settles at the residual ghost alpha past the far end of the window', () => {
    const { fadeAt, window } = SLOT_FADE.overlay!;
    expect(alphaForSlot('overlay', fadeAt + window)).toBe(GHOST_ALPHA);
    expect(alphaForSlot('overlay', fadeAt + window + 5)).toBe(GHOST_ALPHA);
  });

  it('ramps monotonically down across the window, never below the residual', () => {
    const { fadeAt, window } = SLOT_FADE.overlay!;
    let prev = 1;
    for (let t = 0; t <= 1.0001; t += 0.1) {
      const a = alphaForSlot('overlay', fadeAt + window * t);
      expect(a).toBeLessThanOrEqual(prev + 1e-9); // non-increasing
      expect(a).toBeGreaterThanOrEqual(GHOST_ALPHA - 1e-9);
      prev = a;
    }
  });

  it('peels the outermost slot first — overlay is always at or ahead of foreground', () => {
    expect(SLOT_FADE.overlay!.fadeAt).toBeLessThan(SLOT_FADE.foreground!.fadeAt);
    for (let zoom = 0.5; zoom <= 10; zoom += 0.5) {
      expect(alphaForSlot('overlay', zoom)).toBeLessThanOrEqual(alphaForSlot('foreground', zoom));
    }
  });

  it('returns full opacity for a non-finite zoom rather than flashing a ghost', () => {
    // A camera host that has not measured its viewport yet can briefly hand down NaN.
    expect(alphaForSlot('overlay', Number.NaN)).toBe(1);
    expect(alphaForSlot('overlay', Number.POSITIVE_INFINITY)).toBe(1);
  });
});
