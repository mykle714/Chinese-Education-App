import { useCallback, useEffect, useRef, useState } from "react";
import { CARD_DISMISS_THRESHOLD_VW, CARD_DRAG_SENSITIVITY } from "./constants";

/**
 * `useHandSwipe` — the horizontal throw gesture on `StudyHand`'s FRONT card.
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
 * number is retuned.
 *
 * ── Axis arbitration ──────────────────────────────────────────────────────────
 * The hand sits on the fdp above a draggable `SheetPanel`, inside a scrollable
 * `MobileTabScreen`. So the gesture cannot simply claim every touch: it stays PENDING
 * until the finger has travelled `AXIS_SLOP` px, then commits to horizontal (ours,
 * `preventDefault` from then on) or vertical (declined outright, so the scroll/sheet
 * beneath behaves as if the card were not there). A gesture that never clears the slop
 * is a tap and is left alone.
 *
 * Referenced by docs/DECKS_FEATURE.md and docs/SHELF_REDESIGN.md (entry 2).
 */

/**
 * NOTE: `onSwipe` takes NO direction. The hand is a cycle of three cards, so a left throw
 * and a right throw are the same move — the thrown card goes to the back and the one
 * behind it surfaces (`StudyHand` → `afterSwipe`). The direction survives only as the
 * lean of the card while it is under the finger.
 */

/** Travel (px) before the gesture commits to an axis. Below this it is still a tap. */
const AXIS_SLOP = 8;

/** Tilt (deg per px of drag) — the same gentle lean the flp card takes. */
const DRAG_TILT = 0.05;

/** Phase of the current pointer interaction. See "Axis arbitration" above. */
type GesturePhase = "idle" | "pending" | "dragging" | "declined";

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
    /** Live horizontal offset (px, already amplified). 0 at rest and after a commit. */
    dragX: number;
    /** True only while the finger/cursor owns the card, so the host can kill its transition. */
    isDragging: boolean;
    /** Ready-made transform for the front card: drag translate + proportional tilt. */
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

    const [dragX, setDragX] = useState(0);
    // Mirror of `dragX` for the release handlers to read. Without it `handleDocumentMouseUp`
    // would have to close over the state, and the effect that registers it would tear down
    // and re-add both document listeners on EVERY mousemove.
    const dragXRef = useRef(0);
    // Mirrors phaseRef for rendering AND for the document-listener effect below, which
    // must re-run when a mouse drag starts/stops. A ref alone cannot drive either.
    const [isDragging, setIsDragging] = useState(false);

    // Threshold in px against the card's OWN rendered width, not the viewport: the fdp
    // frame is capped well below `window.innerWidth` on desktop, where a viewport-derived
    // threshold would be unreachably wide.
    const dismissThreshold = () =>
        CARD_DISMISS_THRESHOLD_VW * (cardElRef.current?.offsetWidth ?? window.innerWidth);

    /** Shared release path for both input types. */
    const endGesture = useCallback((offset: number) => {
        phaseRef.current = "idle";
        setIsDragging(false);
        // Always return to 0. On a commit the host simultaneously moves this card into a
        // BACK slot, and CSS transitions animate from the currently-computed transform —
        // so zeroing here does not snap the card, it hands it to the 260ms slot
        // transition from wherever the finger let go. Below threshold, the same
        // transition simply carries it home.
        dragXRef.current = 0;
        setDragX(0);
        if (Math.abs(offset) > dismissThreshold()) onSwipe();
    }, [onSwipe]);

    /** Advance a PENDING gesture once the finger has cleared the slop circle. */
    const arbitrateAxis = (dx: number, dy: number): GesturePhase => {
        if (Math.abs(dx) < AXIS_SLOP && Math.abs(dy) < AXIS_SLOP) return "pending";
        return Math.abs(dx) > Math.abs(dy) ? "dragging" : "declined";
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
        if (phaseRef.current === "idle" || phaseRef.current === "declined") return;

        const touch = e.touches[0];
        const rawX = touch.clientX - dragStart.current.x;
        const rawY = touch.clientY - dragStart.current.y;

        if (phaseRef.current === "pending") {
            const next = arbitrateAxis(rawX, rawY);
            if (next === "pending") return;
            phaseRef.current = next;
            if (next === "declined") return;
            setIsDragging(true);
        }

        if (e.cancelable) e.preventDefault();
        dragXRef.current = rawX * CARD_DRAG_SENSITIVITY;
        setDragX(dragXRef.current);
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
            // A tap or a declined (vertical) gesture — leave both to the elements
            // beneath. Do NOT preventDefault: on a tap that would cancel the synthetic
            // click the `Study now` button needs.
            phaseRef.current = "idle";
            return;
        }
        // A real drag: suppress the synthetic mouse/click burst that would otherwise
        // land on whatever is under the release point.
        if (e.cancelable) e.preventDefault();
        endGesture(dragXRef.current);
    };

    const handleMouseDown = (e: React.MouseEvent) => {
        suppressClickRef.current = false;
        dragStart.current = { x: e.clientX, y: e.clientY };
        phaseRef.current = "pending";
        // Mouse needs the document listeners live from `pending`, not from `dragging`:
        // the move that DECIDES the axis is itself a document-level move.
        setIsDragging(true);
    };

    const handleDocumentMouseMove = useCallback((e: MouseEvent) => {
        if (phaseRef.current === "idle" || phaseRef.current === "declined") return;

        const rawX = e.clientX - dragStart.current.x;
        const rawY = e.clientY - dragStart.current.y;

        if (phaseRef.current === "pending") {
            const next = arbitrateAxis(rawX, rawY);
            if (next === "pending") return;
            phaseRef.current = next;
            if (next === "declined") { setIsDragging(false); return; }
        }

        suppressClickRef.current = true;
        dragXRef.current = rawX * CARD_DRAG_SENSITIVITY;
        setDragX(dragXRef.current);
    }, []);

    const handleDocumentMouseUp = useCallback(() => {
        if (phaseRef.current === "dragging") {
            endGesture(dragXRef.current);
            return;
        }
        // Pending (a plain click) or declined (a vertical drag): no commit, just release
        // the listeners so `Study now` gets its click.
        phaseRef.current = "idle";
        setIsDragging(false);
    }, [endGesture]);

    // Attached from mouse-DOWN rather than from a confirmed drag, so the pending-phase
    // arbitration above can see the deciding move. Detached on every release path.
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
        dragX,
        isDragging,
        dragTransform: `translateX(${dragX}px) rotate(${dragX * DRAG_TILT}deg)`,
        handlers: {
            onTouchStart: handleTouchStart,
            onTouchEnd: handleTouchEnd,
            onMouseDown: handleMouseDown,
            onClickCapture: handleClickCapture,
        },
    };
}

export default useHandSwipe;
