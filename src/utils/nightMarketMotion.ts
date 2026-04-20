import type { FrameAnimation, MotionSpec } from '../config/nightMarketRegistry';

/**
 * Pure, time-driven evaluators for night-market motion and frame animation.
 *
 * These are called from the canvas render loop in MarketViewer. They never touch
 * React state — the only input is the current time (performance.now()), so the
 * same tMs always produces the same output.
 */

/**
 * Compute the current isometric offset (dIsoX, dIsoY) for a motion spec at time t.
 *
 * The returned values are *offsets* from the asset's base (isoX, isoY), not
 * absolute positions. Because `isoToScreen` is linear, a caller can convert
 * these directly into a screen-space delta without knowing the base.
 */
export function evaluateMotion(spec: MotionSpec, tMs: number): { dIsoX: number; dIsoY: number } {
  switch (spec.kind) {
    case 'loopLinear': {
      const cycle = tMs % spec.durationMs;
      let progress = cycle / spec.durationMs;
      if (spec.pingPong) {
        // Triangle wave: 0 → 1 → 0 over the full duration
        progress = progress < 0.5 ? progress * 2 : (1 - progress) * 2;
      }
      const [fx, fy] = spec.fromIso;
      const [tx, ty] = spec.toIso;
      return {
        dIsoX: fx + (tx - fx) * progress,
        dIsoY: fy + (ty - fy) * progress,
      };
    }
    case 'sineBob': {
      const theta = (2 * Math.PI * tMs) / spec.periodMs;
      return { dIsoX: 0, dIsoY: spec.amplitudeIsoY * Math.sin(theta) };
    }
    case 'orbit': {
      const theta = (2 * Math.PI * tMs) / spec.periodMs + (spec.phase ?? 0);
      return {
        dIsoX: spec.radiusIso * Math.cos(theta),
        dIsoY: spec.radiusIso * Math.sin(theta),
      };
    }
  }
}

/**
 * Pick the current frame image from a preloaded frame list at time t.
 * Non-looping animations clamp to the last frame after completing one cycle.
 */
export function currentFrameImage(
  anim: FrameAnimation,
  frames: HTMLImageElement[],
  tMs: number
): HTMLImageElement {
  const n = frames.length;
  if (n <= 1) return frames[0];
  const rawIndex = Math.floor((tMs * anim.fps) / 1000);
  const loop = anim.loop ?? true;
  const idx = loop ? rawIndex % n : Math.min(rawIndex, n - 1);
  return frames[idx];
}
