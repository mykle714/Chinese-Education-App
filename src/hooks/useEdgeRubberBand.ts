import { useEffect, type RefObject } from "react";

/**
 * useEdgeRubberBand — a horizontal scroller that can be dragged a little PAST either end,
 * resisting more the further it goes, and springs back on release: the "you've reached
 * the end" cue.
 *
 * LAYER: shared client logic (`src/hooks/`). Used by: components/SwipeableTextLine.tsx (the
 * Dictionary search row's gloss) and components/SwipeableTwoLineText.tsx (the Dictionary
 * eip's header gloss). Docs:
 * docs/SHELF_REDESIGN.md § 7b ("the gloss swipes").
 *
 * ── Why not the platform's own bounce ─────────────────────────────────────────
 * iOS bounces an overflow scroller natively; Android's WebView mostly does not (and when it
 * does, it is a stretch, not a bounce). So the scroller sets `overscroll-behavior-x: none`
 * — which also stops the native bounce on iOS, so the two never stack — and this hook draws
 * the same bounce everywhere.
 *
 * ── How ───────────────────────────────────────────────────────────────────────
 * Native scrolling stays in charge of everything INSIDE the range. The hook only watches
 * the touch: while the scroller sits at an end and the finger keeps pushing past it, that
 * extra travel (`over`) is turned into a `translateX` on the CONTENT element (not the
 * scroller, so a mask/fade on the scroller stays put). Release eases the content back.
 *
 *   • Displacement-driven, saturating resistance — Apple's
 *     `b(x) = (1 − 1/(x·c/d + 1))·d` with `c = 0.55` and `d` the scroller's width, the
 *     same curve `useScrollStretch.ts` models. 60px of push past the end shows ≈29px on a
 *     250px line; it never reaches `d`.
 *   • Horizontal gestures only: the axis is decided once, on the first move past
 *     `AXIS_LOCK_PX`, so a vertical page scroll that starts on the line never wiggles it.
 *   • Only when there IS overflow — a line that fits does not move at all.
 *   • Listeners are passive and the transform is written straight to the element (no React
 *     state), so the bounce costs no re-render and never blocks the scroll.
 *   • `prefers-reduced-motion`: off.
 *
 * Known approximation: reversing the finger while the band is stretched shrinks `over`
 * while the browser may already be scrolling the other way, so the first few px of a
 * reversal can move slightly faster than the finger. Not visible at these distances.
 */

/** Apple's rubber-band coefficient. */
const RUBBER_COEFFICIENT = 0.55;
/** Finger travel before the gesture's axis is decided. */
const AXIS_LOCK_PX = 6;
/** The spring back after release. */
const RELEASE_TRANSITION = "transform 320ms cubic-bezier(0.25, 0.8, 0.25, 1)";
/** Sub-pixel scroll widths: treat this close to an end as "at" it. */
const EDGE_EPSILON = 1;

const rubberBand = (x: number, dimension: number): number =>
    (1 - 1 / ((x * RUBBER_COEFFICIENT) / dimension + 1)) * dimension;

export function useEdgeRubberBand(
    scrollerRef: RefObject<HTMLElement | null>,
    contentRef: RefObject<HTMLElement | null>,
    enabled: boolean,
): void {
    useEffect(() => {
        const scroller = scrollerRef.current;
        const content = contentRef.current;
        if (!enabled || !scroller || !content) return;
        if (window.matchMedia?.("(prefers-reduced-motion: reduce)").matches) return;

        let startX = 0;
        let startY = 0;
        let lastX = 0;
        let axis: "x" | "y" | null = null;
        // Signed px the finger has pushed past an end: > 0 past the START (dragging
        // right at scrollLeft 0), < 0 past the END.
        let over = 0;

        const write = (px: number) => {
            content.style.transform = px === 0 ? "" : `translateX(${px}px)`;
        };

        const onStart = (e: TouchEvent) => {
            const t = e.touches[0];
            if (!t || e.touches.length > 1) return;
            startX = lastX = t.clientX;
            startY = t.clientY;
            axis = null;
            over = 0;
            // Grabbing the line mid-spring stops the spring where it is.
            content.style.transition = "";
            write(0);
        };

        const onMove = (e: TouchEvent) => {
            const t = e.touches[0];
            if (!t) return;
            const dx = t.clientX - lastX;
            lastX = t.clientX;
            if (axis === null) {
                const ax = Math.abs(t.clientX - startX);
                const ay = Math.abs(t.clientY - startY);
                if (Math.max(ax, ay) < AXIS_LOCK_PX) return;
                axis = ax > ay ? "x" : "y";
            }
            if (axis !== "x") return;

            const maxScroll = scroller.scrollWidth - scroller.clientWidth;
            if (maxScroll <= EDGE_EPSILON) return;
            const atStart = scroller.scrollLeft <= EDGE_EPSILON;
            const atEnd = scroller.scrollLeft >= maxScroll - EDGE_EPSILON;

            if (over > 0 || (atStart && dx > 0)) over = Math.max(0, over + dx);
            else if (over < 0 || (atEnd && dx < 0)) over = Math.min(0, over + dx);
            else return;

            const dimension = scroller.clientWidth || 1;
            write(Math.sign(over) * rubberBand(Math.abs(over), dimension));
        };

        const onEnd = () => {
            if (over === 0) return;
            over = 0;
            content.style.transition = RELEASE_TRANSITION;
            write(0);
        };

        const onTransitionEnd = () => {
            content.style.transition = "";
        };

        scroller.addEventListener("touchstart", onStart, { passive: true });
        scroller.addEventListener("touchmove", onMove, { passive: true });
        scroller.addEventListener("touchend", onEnd, { passive: true });
        scroller.addEventListener("touchcancel", onEnd, { passive: true });
        content.addEventListener("transitionend", onTransitionEnd);
        return () => {
            scroller.removeEventListener("touchstart", onStart);
            scroller.removeEventListener("touchmove", onMove);
            scroller.removeEventListener("touchend", onEnd);
            scroller.removeEventListener("touchcancel", onEnd);
            content.removeEventListener("transitionend", onTransitionEnd);
            content.style.transition = "";
            content.style.transform = "";
        };
    }, [scrollerRef, contentRef, enabled]);
}

export default useEdgeRubberBand;
