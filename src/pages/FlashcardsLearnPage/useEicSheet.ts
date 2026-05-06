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

// Draggable bottom-sheet:
//   - Sheet has fixed height = fullHeight (90% of ContentArea).
//   - Position controlled by translateY (0 = fully visible, fullHeight = hidden).
//   - Snap stops: 0 (FULL/90%), halfPos (HALF/70%), fullHeight (HIDDEN).
//   - Sheet has touch-action: none so useDrag reliably owns the gesture; scroll
//     inside the body is driven manually by the drag handler / wheel listener.
//   - Within a single gesture: dragging while content is scrolled scrolls the
//     content; once scrollTop hits 0 and the user keeps dragging down, the
//     gesture transitions to dragging the sheet.
//   - Wheel/trackpad: at scrollTop=0, deltaY routes into translateY (grow on
//     deltaY > 0, collapse on deltaY < 0) until the sheet hits a bound.
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

    // Wheel handler attached imperatively to the inner scroll element so we can
    // call preventDefault. Re-attaches when the element ref changes.
    const wheelHandlerRef = useRef<(e: WheelEvent) => void>(() => {});
    const scrollContainerRef = useCallback((el: HTMLDivElement | null) => {
        const old = scrollElRef.current;
        if (old) old.removeEventListener("wheel", wheelAdapter);
        scrollElRef.current = el;
        if (!el) return;
        el.addEventListener("wheel", wheelAdapter, { passive: false });
    }, []);
    // Stable adapter that delegates to the latest closure.
    const wheelAdapter = useCallback((e: WheelEvent) => wheelHandlerRef.current(e), []);

    // Reset on new card.
    useEffect(() => {
        setIsOpen(false);
        setTranslateY(0);
        setIsAnimating(false);
    }, [resetKey]);

    // Drag-start state captured per-gesture.
    const dragStartRef = useRef<{
        startTranslate: number;
        startScroll: number;
        // "sheet" = drag moves the sheet; "scroll" = drag scrolls content.
        // Can transition scroll → sheet within one gesture when scrollTop hits 0.
        mode: "sheet" | "scroll";
        // Cumulative my offset captured at the moment of mode switch, so
        // post-switch movement is measured from that point.
        modeSwitchMy: number;
        // Translate captured at the moment of mode switch.
        modeSwitchTranslate: number;
    }>({
        startTranslate: 0,
        startScroll: 0,
        mode: "sheet",
        modeSwitchMy: 0,
        modeSwitchTranslate: 0,
    });

    const bindSheetDrag = useDrag(
        ({ first, last, down, movement: [, my] }) => {
            const scrollEl = scrollElRef.current;

            if (first) {
                // Content scroll is only available at FULL. Below FULL, drag always
                // moves the sheet — regardless of where on the panel the user grabbed.
                const atFull = translateY <= 0.5;
                dragStartRef.current = {
                    startTranslate: translateY,
                    startScroll: scrollEl?.scrollTop ?? 0,
                    mode: atFull ? "scroll" : "sheet",
                    modeSwitchMy: 0,
                    modeSwitchTranslate: translateY,
                };
            }

            const ds = dragStartRef.current;

            if (down) {
                if (ds.mode === "scroll") {
                    // Manually scroll content. dy positive = scroll up (reveal more);
                    // dy is `my` (negative = finger moved up = scroll content up = scrollTop +=).
                    const targetScroll = ds.startScroll - my;
                    if (scrollEl) {
                        if (targetScroll < 0) {
                            // Pulled past top — pin scrollTop to 0 and switch to sheet mode
                            // so further downward drag dismisses the sheet.
                            scrollEl.scrollTop = 0;
                            ds.mode = "sheet";
                            ds.modeSwitchMy = my; // current my (negative-most-recent)
                            ds.modeSwitchTranslate = translateYRef.current;
                            // fall through to sheet-mode handling below
                        } else {
                            scrollEl.scrollTop = targetScroll;
                            return;
                        }
                    }
                }

                // Sheet mode: move translateY 1:1 with finger.
                const myDelta = my - ds.modeSwitchMy;
                const next = Math.max(0, Math.min(fullHeight, ds.modeSwitchTranslate + myDelta));
                setTranslateY(next);
                setIsAnimating(false);
                return;
            }

            if (last) {
                if (ds.mode === "sheet") {
                    const dismissAt = halfPos + (fullHeight - halfPos) * EIC_DISMISS_THRESHOLD_RATIO;
                    const ty = translateYRef.current;
                    let target: number;
                    if (ty < halfPos / 2) target = 0;
                    else if (ty < dismissAt) target = halfPos;
                    else target = fullHeight;
                    if (target !== ty) {
                        setTranslateY(target);
                        setIsAnimating(true);
                    } else if (target >= fullHeight - 0.5) {
                        // Already at HIDDEN — no transition will run, close directly.
                        setIsOpen(false);
                        if (scrollElRef.current) scrollElRef.current.scrollTop = 0;
                    }
                }
                // scroll mode: nothing to snap; native rest position is already correct.
            }
        },
        { axis: "y", filterTaps: true }
    );

    // Wheel handler — runs when the user wheel-scrolls inside the sheet body.
    // Keeps refs in sync with the latest closure each render.
    useEffect(() => {
        wheelHandlerRef.current = (e: WheelEvent) => {
            const scrollEl = scrollElRef.current;
            if (!scrollEl) return;
            const dy = e.deltaY;
            const ty = translateYRef.current;
            const scrollTop = scrollEl.scrollTop;

            // dy > 0 (scroll down — reveal more content):
            //   - If sheet is below FULL (translateY > 0), grow sheet first.
            //   - If at FULL, native scroll takes over.
            // dy < 0 (scroll up):
            //   - If at top of content (scrollTop === 0), collapse sheet.
            //   - Otherwise native scroll up.
            // Always preventDefault — we drive both sheet resize and content scroll
            // manually so no wheel events can leak out of the sheet to scroll the body.
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
    const wheelSnapTimerRef = useRef<number | null>(null);
    const scheduleWheelSnap = () => {
        if (wheelSnapTimerRef.current != null) {
            window.clearTimeout(wheelSnapTimerRef.current);
        }
        wheelSnapTimerRef.current = window.setTimeout(() => {
            wheelSnapTimerRef.current = null;
            const ty = translateYRef.current;
            const dismissAt = halfPos + (fullHeight - halfPos) * EIC_DISMISS_THRESHOLD_RATIO;
            let target: number;
            if (ty < halfPos / 2) target = 0;
            else if (ty < dismissAt) target = halfPos;
            else target = fullHeight;
            if (target !== ty) {
                setTranslateY(target);
                setIsAnimating(true);
            } else if (target >= fullHeight - 0.5) {
                // Already at HIDDEN — no transition will run, so close directly.
                setIsOpen(false);
                if (scrollElRef.current) scrollElRef.current.scrollTop = 0;
            }
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
