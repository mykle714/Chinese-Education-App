import { useCallback, useEffect, useRef, useState } from "react";
import { useDrag } from "@use-gesture/react";
import { EIC_FULL_RATIO } from "./constants";

interface UseEicSheetParams {
    // Called when the sheet finishes its dismiss animation; parent unmounts the sheet.
    onDismiss: () => void;
    // Natural content height of the currently-visible tab (header + body),
    // in CSS px. Null until the parent has measured it; once provided, the
    // sheet animates from hidden to this height on first paint.
    initialContentHeightPx: number | null;
}

// Flick threshold (px/ms). Above this magnitude, a release decides outcome by
// flick direction instead of by current position.
const FLICK_VELOCITY = 0.5;
// Fraction of the (intrinsicPos → fullHeight) gap past which a slow release
// dismisses instead of snapping back to default. Higher = less eager to dismiss.
const DISMISS_BIAS = 0.6;

// Draggable bottom-sheet with two snap stops: max (sheet touches the page
// header) and the intrinsic-content "default" position.
//   - Sheet has fixed height = fullHeight (EIC_FULL_RATIO * container height).
//   - Position controlled by translateY (0 = max, fullHeight = fully hidden).
//   - On first paint translateY is set to fullHeight (offscreen); once the
//     parent has measured the tab's natural content height, the sheet animates
//     up to intrinsicPos = (fullHeight - contentHeight) — the default stop.
//   - Releases above default snap to max or default (whichever is nearer);
//     releases below default snap to default unless dragged past DISMISS_BIAS
//     of the default→hidden gap, in which case the sheet dismisses.
//   - Outer sheet has touch-action: none on the header zone so useDrag owns
//     those gestures. The inner scroll body uses touch-action: pan-y so the
//     browser drives native scrolling; an imperative touch listener restores
//     "drag the sheet from the body when at top / when below max" behavior.
//   - Gestures with |vy| >= FLICK_VELOCITY snap by flick direction.
export function useEicSheet({ onDismiss, initialContentHeightPx }: UseEicSheetParams) {
    const sheetElRef = useRef<HTMLDivElement | null>(null);
    const containerObsRef = useRef<ResizeObserver | null>(null);
    const [containerHeight, setContainerHeight] = useState(0);
    const scrollElRef = useRef<HTMLDivElement | null>(null);

    const fullHeight = containerHeight * EIC_FULL_RATIO;

    // translateY: 0 = max (touches header above), fullHeight = fully hidden.
    // Initialized to 0 but immediately overwritten to fullHeight when the
    // sheet element mounts (see sheetRef) so the entry animation can play.
    const [translateY, setTranslateY] = useState(0);
    const [isAnimating, setIsAnimating] = useState(false);
    // Flips true after the first content-driven open animation has been kicked
    // off. Prevents re-running the entry animation if containerHeight changes
    // later (e.g., due to viewport resize).
    const hasOpenedRef = useRef(false);

    // Refs for use inside imperative event listeners (which capture state at
    // listener-bind time and would otherwise see stale values).
    const translateYRef = useRef(0);
    useEffect(() => { translateYRef.current = translateY; }, [translateY]);
    const fullHeightRef = useRef(fullHeight);
    useEffect(() => { fullHeightRef.current = fullHeight; }, [fullHeight]);

    // The "default" snap position — translateY corresponding to the sheet
    // sized to the tab's natural content. Computed from initialContentHeightPx
    // and held in a ref so imperative listeners always see the current value.
    const intrinsicPos = initialContentHeightPx != null && fullHeight > 0
        ? Math.max(0, fullHeight - Math.min(initialContentHeightPx, fullHeight))
        : null;
    const intrinsicPosRef = useRef<number | null>(intrinsicPos);
    useEffect(() => { intrinsicPosRef.current = intrinsicPos; }, [intrinsicPos]);

    // Lock content scroll while below max. Pin scrollTop=0 so the user
    // always sees the top of the content when reaching max.
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
        const h = parent.clientHeight;
        setContainerHeight(h);
        // First mount: start hidden so the entry animation can play.
        if (!hasOpenedRef.current) setTranslateY(h * EIC_FULL_RATIO);
        const ro = new ResizeObserver(() => setContainerHeight(parent.clientHeight));
        ro.observe(parent);
        containerObsRef.current = ro;
    }, []);

    // Once containerHeight and the measured content height are both known,
    // animate from hidden up to the intrinsic-content position.
    useEffect(() => {
        if (hasOpenedRef.current) return;
        if (intrinsicPos == null) return;
        hasOpenedRef.current = true;
        // rAF so the initial "hidden" translateY paints first; the transition
        // then animates from hidden to target.
        requestAnimationFrame(() => {
            setIsAnimating(true);
            setTranslateY(intrinsicPos);
        });
    }, [intrinsicPos]);

    // Release-time snap with two snap stops: max (0) and the intrinsic
    // default position. Below default → snap up to default or dismiss; above
    // default → snap up to max or back to default. `signedVy` is px/ms —
    // positive = downward flick.
    const applySnap = useCallback((signedVy: number) => {
        const ty = translateYRef.current;
        const fh = fullHeightRef.current;
        const ip = intrinsicPosRef.current;
        if (fh <= 0) return;
        // If we haven't measured content yet (no intrinsic stop), fall back
        // to a two-state max-or-dismiss decision.
        if (ip == null) {
            const target = signedVy >= FLICK_VELOCITY || ty > fh * 0.5 ? fh : 0;
            if (target !== ty) { setTranslateY(target); setIsAnimating(true); }
            else { setIsAnimating(false); }
            return;
        }
        const dismissAt = ip + (fh - ip) * DISMISS_BIAS;
        let target: number;
        if (Math.abs(signedVy) >= FLICK_VELOCITY) {
            // Flick: throw to the next stop in flick direction.
            if (signedVy > 0) {
                // downward flick → either default (if above) or dismiss (if below).
                target = ty < ip - 0.5 ? ip : fh;
            } else {
                // upward flick → either default (if below) or max (if above).
                target = ty > ip + 0.5 ? ip : 0;
            }
        } else if (ty <= ip) {
            // Above default: snap to nearest of {max, default}.
            target = ty < ip / 2 ? 0 : ip;
        } else {
            // Below default: snap to default unless past the dismiss bias.
            target = ty > dismissAt ? fh : ip;
        }
        if (target !== ty) {
            setTranslateY(target);
            setIsAnimating(true);
        } else {
            setIsAnimating(false);
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
        // the gesture (overscroll-past-top hand-off, or below-max drag).
        el.addEventListener("touchmove", touchMoveAdapter, { passive: false });
        el.addEventListener("touchend", touchEndAdapter, { passive: true });
        el.addEventListener("touchcancel", touchEndAdapter, { passive: true });
    }, [wheelAdapter, touchStartAdapter, touchMoveAdapter, touchEndAdapter]);

    // ---- Touch shim --------------------------------------------------------
    // Recreates "drag the sheet from the body" when native pan-y would
    // otherwise eat the gesture. Two cases:
    //   (a) sheet is below max (translateY > 0): native scroll is locked, so
    //       hijack and drive the sheet directly.
    //   (b) sheet is at max with scrollTop === 0 and the user pulls down:
    //       hand off from native scroll to sheet drag so the sheet collapses.
    interface TouchState {
        startY: number;
        startTranslate: number;
        // "sheet" = we own the gesture; "native" = browser scrolls;
        // "undecided" = at max + scrollTop=0, first move decides direction.
        mode: "sheet" | "native" | "undecided";
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
                // Below max — sheet drag, regardless of touch position.
                mode = "sheet";
            } else if (startScrollTop === 0) {
                // At max, top of content — direction decides on first move.
                mode = "undecided";
            } else {
                // At max with scrolled content — let the browser handle it.
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
            // Release velocity from the last ~5 samples (px/ms, signed).
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
    // Fires for gestures starting on touch-action: none areas (the header /
    // drag handle) and for mouse drags anywhere on the sheet.
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
                // useDrag gives |velocity| and a separate direction unit vector;
                // multiply for signed velocity (px/ms, positive = downward).
                applySnap(vyMag * dirY);
            }
        },
        { axis: "y", filterTaps: true }
    );

    // ---- Wheel handler ----------------------------------------------------
    // Wheel up at content-top grows the sheet (toward max); wheel down at
    // content-top shrinks it. Below max, wheel always drives the sheet.
    useEffect(() => {
        wheelHandlerRef.current = (e: WheelEvent) => {
            const scrollEl = scrollElRef.current;
            if (!scrollEl) return;
            const dy = e.deltaY;
            const ty = translateYRef.current;
            const scrollTop = scrollEl.scrollTop;
            e.preventDefault();
            if (ty > 0) {
                // Below max — wheel always moves the sheet. Content scroll is locked.
                const next = Math.max(0, Math.min(fullHeight, ty - dy));
                setTranslateY(next);
                setIsAnimating(false);
                scheduleWheelSnap();
            } else {
                // At max — content scroll is unlocked.
                if (dy > 0) {
                    scrollEl.scrollTop = Math.min(
                        scrollEl.scrollHeight - scrollEl.clientHeight,
                        scrollEl.scrollTop + dy
                    );
                } else if (dy < 0) {
                    if (scrollTop > 0) {
                        scrollEl.scrollTop = Math.max(0, scrollEl.scrollTop + dy);
                    } else {
                        // At max + scrollTop=0 + wheel up → collapse sheet.
                        const next = Math.min(fullHeight, ty + -dy);
                        setTranslateY(next);
                        setIsAnimating(false);
                        scheduleWheelSnap();
                    }
                }
            }
        };
    });

    // Wheel-burst debounce — snap once the wheel goes idle for ~150ms. Use
    // vy=0 so wheel always lands by position (flick semantics don't fit
    // discrete wheel deltas well).
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

    // When the dismiss animation ends, notify the parent to unmount the sheet.
    useEffect(() => {
        if (!isAnimating) return;
        const el = sheetElRef.current;
        if (!el) return;
        const onEnd = (e: TransitionEvent) => {
            if (e.propertyName !== "transform") return;
            setIsAnimating(false);
            if (translateYRef.current >= fullHeightRef.current - 0.5) {
                onDismiss();
            }
        };
        el.addEventListener("transitionend", onEnd);
        const timeout = window.setTimeout(() => setIsAnimating(false), 600);
        return () => {
            el.removeEventListener("transitionend", onEnd);
            window.clearTimeout(timeout);
        };
    }, [isAnimating, onDismiss]);

    return {
        sheetRef,
        scrollContainerRef,
        translateY,
        sheetHeightPx: fullHeight,
        // True until the sheet element has measured its container. Used to
        // hide the sheet on first paint before the entry animation kicks in.
        hasMeasured: containerHeight > 0,
        isAnimating,
        bindSheetDrag,
    };
}
