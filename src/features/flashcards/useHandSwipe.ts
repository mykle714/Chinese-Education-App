import { useCallback, useEffect, useRef, useState } from "react";
import { CARD_DISMISS_THRESHOLD_VW, CARD_DRAG_SENSITIVITY } from "./constants";

/**
 * `useHandSwipe` — the free (omnidirectional) throw gesture on `StudyHand`'s FRONT card.
 *
 * ── Why this is not `useCardDrag` ─────────────────────────────────────────────
 * The flp's `useCardDrag` (FlashcardsLearnPage/useCardDrag.ts) looks like the same
 * gesture, but its whole body is bound up with the flashcard FLIP: a tap-to-flip
 * classifier, a one-way flip lock, a `hasFlippedCurrentCard` gate that refuses drags,
 * two tutorial hint states and an undo-restore path. None of that exists on the hand,
 * where a card has one face and a tap on a back card is already a promote. Reusing it
 * would mean threading half a dozen "not applicable" flags through it.
 *
 * What the two DO share is the physical feel, and that is shared properly — through
 * `CARD_DRAG_SENSITIVITY` and `CARD_DISMISS_THRESHOLD_VW` in `../constants`, so the
 * hand and the flp stack respond to a finger identically and stay in step if either
 * number is retuned. As of the omnidirectional rework they also share the SHAPE of the
 * gesture: the card follows the finger on both axes and commits on radial distance,
 * exactly as an flp card does. The one thing the flp keeps to itself is *meaning* per
 * direction (left = incorrect, right = correct); the hand is a cycle of three, so every
 * direction is the same rotation (see `onSwipe` below).
 *
 * ── Claiming the gesture ──────────────────────────────────────────────────────
 * The hand sits on the fdp above a draggable `SheetPanel`, inside a scrollable
 * `MobileTabScreen`. Because the card now moves on BOTH axes, the gesture can no longer
 * hand the vertical axis back to those: once the finger has travelled `DRAG_SLOP` px in
 * any direction the card owns the touch and `preventDefault`s it. The front card is
 * therefore `touchAction: "none"` in `StudyHand` — a finger that starts ON the played
 * card drags the card, and the page/sheet beneath is scrolled from anywhere else. A
 * gesture that never clears the slop is still a tap and is left alone.
 *
 * Referenced by docs/DECKS_FEATURE.md and docs/SHELF_REDESIGN.md (entry 2).
 */

/**
 * NOTE: `onSwipe` takes NO direction. The hand is a cycle of three cards, so every throw
 * is the same move — the thrown card goes to the back and the one behind it surfaces
 * (`StudyHand` → `afterSwipe`). The direction survives only as the path the card takes
 * out from under the finger.
 */

/** Travel (px) before the gesture stops being a tap and starts moving the card. */
const DRAG_SLOP = 8;

/** Tilt (deg per px of HORIZONTAL drag) — the same gentle lean the flp card takes. */
const DRAG_TILT = 0.05;

/** Phase of the current pointer interaction. See "Claiming the gesture" above. */
type GesturePhase = "idle" | "pending" | "dragging";

/** Live drag offset in px, already amplified by `CARD_DRAG_SENSITIVITY`. */
export interface DragOffset {
    x: number;
    y: number;
}

const NO_DRAG: DragOffset = { x: 0, y: 0 };

export interface UseHandSwipeReturn {
    /**
     * Attach to the FRONT card — the gesture measures its width for the threshold and
     * binds its non-passive `touchmove` to it.
     *
     * A CALLBACK ref, not an object ref, and that is load-bearing: the host passes it
     * conditionally (`ref={isFront ? cardRef : undefined}`), so the element it points at
     * CHANGES every time a different card is played forward. An object ref would mutate
     * `.current` silently, leaving the `touchmove` listener bound to the card that used to
     * be in front — the second swipe of a session would do nothing. The callback drives a
     * state update, so the binding effect re-runs and follows the front card.
     */
    cardRef: (el: HTMLDivElement | null) => void;
    /** Live offset on both axes (px, already amplified). `{0,0}` at rest and after a commit. */
    drag: DragOffset;
    /** True only while the finger/cursor owns the card, so the host can kill its transition. */
    isDragging: boolean;
    /** Ready-made transform for the front card: drag translate + tilt from the x component. */
    dragTransform: string;
    handlers: {
        onTouchStart: (e: React.TouchEvent) => void;
        onTouchEnd: (e: React.TouchEvent) => void;
        onMouseDown: (e: React.MouseEvent) => void;
        /**
         * Swallows the click that a mouse drag would otherwise deliver to whatever sits
         * under the release point — which on the front card is very often `Study now`.
         * Capture phase, so it lands before the button's own handler.
         */
        onClickCapture: (e: React.MouseEvent) => void;
    };
}

export function useHandSwipe(onSwipe: () => void): UseHandSwipeReturn {
    // Two handles on the same element: `cardElRef` for the synchronous reads inside event
    // handlers, `cardEl` state to re-run the listener-binding effect. See `cardRef` below.
    const cardElRef = useRef<HTMLDivElement | null>(null);
    const [cardEl, setCardEl] = useState<HTMLDivElement | null>(null);
    const cardRef = useCallback((el: HTMLDivElement | null) => {
        cardElRef.current = el;
        setCardEl(el);
    }, []);

    const dragStart = useRef({ x: 0, y: 0 });
    const phaseRef = useRef<GesturePhase>("idle");
    // Set when a drag actually moved the card, so the trailing synthetic click can be
    // eaten. Cleared by that click, or by the next pointer-down if no click arrives.
    const suppressClickRef = useRef(false);

    const [drag, setDrag] = useState<DragOffset>(NO_DRAG);
    // Mirror of `drag` for the release handlers to read. Without it `handleDocumentMouseUp`
    // would have to close over the state, and the effect that registers it would tear down
    // and re-add both document listeners on EVERY mousemove.
    const dragRef = useRef<DragOffset>(NO_DRAG);
    // Mirrors phaseRef for rendering AND for the document-listener effect below, which
    // must re-run when a mouse drag starts/stops. A ref alone cannot drive either.
    const [isDragging, setIsDragging] = useState(false);

    // Threshold in px against the card's OWN rendered width, not the viewport: the fdp
    // frame is capped well below `window.innerWidth` on desktop, where a viewport-derived
    // threshold would be unreachably wide. The SAME number governs both axes, so the
    // commit boundary is a circle — a throw upward has to travel exactly as far as a
    // throw sideways, which is what "far enough away in any direction" means physically.
    const dismissThreshold = () =>
        CARD_DISMISS_THRESHOLD_VW * (cardElRef.current?.offsetWidth ?? window.innerWidth);

    /** Shared release path for both input types. */
    const endGesture = useCallback((offset: DragOffset) => {
        phaseRef.current = "idle";
        setIsDragging(false);
        // Always return to {0,0}. On a commit the host simultaneously moves this card into
        // a BACK slot, and CSS transitions animate from the currently-computed transform —
        // so zeroing here does not snap the card, it hands it to the 260ms slot
        // transition from wherever the finger let go. Below threshold, the same
        // transition simply carries it home.
        dragRef.current = NO_DRAG;
        setDrag(NO_DRAG);
        if (Math.hypot(offset.x, offset.y) > dismissThreshold()) onSwipe();
    }, [onSwipe]);

    /** Has a PENDING gesture travelled far enough to stop being a tap? */
    const clearedSlop = (dx: number, dy: number) => Math.hypot(dx, dy) >= DRAG_SLOP;

    /** Amplify the raw pointer delta and publish it to both the state and the ref mirror. */
    const applyDelta = (rawX: number, rawY: number) => {
        const next = { x: rawX * CARD_DRAG_SENSITIVITY, y: rawY * CARD_DRAG_SENSITIVITY };
        dragRef.current = next;
        setDrag(next);
    };

    const handleTouchStart = (e: React.TouchEvent) => {
        suppressClickRef.current = false;
        const touch = e.touches[0];
        dragStart.current = { x: touch.clientX, y: touch.clientY };
        phaseRef.current = "pending";
    };

    // Native, non-passive: a React `onTouchMove` is registered passively, so its
    // `preventDefault()` is ignored and the page would scroll under the drag.
    const handleTouchMove = useCallback((e: TouchEvent) => {
        if (phaseRef.current === "idle") return;

        const touch = e.touches[0];
        const rawX = touch.clientX - dragStart.current.x;
        const rawY = touch.clientY - dragStart.current.y;

        if (phaseRef.current === "pending") {
            if (!clearedSlop(rawX, rawY)) return;
            phaseRef.current = "dragging";
            setIsDragging(true);
        }

        if (e.cancelable) e.preventDefault();
        applyDelta(rawX, rawY);
    }, []);

    // Re-binds whenever the played card changes, which is exactly what the callback ref
    // exists to make possible.
    useEffect(() => {
        if (!cardEl) return;
        cardEl.addEventListener("touchmove", handleTouchMove, { passive: false });
        return () => cardEl.removeEventListener("touchmove", handleTouchMove);
    }, [cardEl, handleTouchMove]);

    const handleTouchEnd = (e: React.TouchEvent) => {
        if (phaseRef.current !== "dragging") {
            // A tap — leave it to the elements beneath. Do NOT preventDefault: on a tap
            // that would cancel the synthetic click the `Study now` button needs.
            phaseRef.current = "idle";
            return;
        }
        // A real drag: suppress the synthetic mouse/click burst that would otherwise
        // land on whatever is under the release point.
        if (e.cancelable) e.preventDefault();
        endGesture(dragRef.current);
    };

    const handleMouseDown = (e: React.MouseEvent) => {
        suppressClickRef.current = false;
        dragStart.current = { x: e.clientX, y: e.clientY };
        phaseRef.current = "pending";
        // Mouse needs the document listeners live from `pending`, not from `dragging`:
        // the move that CLEARS the slop is itself a document-level move.
        setIsDragging(true);
    };

    const handleDocumentMouseMove = useCallback((e: MouseEvent) => {
        if (phaseRef.current === "idle") return;

        const rawX = e.clientX - dragStart.current.x;
        const rawY = e.clientY - dragStart.current.y;

        if (phaseRef.current === "pending") {
            if (!clearedSlop(rawX, rawY)) return;
            phaseRef.current = "dragging";
        }

        suppressClickRef.current = true;
        applyDelta(rawX, rawY);
    }, []);

    const handleDocumentMouseUp = useCallback(() => {
        if (phaseRef.current === "dragging") {
            endGesture(dragRef.current);
            return;
        }
        // Pending (a plain click): no commit, just release the listeners so `Study now`
        // gets its click.
        phaseRef.current = "idle";
        setIsDragging(false);
    }, [endGesture]);

    // Attached from mouse-DOWN rather than from a confirmed drag, so the pending-phase
    // slop test above can see the deciding move. Detached on every release path.
    useEffect(() => {
        if (!isDragging) return;
        document.addEventListener("mousemove", handleDocumentMouseMove);
        document.addEventListener("mouseup", handleDocumentMouseUp);
        return () => {
            document.removeEventListener("mousemove", handleDocumentMouseMove);
            document.removeEventListener("mouseup", handleDocumentMouseUp);
        };
    }, [isDragging, handleDocumentMouseMove, handleDocumentMouseUp]);

    const handleClickCapture = (e: React.MouseEvent) => {
        if (!suppressClickRef.current) return;
        suppressClickRef.current = false;
        e.stopPropagation();
        e.preventDefault();
    };

    return {
        cardRef,
        drag,
        isDragging,
        // The tilt reads from x only: a card thrown straight up should rise flat, and a
        // y-coupled rotation would make a vertical throw spin for no reason the hand can
        // explain.
        dragTransform: `translate(${drag.x}px, ${drag.y}px) rotate(${drag.x * DRAG_TILT}deg)`,
        handlers: {
            onTouchStart: handleTouchStart,
            onTouchEnd: handleTouchEnd,
            onMouseDown: handleMouseDown,
            onClickCapture: handleClickCapture,
        },
    };
}

export default useHandSwipe;
