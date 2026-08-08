import { isoToScreen } from './isometric';
import type { CameraPan } from './cameraZoom';

/**
 * cameraFollow — pure math for the nmp "lock the camera onto a pedestrian" mode.
 *
 * LAYER: engine (pure). No React, no Pixi. The stateful half lives in
 * {@link ../../features/nightmarket/MarketEngineViewer} (`lockedPedId` + the follow step inside
 * `PedestrianTicker`'s `useTick`), and the pan it produces is written through the one camera pan
 * path, {@link ../../hooks/useCameraControls}'s `setPan` — so the follow is clamped by the same
 * placement-bbox rule as a manual drag and can never travel off the market.
 *
 * WHY EXPONENTIAL SMOOTHING, not a fixed-duration tween: the target MOVES. A ped walks the whole
 * time the camera is chasing it, so a tween authored against a start/end pair would be stale on its
 * second frame. `approachPan` closes a constant FRACTION of the remaining gap per unit time, which
 * reads as a smooth glide on lock-on (the gap is large) and as tight tracking afterwards (the gap
 * is a few px per frame) with one parameter and no state.
 *
 * Referenced by / referenced in:
 *   - src/features/nightmarket/MarketEngineViewer.tsx (`PedestrianTicker` follow step)
 *   - docs/NIGHT_MARKET_FEATURE.md § "Pedestrian camera lock"
 */

/**
 * How far above a ped's foot point the camera aims, in pre-zoom world px. Peds are drawn
 * foot-anchored (`anchor.y = 1`), so centring their reported position would sit the sprite's FEET on
 * the viewport centre and push the body into the upper half. Roughly half a character's height.
 */
export const FOLLOW_LIFT_PX = 10;

/**
 * Smoothing time constant (ms): the gap to the target shrinks by 1/e every `FOLLOW_TAU_MS`.
 * 90ms closes ~96% of a lock-on jump in 300ms — a visible glide that never feels sluggish once it
 * has caught up.
 */
export const FOLLOW_TAU_MS = 90;

/** Below this remaining gap (screen px) the glide snaps to the target — see {@link approachPan}. */
export const FOLLOW_SETTLED_PX = 0.05;

/**
 * The pan that puts iso position (isoX, isoY) at the centre of the viewport.
 *
 * Derivation: the scene container is placed at (screenW/2 + pan.x, screenH/2 + pan.y) and scales its
 * children by `zoom`, so a child at world point (sx, sy) lands at screenW/2 + pan.x + sx·zoom. Set
 * that equal to the viewport centre (screenW/2) and the viewport size drops out entirely:
 * pan = −world · zoom. That is why this function needs no element dimensions.
 */
export function followPanFor(
  isoX: number,
  isoY: number,
  zoom: number,
  liftPx: number = FOLLOW_LIFT_PX,
): CameraPan {
  const { screenX, screenY } = isoToScreen(isoX, isoY);
  return { x: -screenX * zoom, y: -(screenY - liftPx) * zoom };
}

/**
 * Step `current` a frame's worth toward `target`. Frame-rate independent: the per-frame fraction is
 * derived from `dtMs` so a 30fps frame moves twice as far as a 60fps one and the glide takes the
 * same wall-clock time either way.
 *
 * Returns `target` EXACTLY once the gap is under {@link FOLLOW_SETTLED_PX}, so a caller can compare
 * the result against its current pan and skip the write when nothing moved (an asymptotic approach
 * would otherwise keep producing a new-but-identical-looking pan every frame forever).
 */
export function approachPan(
  current: CameraPan,
  target: CameraPan,
  dtMs: number,
  tauMs: number = FOLLOW_TAU_MS,
): CameraPan {
  const dx = target.x - current.x;
  const dy = target.y - current.y;
  if (Math.abs(dx) < FOLLOW_SETTLED_PX && Math.abs(dy) < FOLLOW_SETTLED_PX) return target;
  const alpha = 1 - Math.exp(-Math.max(0, dtMs) / tauMs);
  return { x: current.x + dx * alpha, y: current.y + dy * alpha };
}
