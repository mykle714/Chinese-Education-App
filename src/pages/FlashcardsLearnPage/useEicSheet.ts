import { useCallback, useEffect, useRef, useState } from "react";
import { useDrag } from "@use-gesture/react";
import {
    EIC_HALF_RATIO,
    EIC_FULL_RATIO,
    EIC_DISMISS_THRESHOLD_RATIO,
} from "./constants";

export type SheetState = "HIDDEN" | "OPEN";

interface UseEicSheetParams {
    // Changes when a new card loads — sheet snaps back to HIDDEN.
    resetKey: number;
}

// Flick threshold in px/ms above which release behavior switches from
// nearest-stop snap to "throw to next stop in flick direction".
const FLICK_VELOCITY = 0.5;

// Draggable bottom-sheet:
//   - Sheet has fixed height = fullHeight (90% of ContentArea).
//   - Position controlled by translateY (0 = fully visible, fullHeight = hidden).
//   - Snap stops: 0 (FULL/90%), halfPos (HALF/70%), fullHeight (HIDDEN).
//   - Outer sheet has touch-action: none so useDrag owns header / drag-handle
//     gestures. The inner scroll body uses touch-action: pan-y so the browser
//     drives native vertical scroll (and contributes OS-level momentum).
//   - A non-passive touch listener on the inner scroll body recreates the
//     "pull past top → drag the sheet down" hand-off and also drives sheet
//     dragging when the user touches content while below FULL (since native
//     pan-y would otherwise eat those gestures).
//   - On release, gestures with |vy| >= FLICK_VELOCITY snap to the next stop
//     in the flick direction; gentler releases snap to the nearest stop.
export function useEicSheet({ resetKey }: UseEicSheetParams) {
    const sheetElRef = useRef<HTMLDivElement | null>(null);
    const containerObsRef = useRef<ResizeObserver | null>(null);
    const [containerHeight, setContainerHeight] = useState(0);
    const scrollElRef = useRef<HTMLDivElement | null>(null);

    const halfHeight = containerHeight * EIC_HALF_RATIO;
    const fullHeight = containerHeight * EIC_FULL_RATIO;
    const halfPos = fullHeight - halfHeight; // translateY value for HALF state

    const [translateY, setTranslateY] = useState(0);
    const [isAnimating, setIsAnimating] = useState(false);
    const [isOpen, setIsOpen] = useState(false);

    // translateY ref kept in sync with state for use inside event listeners.
    const translateYRef = useRef(0);
    useEffect(() => { translateYRef.current = translateY; }, [translateY]);

    // Geometry refs so listeners attached once via the ref callback always read
    // the current snap-stop positions even after a viewport resize.
    const fullHeightRef = useRef(fullHeight);
    const halfPosRef = useRef(halfPos);
    useEffect(() => { fullHeightRef.current = fullHeight; halfPosRef.current = halfPos; }, [fullHeight, halfPos]);

    // Lock content scroll until the sheet reaches FULL. Whenever translateY > 0
    // (below FULL), pin scrollTop to 0 so the next time the user reaches FULL
    // they start from the top of the content.
    useEffect(() => {
        if (translateY > 0.5 && scrollElRef.current && scrollElRef.current.scrollTop !== 0) {
            scrollElRef.current.scrollTop = 0;
        }
    }, [translateY]);

    const sheetRef = useCallback((el: HTMLDivElement | null) => {
        if (containerObsRef.current) {
            containerObsRef.current.disconnect();
            containerObsRef.current = null;
        }
        sheetElRef.current = el;
        if (!el || !el.parentElement) return;
        const parent = el.parentElement;
        setContainerHeight(parent.clientHeight);
        const ro = new ResizeObserver(() => setContainerHeight(parent.clientHeight));
        ro.observe(parent);
        containerObsRef.current = ro;
    }, []);

    // Direction-aware snap. Called on every gesture release (drag, touch shim,
    // wheel idle). `signedVy` is in px/ms — positive = downward flick.
    const applySnap = useCallback((signedVy: number) => {
        const ty = translateYRef.current;
        const fh = fullHeightRef.current;
        const hp = halfPosRef.current;
        const dismissAt = hp + (fh - hp) * EIC_DISMISS_THRESHOLD_RATIO;
        let target: number;
        if (Math.abs(signedVy) >= FLICK_VELOCITY) {
            // Flick: throw to the next stop in flick direction.
            if (signedVy > 0) {
                // downward flick
                target = ty < hp - 0.5 ? hp : fh;
            } else {
                // upward flick
                target = ty > hp + 0.5 ? hp : 0;
            }
        } else {
            // Gentle release: nearest stop (with dismiss bias).
            if (ty < hp / 2) target = 0;
            else if (ty < dismissAt) target = hp;
            else target = fh;
        }
        if (target !== ty) {
            setTranslateY(target);
            setIsAnimating(true);
        } else if (target >= fh - 0.5) {
            // Already at HIDDEN — no transition will run, close directly.
            setIsOpen(false);
            if (scrollElRef.current) scrollElRef.current.scrollTop = 0;
        }
    }, []);

    // ---- Imperative listeners on the inner scroll element. -----------------
    // Wheel and touch handlers need preventDefault, so they're attached
    // imperatively and re-attached when the scroll element ref changes.

    const wheelHandlerRef = useRef<(e: WheelEvent) => void>(() => {});
    const touchStartHandlerRef = useRef<(e: TouchEvent) => void>(() => {});
    const touchMoveHandlerRef = useRef<(e: TouchEvent) => void>(() => {});
    const touchEndHandlerRef = useRef<(e: TouchEvent) => void>(() => {});

    const wheelAdapter = useCallback((e: WheelEvent) => wheelHandlerRef.current(e), []);
    const touchStartAdapter = useCallback((e: TouchEvent) => touchStartHandlerRef.current(e), []);
    const touchMoveAdapter = useCallback((e: TouchEvent) => touchMoveHandlerRef.current(e), []);
    const touchEndAdapter = useCallback((e: TouchEvent) => touchEndHandlerRef.current(e), []);

    const scrollContainerRef = useCallback((el: HTMLDivElement | null) => {
        const old = scrollElRef.current;
        if (old) {
            old.removeEventListener("wheel", wheelAdapter);
            old.removeEventListener("touchstart", touchStartAdapter);
            old.removeEventListener("touchmove", touchMoveAdapter);
            old.removeEventListener("touchend", touchEndAdapter);
            old.removeEventListener("touchcancel", touchEndAdapter);
        }
        scrollElRef.current = el;
        if (!el) return;
        el.addEventListener("wheel", wheelAdapter, { passive: false });
        el.addEventListener("touchstart", touchStartAdapter, { passive: true });
        // touchmove must be non-passive so we can preventDefault when hijacking
        // the gesture (overscroll-past-top hand-off, or below-FULL drag).
        el.addEventListener("touchmove", touchMoveAdapter, { passive: false });
        el.addEventListener("touchend", touchEndAdapter, { passive: true });
        el.addEventListener("touchcancel", touchEndAdapter, { passive: true });
    }, [wheelAdapter, touchStartAdapter, touchMoveAdapter, touchEndAdapter]);

    // Reset on new card.
    useEffect(() => {
        setIsOpen(false);
        setTranslateY(0);
        setIsAnimating(false);
    }, [resetKey]);

    // ---- Touch shim --------------------------------------------------------
    // Recreates the "drag the sheet by touching the body" UX that's lost when
    // the inner element uses native pan-y scrolling. Two cases:
    //   (a) sheet is below FULL (translateY > 0): native scroll would do
    //       nothing useful (content is locked). Hijack the gesture and drive
    //       the sheet directly.
    //   (b) sheet is at FULL with scrollTop === 0 and the user pulls down:
    //       hand off from native scroll to sheet drag so the sheet collapses.
    // Velocity is computed from the last few touchmove samples and fed into
    // applySnap on release.
    interface TouchState {
        startY: number;
        startTranslate: number;
        // "sheet" = we own the gesture, driving translateY and preventDefault'ing.
        // "native" = browser is scrolling natively; we keep our hands off.
        // "undecided" = at FULL with scrollTop=0 — first move decides direction.
        mode: "sheet" | "native" | "undecided";
        // Recent (y, t) samples for release-velocity estimation.
        samples: { y: number; t: number }[];
    }
    const touchStateRef = useRef<TouchState | null>(null);

    useEffect(() => {
        touchStartHandlerRef.current = (e: TouchEvent) => {
            const scrollEl = scrollElRef.current;
            if (!scrollEl) return;
            const t = e.touches[0];
            if (!t) return;
            const ty = translateYRef.current;
            const startScrollTop = scrollEl.scrollTop;
            let mode: TouchState["mode"];
            if (ty > 0.5) {
                // Below FULL — sheet drag, regardless of touch position.
                mode = "sheet";
            } else if (startScrollTop === 0) {
                // At FULL, top of content — direction decides on first move.
                mode = "undecided";
            } else {
                // At FULL with scrolled content — let the browser handle it.
                mode = "native";
            }
            touchStateRef.current = {
                startY: t.clientY,
                startTranslate: ty,
                mode,
                samples: [{ y: t.clientY, t: performance.now() }],
            };
        };

        touchMoveHandlerRef.current = (e: TouchEvent) => {
            const ts = touchStateRef.current;
            const scrollEl = scrollElRef.current;
            if (!ts || !scrollEl) return;
            const t = e.touches[0];
            if (!t) return;
            const dy = t.clientY - ts.startY;
            ts.samples.push({ y: t.clientY, t: performance.now() });
            if (ts.samples.length > 5) ts.samples.shift();

            if (ts.mode === "undecided") {
                // Need a few px of movement to decide. Pull-down past top → sheet.
                // Any other direction → native scroll owns the rest of the gesture.
                if (Math.abs(dy) < 4) return;
                if (dy > 0 && scrollEl.scrollTop === 0) {
                    ts.mode = "sheet";
                    // Reset baseline so post-decision motion starts from zero.
                    ts.startY = t.clientY;
                    ts.startTranslate = translateYRef.current;
                    ts.samples = [{ y: t.clientY, t: performance.now() }];
                } else {
                    ts.mode = "native";
                }
            }

            if (ts.mode === "sheet") {
                e.preventDefault();
                const fh = fullHeightRef.current;
                const next = Math.max(0, Math.min(fh, ts.startTranslate + (t.clientY - ts.startY)));
                setTranslateY(next);
                setIsAnimating(false);
            }
        };

        touchEndHandlerRef.current = () => {
            const ts = touchStateRef.current;
            touchStateRef.current = null;
            if (!ts || ts.mode !== "sheet") return;
            // Estimate release velocity from the last ~5 samples (px/ms, signed).
            let signedVy = 0;
            const s = ts.samples;
            if (s.length >= 2) {
                const last = s[s.length - 1];
                const first = s[0];
                const dt = last.t - first.t;
                if (dt > 0) signedVy = (last.y - first.y) / dt;
            }
            applySnap(signedVy);
        };
    });

    // ---- useDrag on the outer sheet ---------------------------------------
    // Only fires for gestures starting on touch-action: none areas (the tab
    // header / drag handle), or for mouse drags. Pure sheet drag — no scroll
    // mode, since native scroll on the body is owned by the browser/touch shim.
    const dragStartRef = useRef<{ startTranslate: number }>({ startTranslate: 0 });

    const bindSheetDrag = useDrag(
        ({ first, last, down, movement: [, my], velocity: [, vyMag], direction: [, dirY] }) => {
            if (first) {
                dragStartRef.current = { startTranslate: translateYRef.current };
                setIsAnimating(false);
            }
            if (down) {
                const next = Math.max(0, Math.min(fullHeight, dragStartRef.current.startTranslate + my));
                setTranslateY(next);
                setIsAnimating(false);
                return;
            }
            if (last) {
                // useDrag exposes |velocity| and a separate direction unit vector;
                // multiply for signed velocity (px/ms, positive = downward).
                applySnap(vyMag * dirY);
            }
        },
        { axis: "y", filterTaps: true }
    );

    // ---- Wheel handler ----------------------------------------------------
    // Desktop wheel/trackpad still routes both sheet resize and content scroll
    // manually (keeps the "wheel up at top of content collapses sheet" UX).
    useEffect(() => {
        wheelHandlerRef.current = (e: WheelEvent) => {
            const scrollEl = scrollElRef.current;
            if (!scrollEl) return;
            const dy = e.deltaY;
            const ty = translateYRef.current;
            const scrollTop = scrollEl.scrollTop;
            e.preventDefault();
            if (ty > 0) {
                // Below FULL — wheel always moves the sheet. Content scroll is locked.
                const next = Math.max(0, Math.min(fullHeight, ty - dy));
                setTranslateY(next);
                setIsAnimating(false);
                scheduleWheelSnap();
            } else {
                // At FULL — content scroll is unlocked.
                if (dy > 0) {
                    scrollEl.scrollTop = Math.min(
                        scrollEl.scrollHeight - scrollEl.clientHeight,
                        scrollEl.scrollTop + dy
                    );
                } else if (dy < 0) {
                    if (scrollTop > 0) {
                        scrollEl.scrollTop = Math.max(0, scrollEl.scrollTop + dy);
                    } else {
                        // At FULL + scrollTop=0 + wheel up → collapse sheet.
                        const next = Math.min(fullHeight, ty + -dy);
                        setTranslateY(next);
                        setIsAnimating(false);
                        scheduleWheelSnap();
                    }
                }
            }
        };
    });

    // Wheel-burst end debounce — snap once the wheel goes idle for ~150ms.
    // Uses applySnap with vy=0 so wheel always lands on nearest stop (flick
    // semantics don't translate well to discrete wheel deltas).
    const wheelSnapTimerRef = useRef<number | null>(null);
    const scheduleWheelSnap = () => {
        if (wheelSnapTimerRef.current != null) {
            window.clearTimeout(wheelSnapTimerRef.current);
        }
        wheelSnapTimerRef.current = window.setTimeout(() => {
            wheelSnapTimerRef.current = null;
            applySnap(0);
        }, 150);
    };

    // After a snap animation ends, sync isOpen if we landed on HIDDEN.
    useEffect(() => {
        if (!isAnimating) return;
        const el = sheetElRef.current;
        if (!el) return;
        const onEnd = (e: TransitionEvent) => {
            if (e.propertyName !== "transform") return;
            setIsAnimating(false);
            if (translateYRef.current >= fullHeight - 0.5) {
                setIsOpen(false);
                if (scrollElRef.current) scrollElRef.current.scrollTop = 0;
            }
        };
        el.addEventListener("transitionend", onEnd);
        const timeout = window.setTimeout(() => setIsAnimating(false), 600);
        return () => {
            el.removeEventListener("transitionend", onEnd);
            window.clearTimeout(timeout);
        };
    }, [isAnimating, fullHeight]);

    const open = useCallback(() => {
        setIsOpen(true);
        setTranslateY(fullHeight);
        requestAnimationFrame(() => {
            setIsAnimating(true);
            setTranslateY(halfPos);
        });
    }, [fullHeight, halfPos]);

    const close = useCallback(() => {
        setIsAnimating(true);
        setTranslateY(fullHeight);
    }, [fullHeight]);

    // Derive button-facing state directly from the panel's current position
    // rather than the isOpen mount flag. This ensures the FAB icon flips back to
    // "expand" the moment the user drags the panel to (or past) the hidden
    // position, without waiting on the snap animation's transitionend to fire.
    const sheetState: SheetState =
        isOpen && translateY < fullHeight - 0.5 ? "OPEN" : "HIDDEN";

    return {
        sheetState,
        sheetRef,
        scrollContainerRef,
        translateY,
        sheetHeightPx: fullHeight,
        isAnimating,
        bindSheetDrag,
        open,
        close,
    };
}
