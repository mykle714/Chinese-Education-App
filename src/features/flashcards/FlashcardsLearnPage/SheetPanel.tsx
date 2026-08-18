import React, { useCallback, useRef, useLayoutEffect, useEffect, useImperativeHandle, forwardRef } from "react";
import { Box } from "@mui/material";
import { useDrag } from "@use-gesture/react";
import { EicScrim, InfoSheetContainer, InfoSheetGrabber } from "./styled";

// Imperative handle exposing the gesture-root wrapper and the inner scrollable
// container of whatever body a SheetPanel renders. SheetPanel attaches its
// touch listeners to `root` (so swipes anywhere on the panel feed the
// resize/scroll coupling) and reads `scroll.scrollTop` to decide between
// growing the sheet and letting native scroll take over.
export interface SheetPanelBodyHandle {
    root: HTMLDivElement | null;
    scroll: HTMLDivElement | null;
}

// Imperative handle exposed by SheetPanel so the parent can read the panel's
// live height when opening a child panel that should match it.
export interface SheetPanelHandle {
    getCurrentHeight: () => number | null;
}

interface SheetPanelProps {
    // Called once the dismiss animation has finished, so the host can unmount
    // the panel. OPTIONAL: a PERSISTENT panel (minHeight > 0) never dismisses,
    // so it has nothing to report. See the minHeight prop below.
    onClose?: () => void;
    // Resting FLOOR height in px. 0 (default) = the modal eip behaviour: the
    // panel can be dragged all the way down and that dismisses it.
    // > 0 makes the panel PERSISTENT page furniture (the /decks sheet): it
    // opens at this height, can never be dragged below it, and never closes.
    // The two resting stops become {minHeight, max} — there is no middle stop,
    // because a permanent sheet's "closed" state IS its floor.
    minHeight?: number;
    // Render the dimming scrim behind the sheet (default true). A persistent
    // sheet passes false: it is always on screen, so a scrim would darken the
    // page permanently and would have nothing to dismiss to on tap.
    showScrim?: boolean;
    // When provided, panel animates 0 → initialHeight on open instead of
    // 0 → natural-content height. Used by child panels stacked on top of a
    // parent so they appear at the same vertical extent.
    initialHeight?: number | null;
    // Stack depth (0 = root panel). Bumps z-index so child panels and their
    // scrims render above their parent.
    depth?: number;
    // Ref attached to the body content; exposes the gesture root + scroll
    // element so SheetPanel can wire its resize/scroll coupling.
    bodyRef: React.RefObject<SheetPanelBodyHandle | null>;
    // Identity for whatever component is currently mounted inside `children`
    // (e.g. "info" vs "compare"). SheetPanel is a single persistent instance
    // that can host different body components across its lifetime without
    // remounting itself, so a plain empty-deps effect can't tell the root/scroll
    // DOM nodes behind bodyRef changed. Bump this whenever the mounted body
    // swaps so the scroll-coupling effect below re-binds to the new nodes.
    bodyKey?: string | number;
    // Children can be a plain node or a render function that receives the
    // header-drag binder so an inner element (e.g. the EIP entry header) can
    // share the grabber's drag-to-resize gesture. useDrag's filterTaps option
    // keeps proper taps on header icons working.
    children: React.ReactNode | ((api: { bindHeaderDrag: ReturnType<typeof useDrag> }) => React.ReactNode);
    // Optional row rendered above the grabber (e.g. entry-tabs strip). Rendered
    // inside a drag-to-resize zone bound to bindHeaderDrag so a vertical drag
    // started on the entry tabs resizes the sheet just like the grabber/header
    // (this strip sits outside `root`, so the raw touch listeners don't reach
    // it — useDrag is the only path). useDrag's filterTaps keeps tab-selection
    // and the close-tab taps working.
    tabStrip?: React.ReactNode;
}

// ---------------------------------------------------------------------------
// Geometry + motion constants
// ---------------------------------------------------------------------------

// Sheet height as a fraction of the parent (screen) height.
const MAX_HEIGHT_RATIO = 0.92;
const DEFAULT_HEIGHT_RATIO = 0.6;

// Duration of every snap/dismiss animation.
const SNAP_DURATION_MS = 220;

// Multiplier applied to every vertical delta that resizes the sheet (grabber /
// tab-strip drag, touch resize, wheel resize, and release momentum — which
// inherits the scaling through applyResize). >1 makes the panel travel further
// than the finger for the same gesture; 1 is 1:1 tracking. Content scrolling is
// deliberately NOT scaled — only the resize path — so scrolling still feels
// native.
const RESIZE_SENSITIVITY = 1.1;

// Release velocity is measured over the most recent slice of the gesture, not
// over its whole life, so a slow drag that ends in a quick flick still flings.
// A release that lands more than this long after the last move is treated as a
// stationary release (velocity 0) — the finger was resting when it lifted.
const VELOCITY_WINDOW_MS = 90;

// Below this release speed (px/ms) there is no fling — the sheet just snaps.
const FLING_MIN_VELOCITY = 0.05;
// Momentum ends once it decays below this speed (px/ms).
const MOMENTUM_MIN_VELOCITY = 0.02;
// Per-frame decay, expressed at 60fps and rescaled by the real frame time.
const MOMENTUM_DECAY_PER_FRAME = 0.95;
// Frame-time cap for momentum integration. A long frame (GC, a heavy re-render,
// an app switch) must not teleport the sheet or nuke the velocity in one step —
// which is exactly how a fling used to "lose its momentum" on a janky frame.
const MOMENTUM_MAX_FRAME_MS = 32;

// Tolerance (px) for "the sheet is already at its maximum height". The height
// we write is fractional (parentHeight * MAX_HEIGHT_RATIO) and the height we
// read back via getBoundingClientRect() is snapped to the device pixel grid, so
// a maxed sheet routinely measures a hundredth of a pixel SHORT of the cap. An
// exact `h < maxHeight()` test therefore reads that as "still room to grow" and
// locks the gesture into "resize" — where the first move is instantly absorbed
// by the boundary and, because the mode lock is deliberately one-way, the
// content can never be scrolled again once the sheet is maxed. Comparing with
// this slack keeps a genuinely-maxed sheet in "scroll".
const AT_MAX_EPSILON_PX = 1;

const clamp = (v: number, lo: number, hi: number) => Math.max(lo, Math.min(hi, v));

// Shared snap rule used by every release path (grabber drag, touch release,
// momentum decay): below default → dismiss (0); at or above it → whichever of
// {default, max} is nearer. The default height is the floor — there is no
// resting stop between 0 and it.
//
// A PERSISTENT panel (minH > 0) has no dismiss stop at all: `defaultH` IS
// `minH`, nothing can go below it, so the rule degrades to "nearest of
// {minH, max}" via the same comparison.
function computeSnapTarget(h: number, defaultH: number, maxH: number, minH: number): number {
    if (h < defaultH && minH === 0) return 0;
    return Math.abs(defaultH - h) <= Math.abs(maxH - h) ? defaultH : maxH;
}

// Module-level set of currently mounted panel depths. The window-level wheel
// listener installed by each panel checks this set so only the top-most depth
// reacts to a given gesture (touch is already top-only via DOM hit-testing).
const mountedDepths = new Set<number>();

const SheetPanel = forwardRef<SheetPanelHandle, SheetPanelProps>(({
    onClose,
    initialHeight,
    minHeight = 0,
    showScrim = true,
    depth = 0,
    bodyRef,
    bodyKey,
    children,
    tabStrip,
}, ref) => {
    const sheetContainerRef = useRef<HTMLDivElement | null>(null);
    // ---- Height model -----------------------------------------------------
    // The sheet's height is driven IMPERATIVELY (heightRef + a direct write to
    // element.style.height), never through React state. Two reasons:
    //  1. Perf: callers pass `children` as a render function (see
    //     InfoCardSection), so a state update here re-renders the entire eip
    //     body — every touchmove and every momentum frame. Those long frames
    //     were what made flings stutter and die early.
    //  2. Correctness: only one code path owns the height, so a re-render can
    //     never resurrect a stale height mid-gesture.
    // `height` is deliberately absent from the JSX style prop, so React has no
    // record of it and will never overwrite what we write here.
    const heightRef = useRef(0);
    // Height the current grabber drag started from; null until that drag makes
    // its first real movement (see bindHeaderDrag).
    const dragStartHeightRef = useRef<number | null>(null);
    // Parent container height; the cap and the default stop derive from it.
    const parentHeightRef = useRef(0);
    // The height the sheet opens to. Doubles as the middle snap stop and the
    // dismiss floor: any release below this height snaps to 0 instead of
    // springing back up.
    const defaultHeightRef = useRef(0);
    const momentumRafRef = useRef<number | null>(null);
    const dismissTimerRef = useRef<number | null>(null);
    // True from the moment a dismiss animation starts; makes dismiss idempotent
    // and lets input handlers ignore events while the sheet is on its way out.
    const dismissingRef = useRef(false);
    // Latest onClose, read from timers without re-binding them.
    const onCloseRef = useRef(onClose);
    onCloseRef.current = onClose;

    // A panel with a floor is persistent: it cannot be dismissed, and every
    // path that would have shrunk it to 0 stops at the floor instead.
    const persistent = minHeight > 0;
    const maxHeight = useCallback(() => parentHeightRef.current * MAX_HEIGHT_RATIO, []);
    // Read from gesture handlers bound once per bodyKey, so the live value is
    // used rather than the one captured at bind time.
    const minHeightRef = useRef(minHeight);
    minHeightRef.current = minHeight;

    // The single writer for the sheet's height. `animate` turns the CSS height
    // transition on for this write and off for every other one — so grabbing a
    // snapping sheet mid-animation immediately returns to 1:1 finger tracking
    // instead of trailing the finger by the snap duration.
    const writeHeight = useCallback((h: number, animate = false) => {
        heightRef.current = h;
        const el = sheetContainerRef.current;
        if (!el) return;
        el.style.transition = animate ? `height ${SNAP_DURATION_MS}ms ease-out` : "none";
        el.style.height = `${h}px`;
    }, []);

    // Stop any in-flight height animation at exactly the height that is on
    // screen right now, and return it. A gesture must take over from what the
    // user sees, not from an animation's not-yet-reached target. Called on a
    // gesture's first real movement rather than at touch-down, so a plain tap
    // never interrupts the open animation.
    const freezeHeight = useCallback(() => {
        const el = sheetContainerRef.current;
        const h = el ? el.getBoundingClientRect().height : heightRef.current;
        writeHeight(h);
        return h;
    }, [writeHeight]);

    const stopMomentum = useCallback(() => {
        if (momentumRafRef.current !== null) {
            cancelAnimationFrame(momentumRafRef.current);
            momentumRafRef.current = null;
        }
    }, []);

    // Shrink to 0, then unmount. The close fires on a timer rather than
    // transitionend: the duration is ours, and a timer can't be missed if the
    // element is interrupted or the transition never fires.
    const dismiss = useCallback(() => {
        // A persistent panel has no closed state — every would-be dismiss snaps
        // back to the floor instead. This is a safety net: the gesture paths
        // below already refuse to dismiss when `persistent`.
        if (persistent) {
            writeHeight(minHeightRef.current, true);
            return;
        }
        if (dismissingRef.current) return;
        dismissingRef.current = true;
        stopMomentum();
        writeHeight(0, true);
        dismissTimerRef.current = window.setTimeout(() => {
            dismissTimerRef.current = null;
            onCloseRef.current?.();
        }, SNAP_DURATION_MS + 20);
    }, [persistent, stopMomentum, writeHeight]);

    // The one release rule, shared by every path that ends a gesture (grabber
    // drag release, touch release, momentum decay, momentum hitting a stop).
    const settle = useCallback(() => {
        const target = computeSnapTarget(heightRef.current, defaultHeightRef.current, maxHeight(), minHeightRef.current);
        if (target === 0) {
            dismiss();
            return;
        }
        if (target !== heightRef.current) writeHeight(target, true);
    }, [dismiss, maxHeight, writeHeight]);

    // Grow/shrink by a raw gesture delta (positive = grow). `minH` is the floor
    // for THIS caller: a live finger may drag all the way to 0 (that's how you
    // dismiss), while momentum floors at the default height so a fling can
    // never close the panel on its own. Returns false when the delta was fully
    // absorbed by a boundary, which every caller treats as a hard stop.
    const applyResize = useCallback((rawDy: number, minH: number): boolean => {
        const h = heightRef.current;
        const next = clamp(h + rawDy * RESIZE_SENSITIVITY, minH, maxHeight());
        if (next === h) return false;
        writeHeight(next);
        return true;
    }, [maxHeight, writeHeight]);

    // Play the open animation from 0 → target height on first render. The
    // panel's own open height is a fixed fraction of the parent (screen) height
    // rather than content-measured, so it's consistent across all eip tabs
    // regardless of how much content a given tab renders. Child panels that
    // pass initialHeight still match the parent panel's live height instead.
    useLayoutEffect(() => {
        if (!sheetContainerRef.current) return;
        const parentH = sheetContainerRef.current.parentElement?.clientHeight ?? window.innerHeight;
        parentHeightRef.current = parentH;
        // Resting height on mount, in priority order:
        //   1. explicit initialHeight (a child panel matching its parent's extent)
        //   2. the floor, for a persistent panel — it is already "closed", so
        //      there is no open animation to play and no default stop to grow to
        //   3. the modal default fraction of the screen
        const targetHeight = initialHeight != null
            ? Math.min(initialHeight, parentH * MAX_HEIGHT_RATIO)
            : persistent
                ? Math.min(minHeight, parentH * MAX_HEIGHT_RATIO)
                : parentH * DEFAULT_HEIGHT_RATIO;
        defaultHeightRef.current = targetHeight;
        if (persistent) {
            // Sits at its floor from the first paint — no 0 → height slide.
            writeHeight(targetHeight);
            return;
        }
        // Written before paint, so the sheet never flashes at its natural height.
        writeHeight(0);
        requestAnimationFrame(() => writeHeight(targetHeight, true));
        // eslint-disable-next-line react-hooks/exhaustive-deps
    }, []);

    // Cancel in-flight work if the panel is unmounted from the outside (e.g.
    // scrim tap, parent state change) while a fling or dismiss is running.
    useEffect(() => () => {
        stopMomentum();
        if (dismissTimerRef.current !== null) window.clearTimeout(dismissTimerRef.current);
    }, [stopMomentum]);

    useImperativeHandle(ref, () => ({
        getCurrentHeight: () => heightRef.current,
    }), []);

    // Drag the grabber / tab strip / entry header to resize the sheet.
    const bindHeaderDrag = useDrag(
        ({ first, last, tap, movement: [, my] }) => {
            // A tap on the header is not a resize gesture — skip the
            // snap-on-release logic so clicking the EIP header doesn't
            // collapse an expanded sheet back to its initial height.
            if (tap || dismissingRef.current) return;
            if (first) {
                stopMomentum();
                dragStartHeightRef.current = null;
            }
            if (dragStartHeightRef.current === null) {
                // Nothing has moved yet — leave any open/snap animation alone.
                if (my === 0) return;
                dragStartHeightRef.current = freezeHeight();
            }
            // Absolute tracking from the gesture's start height (useDrag gives
            // cumulative movement), so the sheet can't drift over a long drag.
            writeHeight(clamp(dragStartHeightRef.current - my * RESIZE_SENSITIVITY, minHeightRef.current, maxHeight()));
            if (last) {
                dragStartHeightRef.current = null;
                settle();
            }
        },
        { axis: "y", filterTaps: true }
    );

    // Couple content scroll to sheet resize, for both wheel (desktop) and touch.
    // Depends on bodyKey so that swapping the mounted body (e.g. info ↔ compare
    // tab) re-binds these listeners to the new root/scroll nodes instead of
    // staying attached to the unmounted previous body.
    useEffect(() => {
        const root = bodyRef.current?.root ?? null;
        const scrollEl = bodyRef.current?.scroll ?? null;
        if (!root || !scrollEl) return;

        mountedDepths.add(depth);
        const isTopmost = () => {
            let max = -Infinity;
            mountedDepths.forEach(d => { if (d > max) max = d; });
            return depth === max;
        };

        // --- Wheel (desktop) ------------------------------------------------
        // deltaY > 0 (scroll down) grows the sheet; deltaY < 0 shrinks it once
        // the content is scrolled to its top. A wheel gesture has no release,
        // so crossing below the default height dismisses immediately rather
        // than waiting for a snap decision.
        const onWheel = (e: WheelEvent) => {
            if (!isTopmost()) return;
            if (dismissingRef.current) {
                e.preventDefault();
                return;
            }
            const dy = e.deltaY;
            // Shrinking is only allowed from the top of the content; otherwise
            // let the content scroll normally.
            if (dy < 0 && scrollEl.scrollTop > 0) return;
            if (!applyResize(dy, minHeightRef.current)) return;
            e.preventDefault();
            if (!persistent && heightRef.current < defaultHeightRef.current) dismiss();
        };

        // --- Touch ----------------------------------------------------------
        // Recent (y, t) samples, trimmed to VELOCITY_WINDOW_MS, used to measure
        // release velocity. Sampling a short window (instead of smoothing the
        // whole gesture) is what makes a quick flick at the end of a slow drag
        // actually fling — the old exponential average dragged the flick's
        // speed down toward the slow motion that preceded it.
        let samples: { y: number; t: number }[] = [];
        let lastTouchY: number | null = null;
        // The mode this gesture is locked into on its first committed move.
        // Once set, the gesture cannot cross over between resizing the panel
        // and scrolling the content — a resize that reaches a boundary is a
        // hard stop; the user must lift and start a fresh gesture to scroll.
        // The release momentum inherits this lock.
        let gestureMode: "resize" | "scroll" | null = null;

        // Signed release speed in px/ms (positive = swipe up = grow), measured
        // across the retained sample window. Returns 0 if the finger was
        // effectively parked when it lifted.
        const releaseVelocity = (endTime: number): number => {
            if (samples.length < 2) return 0;
            const last = samples[samples.length - 1];
            if (endTime - last.t > VELOCITY_WINDOW_MS) return 0;
            const first = samples[0];
            const dt = last.t - first.t;
            if (dt <= 0) return 0;
            return (first.y - last.y) / dt;
        };

        const onTouchStart = (e: TouchEvent) => {
            if (e.touches.length !== 1) return;
            stopMomentum();
            lastTouchY = e.touches[0].clientY;
            samples = [{ y: lastTouchY, t: e.timeStamp }];
            gestureMode = null;
        };

        const onTouchMove = (e: TouchEvent) => {
            if (lastTouchY === null || e.touches.length !== 1 || dismissingRef.current) return;
            const y = e.touches[0].clientY;
            const dy = lastTouchY - y; // positive = finger moved up
            lastTouchY = y;
            samples.push({ y, t: e.timeStamp });
            // Keep the window, but always keep enough samples to measure with.
            while (samples.length > 2 && e.timeStamp - samples[1].t > VELOCITY_WINDOW_MS) samples.shift();

            // Lock the gesture to a single mode on its first committed move:
            // an upward pull grows the sheet while there's room to grow, and
            // only scrolls once the sheet is maxed; a downward pull scrolls
            // while the content is off its top, and only shrinks at the top.
            if (gestureMode === null && dy !== 0) {
                // Take over from the height that is actually on screen — the
                // sheet may still be mid open/snap animation.
                const h = freezeHeight();
                if (dy > 0) gestureMode = h < maxHeight() - AT_MAX_EPSILON_PX ? "resize" : "scroll";
                else gestureMode = scrollEl.scrollTop > 0 ? "scroll" : "resize";
            }
            if (gestureMode === "scroll") {
                scrollEl.scrollTop += dy;
            } else {
                // A live finger may drag all the way down to the floor — 0 for a
                // modal panel (that is the dismiss gesture), the resting height
                // for a persistent one. Hitting a boundary swallows the delta
                // rather than spilling over into a content scroll.
                applyResize(dy, minHeightRef.current);
            }
            e.preventDefault();
        };

        const onTouchEnd = (e: TouchEvent) => {
            // Ignore the lift of a second finger; only the last one releases.
            if (e.touches.length > 0) return;
            const mode = gestureMode;
            const velocity = releaseVelocity(e.timeStamp);
            lastTouchY = null;
            samples = [];
            gestureMode = null;
            if (mode === null || dismissingRef.current) return;

            if (!persistent && mode === "resize" && heightRef.current < defaultHeightRef.current) {
                // Dragged below the default height and released → dismiss.
                // This is the ONLY way a swipe closes the panel; momentum never
                // carries it below the default height (see startMomentum).
                dismiss();
                return;
            }
            if (Math.abs(velocity) < FLING_MIN_VELOCITY) {
                if (mode === "resize") settle();
                return;
            }
            startMomentum(velocity, mode);
        };

        // Release momentum, locked to the gesture's mode so a fling can never
        // cross over between resizing and scrolling:
        //  - "resize": the panel keeps growing/shrinking, floored at the DEFAULT
        //    height. A downward fling therefore coasts to the default height and
        //    stops there; it cannot dismiss. Growing stops dead at the max.
        //  - "scroll": the content keeps scrolling and stops at its own bounds;
        //    inertia never spills into a panel resize.
        const startMomentum = (initialVelocity: number, mode: "resize" | "scroll") => {
            let v = initialVelocity;
            let lastFrame = performance.now();
            const step = (now: number) => {
                momentumRafRef.current = null;
                // Cap the integration step so one janky frame can't teleport the
                // sheet or wipe out the whole fling.
                const dt = Math.min(now - lastFrame, MOMENTUM_MAX_FRAME_MS);
                lastFrame = now;
                const dy = v * dt;
                if (mode === "resize") {
                    // Momentum floors at the default height — the fling stops
                    // there instead of running on into a dismiss.
                    if (!applyResize(dy, defaultHeightRef.current)) {
                        settle();
                        return;
                    }
                } else {
                    const before = scrollEl.scrollTop;
                    scrollEl.scrollTop = before + dy;
                    // Hit the top or bottom of the content — nothing moved.
                    if (scrollEl.scrollTop === before) return;
                }
                v *= Math.pow(MOMENTUM_DECAY_PER_FRAME, dt / 16);
                if (Math.abs(v) < MOMENTUM_MIN_VELOCITY) {
                    if (mode === "resize") settle();
                    return;
                }
                momentumRafRef.current = requestAnimationFrame(step);
            };
            momentumRafRef.current = requestAnimationFrame(step);
        };

        window.addEventListener("wheel", onWheel, { passive: false });
        root.addEventListener("touchstart", onTouchStart, { passive: false });
        root.addEventListener("touchmove", onTouchMove, { passive: false });
        root.addEventListener("touchend", onTouchEnd);
        root.addEventListener("touchcancel", onTouchEnd);
        return () => {
            stopMomentum();
            mountedDepths.delete(depth);
            window.removeEventListener("wheel", onWheel);
            root.removeEventListener("touchstart", onTouchStart);
            root.removeEventListener("touchmove", onTouchMove);
            root.removeEventListener("touchend", onTouchEnd);
            root.removeEventListener("touchcancel", onTouchEnd);
        };
        // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [bodyKey]);

    const stackZ = depth * 2;
    const scrimStyle: React.CSSProperties = depth > 0 ? { zIndex: 10 + stackZ } : {};
    // NOTE: no `height` key here on purpose — height is owned imperatively by
    // writeHeight (see the height-model comment above).
    const sheetStyle: React.CSSProperties = depth > 0 ? { zIndex: 11 + stackZ } : {};

    return (
        <>
            {showScrim && (
                <EicScrim
                    className="mobile-demo-eic-scrim"
                    onClick={onClose}
                    style={scrimStyle}
                />
            )}
            <InfoSheetContainer
                ref={sheetContainerRef}
                className="mobile-demo-eic-sheet"
                style={sheetStyle}
            >
                {/* Draggable zone: grabber pill only. Header/tabs are outside
                    this zone so taps on header icons aren't captured by useDrag. */}
                <Box
                    className="mobile-demo-eic-drag-zone"
                    {...bindHeaderDrag()}
                    sx={{ touchAction: "none", userSelect: "none", display: "flex", justifyContent: "center", padding: "4px 0 8px" }}
                >
                    <InfoSheetGrabber className="mobile-demo-drag-handle" />
                </Box>
                {/* Entry-tabs strip (optional) sits between the grabber and the
                    entry header so it reads as part of the panel chrome. Wrapped
                    in a drag zone so vertical drags started on the entry tabs
                    resize the sheet; filterTaps keeps tab taps working. */}
                {tabStrip && (
                    <Box
                        className="mobile-demo-eic-tabstrip-drag-zone"
                        {...bindHeaderDrag()}
                        sx={{ touchAction: "none" }}
                    >
                        {tabStrip}
                    </Box>
                )}
                {typeof children === "function" ? children({ bindHeaderDrag }) : children}
            </InfoSheetContainer>
        </>
    );
});

SheetPanel.displayName = "SheetPanel";

export default SheetPanel;
