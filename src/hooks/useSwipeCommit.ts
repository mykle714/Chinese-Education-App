import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import type { PointerEvent as ReactPointerEvent } from "react";

/**
 * A follow-the-finger, left/right "swipe to commit" gesture for a set of cards, driven by
 * POINTER events. The card tracks the finger horizontally; on release it either commits
 * (past a distance threshold, or a quick flick in the drag's direction) or snaps back.
 *
 * One hook instance serves MANY cards: each card spreads the same stable `handlers` and
 * carries `data-swipe-id`, and the hook tracks which one is under the finger
 * (`activeId`). Stable handlers matter — a grid of ~100 memoized cards must not all
 * re-render on every pointermove because a fresh handler object was bound per card.
 *
 * ── Axis lock (`axisLock: true`) ─────────────────────────────────────────────────────
 * For cards that sit INSIDE a vertical scroller. The card must also carry
 * `touch-action: pan-y`, so the browser keeps vertical panning: a vertical drag scrolls
 * natively (and the browser sends `pointercancel`), and only horizontal movement reaches
 * these handlers. On top of that the hook decides the axis itself once the press travels
 * `AXIS_SLOP_PX` — mostly-vertical abandons the gesture (the card never moves), mostly-
 * horizontal locks it and captures the pointer. The JS decision is what makes a MOUSE drag
 * (no native pan) behave the same, and it stops a diagonal scroll from nudging the card.
 *
 * Without the lock (`axisLock: false`) any movement drags — for a card that already owns
 * every gesture (`touch-action: none`), e.g. the Reading Center's open tile.
 *
 * A `pointercancel` never commits: it means the browser (or the OS) took the gesture away.
 *
 * Used by: `src/features/flashcards/centers/ReadingSwipeGrid.tsx` (reading marks, state
 * mode) and `src/features/discover/QuickMarkPage.tsx` (Learn Now / Mastered triage,
 * imperative `paint` mode).
 * Documented in: docs/QUICK_MARK.md § 3, docs/READING_WRITING_CENTERS.md § Phase 2.
 */

export type SwipeDirection = "left" | "right";

/** Travel (px) before an axis-locked press picks its axis. */
const AXIS_SLOP_PX = 8;
/** A press that travels less than this (px) is a TAP, not a drag. */
const TAP_SLOP_PX = 6;
/** A flick commits early: at least this far… */
const FLICK_MIN_PX = 24;
/** …moving at least this fast (px/ms) when released, in the drag's direction. */
const FLICK_MIN_VELOCITY = 0.5;

interface Gesture {
    pointerId: number;
    id: string;
    /** The card element (the handlers' currentTarget) — what `paint` draws on. */
    el: HTMLElement;
    startX: number;
    startY: number;
    /** Last sample, for the release velocity — the whole-gesture average hides a flick. */
    lastX: number;
    lastT: number;
    vx: number;
    /** null until the axis-lock slop is crossed (always "x" when the lock is off). */
    axis: "x" | "y" | null;
}

export interface SwipeCommitOptions {
    /** Lock to the horizontal axis (see header). */
    axisLock: boolean;
    /** Commit distance in px, read at release (the caller's geometry may change). */
    threshold: () => number;
    /** True while presses should be ignored (e.g. a card is mid fly-off). */
    disabled?: boolean;
    /** Called once per committed swipe with the card's `data-swipe-id`. */
    onCommit: (id: string, direction: SwipeDirection) => void;
    /**
     * IMPERATIVE mode. When given, the drag never touches React state: the hook calls
     * `paint(card, dx)` at most once per animation frame while the finger moves, and
     * `paint(card, null)` on release so the caller can drop its inline styles (the
     * card's class styles — snap-back transition, or a committed fly-off — take over).
     * `activeId` / `dx` / `dragging` then stay null / 0 / false.
     *
     * Use it for a large grid: in state mode every pointermove re-renders the caller,
     * which for Quick Mark's ~100-card grid re-ran the grid's whole render per frame.
     * State mode is fine for a single dragged element (the Reading Center's open tile).
     */
    paint?: (card: HTMLElement, dx: number | null) => void;
}

export interface SwipeCommit {
    /** The card being dragged, or null. */
    activeId: string | null;
    /** Its horizontal offset in px (0 when nothing is dragged). */
    dx: number;
    /** True while a finger is actively dragging — the caller turns its transition off. */
    dragging: boolean;
    /**
     * Whether the press that just ended travelled past the tap slop. Read it in the
     * card's onClick: the click that ends a drag (pointer capture keeps it on the card)
     * must not count as a tap.
     */
    wasDrag: () => boolean;
    /** Spread onto every card, alongside `data-swipe-id={id}`. Referentially stable. */
    handlers: {
        onPointerDown: (e: ReactPointerEvent<HTMLElement>) => void;
        onPointerMove: (e: ReactPointerEvent<HTMLElement>) => void;
        onPointerUp: (e: ReactPointerEvent<HTMLElement>) => void;
        onPointerCancel: (e: ReactPointerEvent<HTMLElement>) => void;
    };
}

export function useSwipeCommit(options: SwipeCommitOptions): SwipeCommit {
    const [drag, setDrag] = useState<{ id: string; dx: number } | null>(null);
    const gestureRef = useRef<Gesture | null>(null);
    const draggedRef = useRef(false);
    // Latest options through a ref, so the handlers below never change identity.
    const optionsRef = useRef(options);
    optionsRef.current = options;
    // Imperative mode: the pending frame, so a burst of pointermoves paints once.
    const frameRef = useRef<number | null>(null);
    useEffect(() => () => { if (frameRef.current !== null) cancelAnimationFrame(frameRef.current); }, []);

    const handlers = useMemo<SwipeCommit["handlers"]>(() => {
        const end = (e: ReactPointerEvent<HTMLElement>, cancelled: boolean) => {
            const g = gestureRef.current;
            if (!g || g.pointerId !== e.pointerId) return;
            gestureRef.current = null;
            const paint = optionsRef.current.paint;
            if (paint) {
                if (frameRef.current !== null) { cancelAnimationFrame(frameRef.current); frameRef.current = null; }
                paint(g.el, null);
            } else {
                setDrag(null);
            }
            if (cancelled || g.axis !== "x") return;
            const dx = e.clientX - g.startX;
            const flicked = Math.abs(dx) >= FLICK_MIN_PX && Math.abs(g.vx) >= FLICK_MIN_VELOCITY && Math.sign(g.vx) === Math.sign(dx);
            if (Math.abs(dx) >= optionsRef.current.threshold() || flicked) {
                optionsRef.current.onCommit(g.id, dx > 0 ? "right" : "left");
            }
        };
        return {
            onPointerDown: (e) => {
                const id = e.currentTarget.dataset.swipeId;
                if (optionsRef.current.disabled || id === undefined || gestureRef.current) return;
                const axisLock = optionsRef.current.axisLock;
                gestureRef.current = {
                    pointerId: e.pointerId, id, el: e.currentTarget,
                    startX: e.clientX, startY: e.clientY,
                    lastX: e.clientX, lastT: e.timeStamp, vx: 0,
                    axis: axisLock ? null : "x",
                };
                draggedRef.current = false;
                // Unlocked: the card owns the gesture from the first frame. Locked: capture
                // only once the drag proves horizontal, so a vertical one stays the page's.
                if (!axisLock) e.currentTarget.setPointerCapture(e.pointerId);
            },
            onPointerMove: (e) => {
                const g = gestureRef.current;
                if (!g || g.pointerId !== e.pointerId) return;
                const dx = e.clientX - g.startX;
                const dy = e.clientY - g.startY;
                if (g.axis === null) {
                    if (Math.max(Math.abs(dx), Math.abs(dy)) < AXIS_SLOP_PX) return;
                    if (Math.abs(dy) >= Math.abs(dx)) {
                        // Vertical intent: abandon — the page's scroll owns this press.
                        // (Counts as a drag, so its trailing click doesn't read as a tap.)
                        gestureRef.current = null;
                        draggedRef.current = true;
                        return;
                    }
                    g.axis = "x";
                    e.currentTarget.setPointerCapture(e.pointerId);
                }
                const dt = e.timeStamp - g.lastT;
                if (dt > 0) g.vx = (e.clientX - g.lastX) / dt;
                g.lastX = e.clientX;
                g.lastT = e.timeStamp;
                if (Math.abs(dx) > TAP_SLOP_PX) draggedRef.current = true;
                const paint = optionsRef.current.paint;
                if (!paint) { setDrag({ id: g.id, dx }); return; }
                if (frameRef.current !== null) return; // this frame's paint reads the latest dx
                frameRef.current = requestAnimationFrame(() => {
                    frameRef.current = null;
                    const live = gestureRef.current;
                    if (live) paint(live.el, live.lastX - live.startX);
                });
            },
            onPointerUp: (e) => end(e, false),
            onPointerCancel: (e) => end(e, true),
        };
    }, []);

    // Stable, like `handlers`, so memoized cards that receive it don't re-render.
    const wasDrag = useCallback(() => draggedRef.current, []);

    return {
        activeId: drag?.id ?? null,
        dx: drag?.dx ?? 0,
        dragging: drag !== null,
        wasDrag,
        handlers,
    };
}
