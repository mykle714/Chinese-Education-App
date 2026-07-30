/**
 * cameraZoom — the pure math behind the night-market cameras' zoom gesture.
 *
 * LAYER: engine (no React, no Pixi, no DOM types beyond plain numbers). Consumed by the one
 * React host {@link ../../hooks/useCameraZoom}, which is in turn used by all three camera
 * surfaces: nmp ({@link ../../features/nightmarket/MarketEngineViewer}), nms
 * ({@link ../../features/nightmarket/TemplateSandboxViewer}) and nme
 * ({@link ../../features/nightmarket/TemplateEditorViewer}).
 *
 * WHY THIS EXISTS. All three surfaces used to carry their own copy of `applyZoomAtPoint` +
 * `handleWheel`, differing only in floor/step/cap. Each copy SNAPPED the zoom to its ladder on
 * every single input event, which is what made the gesture feel steppy: a pinch's intermediate
 * finger travel was discarded, and one trackpad wheel event (of the ~50/sec a trackpad emits) was
 * promoted to a whole ladder step.
 *
 * THE MODEL: smooth during the gesture, crisp at rest.
 *   - While the user is actively zooming, zoom is CONTINUOUS — any float in [minZoom, maxZoom].
 *   - When the gesture goes quiet, the camera SETTLES: a short eased tween onto the nearest rung
 *     of the surface's ladder ({@link snapToLadder}), so the pixel-art ends up on a scale factor
 *     that resamples acceptably. Crispness is paid for once, at rest, instead of on every frame.
 *
 * ZOOM IS GEOMETRIC, NOT ADDITIVE. Zoom is a scale factor, so equal *ratios* — not equal
 * differences — read as equal amounts of motion. The old additive ladder (`current ± step`) made
 * 0.5→1 a +100% lurch and 7.5→8 a +6.7% nudge from the identical input. Every function here that
 * moves the zoom multiplies it.
 *
 * Referenced by / referenced in:
 *   - src/hooks/useCameraZoom.ts (sole consumer)
 *   - src/__tests__/cameraZoom.test.ts
 *   - docs/NIGHT_MARKET_FEATURE.md § "Camera (pan / zoom)"
 */

/** A camera pan offset in screen pixels, applied to the world container's centre. */
export interface CameraPan {
  x: number;
  y: number;
}

/**
 * Zoom ratio applied per 100px of wheel delta — one standard mouse-wheel notch. 1.5 is chosen so
 * a notch from the 1× default lands exactly on the nmp ladder's next rung (1.5), making the
 * settle a no-op for plain wheel users while a trackpad's small deltas still move continuously.
 */
export const WHEEL_ZOOM_PER_NOTCH = 1.5;

/** Wheel delta (in px) that constitutes one notch — the `deltaMode: DOM_DELTA_PIXEL` convention. */
const WHEEL_NOTCH_PX = 100;

/** Approximate px per line / per page, for browsers reporting `deltaMode` in lines or pages. */
const PX_PER_LINE = 16;
const PX_PER_PAGE = 100;

/** Duration of the settle tween that lands the camera on its ladder after a gesture ends. */
export const ZOOM_SETTLE_MS = 140;

/**
 * How long the wheel must be quiet before the settle fires. A trackpad emits a long burst of
 * small deltas for one physical swipe; snapping per-event would fight the gesture, so the settle
 * waits for the burst to end.
 */
export const WHEEL_IDLE_MS = 160;

/**
 * Normalise a wheel event's delta to pixels. Firefox reports lines (`deltaMode` 1) and some
 * configurations report pages (2); left unconverted, a line-mode delta of 3 would read as a 3px
 * nudge and the wheel would appear dead.
 */
export function wheelDeltaPixels(deltaY: number, deltaMode: number): number {
  if (deltaMode === 1) return deltaY * PX_PER_LINE;
  if (deltaMode === 2) return deltaY * PX_PER_PAGE;
  return deltaY;
}

/**
 * The zoom a wheel gesture of `deltaPx` moves `current` to. Negative delta (scroll up) zooms IN.
 * Geometric, so the perceived speed is identical at 0.5× and at 8×. Unclamped — the caller
 * applies its floor/cap.
 */
export function zoomForWheel(current: number, deltaPx: number): number {
  return current * Math.pow(WHEEL_ZOOM_PER_NOTCH, -deltaPx / WHEEL_NOTCH_PX);
}

/** Constrain a raw zoom to the camera's live floor and cap. */
export function clampZoom(raw: number, minZoom: number, maxZoom: number): number {
  return Math.max(minZoom, Math.min(maxZoom, raw));
}

/**
 * The nearest rung of the surface's zoom ladder — the scale factors whose resampling of the
 * pixel-art tileset is acceptable (nmp half-steps, nms/nme whole numbers).
 *
 * Only defined AT OR ABOVE `crispFloor`. Below it the ladder has run out: that range exists so a
 * world too large to fit at the crisp floor can still be seen whole ({@link ./cameraFit}), and it
 * is continuous and knowingly blurry, so there is nothing to snap to. Callers must not settle a
 * sub-floor zoom; this function clamps rather than inventing a rung.
 */
export function snapToLadder(raw: number, step: number, crispFloor: number, maxZoom: number): number {
  if (step <= 0) return clampZoom(raw, crispFloor, maxZoom);
  return clampZoom(Math.round(raw / step) * step, crispFloor, maxZoom);
}

/**
 * The pan that keeps the screen point (`focalX`, `focalY`) pinned to the same world point across a
 * zoom change of `ratio` (= newZoom / oldZoom).
 *
 * The world container is drawn at (viewport centre + pan) and scaled by zoom, so a world point's
 * screen position is `centre + pan + world·zoom`. Solving "same screen position before and after"
 * for the new pan gives the expression below — it is what makes the camera zoom toward the cursor
 * / pinch midpoint rather than toward the viewport centre.
 */
export function panAfterZoom(
  pan: CameraPan,
  focalX: number,
  focalY: number,
  viewportW: number,
  viewportH: number,
  ratio: number,
): CameraPan {
  return {
    x: (focalX - viewportW / 2) * (1 - ratio) + pan.x * ratio,
    y: (focalY - viewportH / 2) * (1 - ratio) + pan.y * ratio,
  };
}

/**
 * Ease-out cubic on [0, 1] — fast off the mark, gentle at the end. Used for the settle tween so
 * the snap reads as the camera coming to rest rather than as a second, separate motion.
 */
export function easeOutCubic(t: number): number {
  const inv = 1 - t;
  return 1 - inv * inv * inv;
}

/**
 * The zoom `progress` (0→1) of the way from `from` to `to`, interpolated GEOMETRICALLY. A linear
 * lerp between two scale factors decelerates visually as the numbers grow; interpolating in log
 * space keeps the perceived rate constant, matching the rest of this module.
 */
export function lerpZoom(from: number, to: number, progress: number): number {
  if (from <= 0 || to <= 0) return to;
  return from * Math.pow(to / from, progress);
}
