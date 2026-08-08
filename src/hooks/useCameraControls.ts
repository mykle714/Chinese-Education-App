import { useCallback, useEffect, useRef, useState } from 'react';
import {
  WHEEL_IDLE_MS,
  ZOOM_SETTLE_MS,
  clampZoom,
  easeOutCubic,
  lerpZoom,
  panAfterZoom,
  snapToLadder,
  wheelDeltaPixels,
  zoomForWheel,
  type CameraPan,
} from '../engine/market/cameraZoom';

/**
 * useCameraControls — the single pan/zoom camera host shared by every night-market surface.
 *
 * LAYER: shared hook. Owns the `pan` + `zoom` state, the DOM gesture listeners (wheel, pinch,
 * context-menu suppression) and the settle tween. The pure math lives one layer down in
 * {@link ../engine/market/cameraZoom}; the fit-derived zoom floor lives in
 * {@link ../engine/market/cameraFit}. This hook contains NO surface-specific behaviour — every
 * difference between the three cameras is a value in {@link UseCameraControlsOptions}.
 *
 * WHY. nmp ({@link ../features/nightmarket/MarketEngineViewer}), nms
 * ({@link ../features/nightmarket/TemplateSandboxViewer}) and nme
 * ({@link ../features/nightmarket/TemplateEditorViewer}) each carried a near-identical copy of
 * `applyZoomAtPoint` + `handleWheel` + the `ready` mount latch, differing only in floor / ladder
 * step / cap. Three copies meant the smooth-zoom rework would otherwise have been written three
 * times, and the nme copy had already drifted (no fit-derived floor, no sub-floor branch).
 *
 * GESTURE MODEL — smooth during, crisp at rest:
 *   1. Every input event moves the zoom CONTINUOUSLY and geometrically. No snapping mid-gesture,
 *      so a pinch tracks the fingers exactly and a trackpad's 50 events/sec read as one glide.
 *   2. When the gesture goes quiet (finger lift, or {@link WHEEL_IDLE_MS} of wheel silence) the
 *      camera SETTLES: a {@link ZOOM_SETTLE_MS} eased tween onto the nearest ladder rung, about
 *      the same focal point the gesture used, so the pixel-art comes to rest on a clean scale.
 *   3. Sub-floor zooms (a world too big to fit at `crispFloor`) never settle — that range has no
 *      ladder by design.
 *
 * DRAG-TO-PAN IS NOT HERE. Each surface reads pointer drags inside its own Pixi scene, where it
 * already has to arbitrate against tile painting / template dragging / placement mode. Those
 * scenes push their result in through {@link CameraControlsApi.setPan}.
 *
 * Referenced by / referenced in:
 *   - src/features/nightmarket/MarketEngineViewer.tsx (nmp — the only pinch-enabled surface)
 *   - src/features/nightmarket/TemplateSandboxViewer.tsx (nms)
 *   - src/features/nightmarket/TemplateEditorViewer.tsx (nme)
 *   - docs/NIGHT_MARKET_FEATURE.md § "Camera (pan / zoom)"
 */

export interface UseCameraControlsOptions {
  /**
   * The smallest zoom whose art still resamples acceptably, and the FLOOR OF THE LADDER the
   * camera settles onto (nmp 0.5, nms/nme 1).
   */
  crispFloor: number;
  /** Zoom-in cap — a legibility choice, never derived from world size. */
  maxZoom: number;
  /** Ladder spacing at/above {@link crispFloor} (nmp 0.5, nms/nme 1). */
  ladderStep: number;
  /** Zoom on mount. */
  initialZoom: number;
  /** Pan on mount. Defaults to the origin. */
  initialPan?: CameraPan;
  /**
   * Optional world-size-derived floor BELOW {@link crispFloor}, letting a market that has outgrown
   * the crisp floor keep pulling back until it fits (see {@link ../engine/market/cameraFit}).
   * Read lazily at gesture time against the live element size. Omit for a fixed floor.
   */
  minZoomFor?: (el: HTMLDivElement) => number;
  /**
   * Optional pan limiter — bounds where the camera may travel so the world can never be dragged
   * off screen into empty space. Called on EVERY pan write (drag, focal-point zoom correction,
   * settle tween), so it must be cheap and pure.
   *
   * Surface-agnostic by design: the hook knows nothing about placements, so nmp passes a closure
   * over {@link ../engine/market/cameraFit clampPan}, which keeps the point under the screen centre
   * inside the placement bbox and ignores `el` (that rule is viewport-independent). `el` is still
   * handed over for clamps that do need the viewport, matching `minZoomFor` above. Omit the whole
   * option for an unbounded pan — nms/nme do, since authoring means dragging into empty space.
   */
  clampPan?: (pan: CameraPan, zoom: number, el: HTMLDivElement) => CameraPan;
  /** Enable two-finger pinch zoom. Default false (desktop-only authoring surfaces). */
  enablePinch?: boolean;
  /**
   * Called when the USER starts a zoom gesture (wheel tick or pinch start) — never for a
   * programmatic zoom or for the settle tween. Surfaces use it to drop any camera mode the user has
   * just overridden by grabbing the camera themselves; nmp releases its pedestrian lock here
   * (see {@link ../engine/market/cameraFollow}). Drag-to-pan is NOT reported: drags are read by
   * each scene, so a scene that cares detects the release there.
   */
  onZoomGesture?: () => void;
  /** Suppress the browser context menu, for surfaces that pan on right-drag. Default false. */
  suppressContextMenu?: boolean;
}

export interface CameraControlsApi {
  /** Attach to the element that hosts the Pixi `<Application resizeTo={...}>`. */
  containerRef: React.RefObject<HTMLDivElement | null>;
  pan: CameraPan;
  zoom: number;
  /**
   * Set the pan (from a scene's drag handler, or a one-off centring effect). Keeps the ref in sync
   * and runs {@link UseCameraControlsOptions.clampPan}, so a scene's raw drag delta needs no
   * bounds knowledge of its own.
   */
  setPan: (pan: CameraPan) => void;
  /**
   * Re-run the pan clamp against the CURRENT pan. Call when the clamp's inputs change but the pan
   * did not — the world finished loading, or the viewport resized — since nothing else would notice
   * that the existing pan has become out of bounds.
   */
  reclampPan: () => void;
  /** True while a pinch is in flight — pass to the scene so it suppresses single-pointer drag. */
  isPinchingRef: React.RefObject<boolean>;
  /** Flips true once the container element exists, gating the `<Application>` mount. */
  ready: boolean;
}

export function useCameraControls(options: UseCameraControlsOptions): CameraControlsApi {
  const containerRef = useRef<HTMLDivElement>(null);
  const [pan, setPanState] = useState<CameraPan>(options.initialPan ?? { x: 0, y: 0 });
  const [zoom, setZoomState] = useState(options.initialZoom);
  const [ready, setReady] = useState(false);

  // Live mirrors so the gesture handlers (registered once, natively, for `passive: false`) read the
  // current camera without being recreated on every render.
  const panRef = useRef(pan);
  panRef.current = pan;
  const zoomRef = useRef(zoom);
  zoomRef.current = zoom;

  // Options are read through a ref for the same reason — a caller that passes an inline
  // `minZoomFor` closure must not tear down and re-register the listeners each render.
  const optsRef = useRef(options);
  optsRef.current = options;

  const isPinchingRef = useRef(false);
  const pinchRef = useRef({ active: false, startDist: 0, startZoom: 1, midX: 0, midY: 0 });

  // Settle bookkeeping: the rAF handle of a running tween and the wheel-idle timer that starts one.
  const settleRafRef = useRef<number | null>(null);
  const settleTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  useEffect(() => {
    if (containerRef.current) setReady(true);
  }, []);

  /** The single pan write path — every caller goes through the clamp. */
  const setPan = useCallback((next: CameraPan) => {
    const el = containerRef.current;
    const clamp = optsRef.current.clampPan;
    const bounded = el && clamp ? clamp(next, zoomRef.current, el) : next;
    // Drop writes that don't move the camera. Matters for the per-frame callers (nmp's pedestrian
    // follow): once the clamp pins the pan at a market edge, every frame would otherwise commit a
    // fresh-but-identical object and re-render the whole scene tree for nothing.
    const prev = panRef.current;
    if (bounded.x === prev.x && bounded.y === prev.y) return;
    panRef.current = bounded;
    setPanState(bounded);
  }, []);

  const reclampPan = useCallback(() => { setPan(panRef.current); }, [setPan]);

  /** The camera's live floor: the fit-derived value when the surface supplies one, else the crisp floor. */
  const resolveMinZoom = useCallback((el: HTMLDivElement) => {
    const { crispFloor, minZoomFor } = optsRef.current;
    return minZoomFor ? minZoomFor(el) : crispFloor;
  }, []);

  /**
   * Move to `rawZoom` (clamped, NOT snapped) while pinning the screen point (focalX, focalY).
   * This is the one write path for the camera — the gesture handlers and the settle tween both
   * go through it, so the focal-point pan correction can never disagree between them.
   */
  const applyZoomAtPoint = useCallback((focalX: number, focalY: number, rawZoom: number) => {
    const el = containerRef.current;
    if (!el) return;
    const next = clampZoom(rawZoom, resolveMinZoom(el), optsRef.current.maxZoom);
    const current = zoomRef.current;
    if (next === current) return;
    const nextPan = panAfterZoom(panRef.current, focalX, focalY, el.clientWidth, el.clientHeight, next / current);
    // Commit the zoom BEFORE the pan so `setPan`'s clamp is evaluated against the new scale — the
    // pan limits are zoom-dependent (a further-out camera may pan further), and clamping against
    // the outgoing zoom would fight the focal-point correction on the frame the scale changes.
    zoomRef.current = next;
    setZoomState(next);
    setPan(nextPan);
  }, [resolveMinZoom, setPan]);

  const cancelSettle = useCallback(() => {
    if (settleRafRef.current !== null) {
      cancelAnimationFrame(settleRafRef.current);
      settleRafRef.current = null;
    }
    if (settleTimerRef.current !== null) {
      clearTimeout(settleTimerRef.current);
      settleTimerRef.current = null;
    }
  }, []);

  /**
   * Tween the camera onto its nearest ladder rung about (focalX, focalY). No-op when already on a
   * rung, or when sitting below the crisp floor (that range is continuous by design — see
   * {@link snapToLadder}).
   */
  const startSettle = useCallback((focalX: number, focalY: number) => {
    cancelSettle();
    const { crispFloor, ladderStep, maxZoom } = optsRef.current;
    const from = zoomRef.current;
    if (from < crispFloor) return;
    const target = snapToLadder(from, ladderStep, crispFloor, maxZoom);
    if (target === from) return;

    const startedAt = performance.now();
    const step = (now: number) => {
      const t = Math.min(1, (now - startedAt) / ZOOM_SETTLE_MS);
      // Land exactly on the rung on the final frame — the eased value only asymptotes to it.
      applyZoomAtPoint(focalX, focalY, t >= 1 ? target : lerpZoom(from, target, easeOutCubic(t)));
      settleRafRef.current = t < 1 ? requestAnimationFrame(step) : null;
    };
    settleRafRef.current = requestAnimationFrame(step);
  }, [applyZoomAtPoint, cancelSettle]);

  // ─── Wheel ───────────────────────────────────────────────────────────────────
  const handleWheel = useCallback((e: WheelEvent) => {
    e.preventDefault();
    const el = containerRef.current;
    if (!el) return;
    cancelSettle(); // a fresh event supersedes any pending/running settle
    optsRef.current.onZoomGesture?.();
    const rect = el.getBoundingClientRect();
    const focalX = e.clientX - rect.left;
    const focalY = e.clientY - rect.top;
    applyZoomAtPoint(focalX, focalY, zoomForWheel(zoomRef.current, wheelDeltaPixels(e.deltaY, e.deltaMode)));
    settleTimerRef.current = setTimeout(() => startSettle(focalX, focalY), WHEEL_IDLE_MS);
  }, [applyZoomAtPoint, cancelSettle, startSettle]);

  // ─── Pinch ───────────────────────────────────────────────────────────────────
  // Registered in the CAPTURE phase so the touches are preventDefault-ed before Pixi's own
  // pointer handling turns the two-finger gesture into a drag.
  const handleTouchStart = useCallback((e: TouchEvent) => {
    if (!optsRef.current.enablePinch || e.touches.length !== 2) return;
    const el = containerRef.current;
    if (!el) return;
    e.preventDefault();
    cancelSettle();
    optsRef.current.onZoomGesture?.();
    isPinchingRef.current = true;
    const [t0, t1] = [e.touches[0], e.touches[1]];
    const rect = el.getBoundingClientRect();
    const dx = t1.clientX - t0.clientX;
    const dy = t1.clientY - t0.clientY;
    pinchRef.current = {
      active: true,
      startDist: Math.hypot(dx, dy),
      startZoom: zoomRef.current,
      // The midpoint is captured ONCE at gesture start and held: re-deriving it per move would let
      // a two-finger slide double as a pan, which fights the scene's own drag-to-pan.
      midX: (t0.clientX + t1.clientX) / 2 - rect.left,
      midY: (t0.clientY + t1.clientY) / 2 - rect.top,
    };
  }, [cancelSettle]);

  const handleTouchMove = useCallback((e: TouchEvent) => {
    const pinch = pinchRef.current;
    if (!pinch.active || e.touches.length !== 2) return;
    e.preventDefault();
    if (pinch.startDist <= 0) return; // degenerate start (both fingers on one point)
    const [t0, t1] = [e.touches[0], e.touches[1]];
    const dist = Math.hypot(t1.clientX - t0.clientX, t1.clientY - t0.clientY);
    // Continuous: the finger separation ratio IS the zoom ratio, with no rung quantisation.
    applyZoomAtPoint(pinch.midX, pinch.midY, pinch.startZoom * (dist / pinch.startDist));
  }, [applyZoomAtPoint]);

  const handleTouchEnd = useCallback(() => {
    if (!pinchRef.current.active) return;
    pinchRef.current.active = false;
    isPinchingRef.current = false;
    // Settle about the pinch midpoint, so the rung the camera lands on grows out of the same point
    // the user was zooming toward.
    startSettle(pinchRef.current.midX, pinchRef.current.midY);
  }, [startSettle]);

  const handleContextMenu = useCallback((e: MouseEvent) => { e.preventDefault(); }, []);

  // ─── Listener registration ───────────────────────────────────────────────────
  // Keyed on `ready` (the element only exists after the mount latch flips). All handlers are
  // stable, so this runs once per surface.
  useEffect(() => {
    const el = containerRef.current;
    if (!el) return;
    const { enablePinch, suppressContextMenu } = optsRef.current;

    el.addEventListener('wheel', handleWheel, { passive: false });
    if (enablePinch) {
      el.addEventListener('touchstart', handleTouchStart, { passive: false, capture: true });
      el.addEventListener('touchmove', handleTouchMove, { passive: false });
      el.addEventListener('touchend', handleTouchEnd);
      el.addEventListener('touchcancel', handleTouchEnd);
    }
    if (suppressContextMenu) el.addEventListener('contextmenu', handleContextMenu);

    return () => {
      el.removeEventListener('wheel', handleWheel);
      if (enablePinch) {
        el.removeEventListener('touchstart', handleTouchStart, { capture: true });
        el.removeEventListener('touchmove', handleTouchMove);
        el.removeEventListener('touchend', handleTouchEnd);
        el.removeEventListener('touchcancel', handleTouchEnd);
      }
      if (suppressContextMenu) el.removeEventListener('contextmenu', handleContextMenu);
    };
  }, [ready, handleWheel, handleTouchStart, handleTouchMove, handleTouchEnd, handleContextMenu]);

  // A settle tween outliving its component would call setState on an unmounted tree.
  useEffect(() => cancelSettle, [cancelSettle]);

  return { containerRef, pan, zoom, setPan, reclampPan, isPinchingRef, ready };
}

export default useCameraControls;
