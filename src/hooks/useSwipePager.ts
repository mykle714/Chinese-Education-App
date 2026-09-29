import { useRef, useState } from "react";
import type { PointerEvent as ReactPointerEvent } from "react";

/**
 * A follow-the-finger horizontal pager over a strip of equal-width pages, driven by
 * POINTER events rather than a native scroll-snap container.
 *
 * Why not scroll-snap (which `ChallengeDetailPage`'s pager uses): the popups this serves
 * portal out to the frame-level overlay host (`components/overlayHost.ts`), and the app
 * shell's global `touch-action: none` is a ceiling on every descendant (CLAUDE.md "Touch &
 * Scroll") — a native pan would need that ceiling lifted at the host. Pointer events
 * sidestep it entirely, and they also make MOUSE drag work, which a native overflow
 * container never does.
 *
 * The caller owns the page index; this hook only reports the live drag offset while a
 * finger is down, and calls `onChange` with the committed page on release. The caller
 * renders the strip as `translateX(calc(-index * 100% + dragDx px))`, with the transition
 * switched off while `dragging` so the strip tracks the finger exactly.
 *
 * Used by: `src/components/SteppedHelpPopup.tsx` (the shp step pager).
 * Documented in: docs/STUDY_CHALLENGE.md § 5.4c.
 */

/** Movement (px) before a press becomes a drag — below this it is still a tap. */
const DRAG_SLOP_PX = 8;
/** A release past this fraction of the page width commits to the neighbouring page. */
const COMMIT_FRACTION = 0.2;
/** …or a flick faster than this (px/ms), even if short. */
const FLICK_VELOCITY = 0.4;
/** Past the first/last page the strip still moves, but resists — the "rubber band". */
const EDGE_RESISTANCE = 0.3;

interface Gesture {
    pointerId: number;
    startX: number;
    startY: number;
    /** Last sample, for the release velocity — the whole-gesture average hides a flick. */
    lastX: number;
    lastT: number;
    velocity: number;
    /** null until the slop is crossed; then true (horizontal drag) or false (abandoned). */
    horizontal: boolean | null;
}

export interface SwipePager {
    /** Current drag offset in px (0 when no drag is in flight). */
    dragDx: number;
    /** True while a finger is actively dragging the strip — disable the transition. */
    dragging: boolean;
    /** Spread onto the element that receives the gesture (usually the strip's viewport). */
    handlers: {
        onPointerDown: (e: ReactPointerEvent<HTMLElement>) => void;
        onPointerMove: (e: ReactPointerEvent<HTMLElement>) => void;
        onPointerUp: (e: ReactPointerEvent<HTMLElement>) => void;
        onPointerCancel: (e: ReactPointerEvent<HTMLElement>) => void;
    };
}

export function useSwipePager(index: number, count: number, onChange: (next: number) => void): SwipePager {
    const [dragDx, setDragDx] = useState(0);
    const [dragging, setDragging] = useState(false);
    // A ref, not state: pointermove fires far faster than renders, and every handler
    // must see the gesture as it is now rather than as of the last render.
    const gesture = useRef<Gesture | null>(null);

    const reset = () => {
        gesture.current = null;
        setDragging(false);
        setDragDx(0);
    };

    const onPointerDown = (e: ReactPointerEvent<HTMLElement>) => {
        // Primary button only — a right-click should not start a page turn.
        if (e.pointerType === "mouse" && e.button !== 0) return;
        gesture.current = {
            pointerId: e.pointerId,
            startX: e.clientX,
            startY: e.clientY,
            lastX: e.clientX,
            lastT: e.timeStamp,
            velocity: 0,
            horizontal: null,
        };
    };

    const onPointerMove = (e: ReactPointerEvent<HTMLElement>) => {
        const g = gesture.current;
        if (!g || g.pointerId !== e.pointerId || g.horizontal === false) return;
        const dx = e.clientX - g.startX;
        const dy = e.clientY - g.startY;

        if (g.horizontal === null) {
            if (Math.hypot(dx, dy) < DRAG_SLOP_PX) return;
            // Decide once, at the slop: a mostly-vertical press is not a page turn and
            // stays out of the way for the rest of the gesture.
            g.horizontal = Math.abs(dx) > Math.abs(dy);
            if (!g.horizontal) return;
            // Capture only once it IS a drag, so a plain tap still reaches its target.
            e.currentTarget.setPointerCapture(e.pointerId);
            setDragging(true);
        }

        const dt = e.timeStamp - g.lastT;
        if (dt > 0) g.velocity = (e.clientX - g.lastX) / dt;
        g.lastX = e.clientX;
        g.lastT = e.timeStamp;

        // Rubber-band past either end: dragging right on page 0, or left on the last.
        const pastEdge = (dx > 0 && index <= 0) || (dx < 0 && index >= count - 1);
        setDragDx(pastEdge ? dx * EDGE_RESISTANCE : dx);
    };

    const onPointerUp = (e: ReactPointerEvent<HTMLElement>) => {
        const g = gesture.current;
        if (!g || g.pointerId !== e.pointerId) return;
        if (g.horizontal) {
            const dx = e.clientX - g.startX;
            const width = e.currentTarget.clientWidth || 1;
            const commits = Math.abs(dx) > width * COMMIT_FRACTION || Math.abs(g.velocity) > FLICK_VELOCITY;
            if (commits) {
                // Finger moved left → next page. Clamped, so the rubber band snaps back.
                const next = Math.max(0, Math.min(count - 1, index + (dx < 0 ? 1 : -1)));
                if (next !== index) onChange(next);
            }
        }
        reset();
    };

    return {
        dragDx,
        dragging,
        handlers: { onPointerDown, onPointerMove, onPointerUp, onPointerCancel: reset },
    };
}
