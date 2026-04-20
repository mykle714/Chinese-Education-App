import { useState, useEffect, useRef, useCallback } from "react";
import { CARD_DISMISS_THRESHOLD_VW } from "./constants";

interface UseCardDragReturn {
    cardRef: React.RefObject<HTMLDivElement | null>;
    dragPosition: { x: number; y: number };
    isDragging: boolean;
    isFlipped: boolean;
    setIsFlipped: React.Dispatch<React.SetStateAction<boolean>>;
    hasFlippedCurrentCard: boolean;
    resetDragPosition: () => void;
    handlers: {
        onTouchStart: (e: React.TouchEvent) => void;
        onTouchEnd: (e: React.TouchEvent) => void;
        onMouseDown: (e: React.MouseEvent) => void;
    };
}

export function useCardDrag(
    isAnimating: boolean,
    onDismiss: (direction: 'left' | 'right') => void,
    // resetKey should change whenever a new card is shown so flip-tracking resets
    resetKey: number = 0,
): UseCardDragReturn {
    const cardRef = useRef<HTMLDivElement>(null);
    const dragStart = useRef({ x: 0, y: 0 });
    // True while a mousedown is pending in flip-only mode (card not yet flipped).
    // Kept as state so the document-level mouseup listener effect re-runs on change.
    const [isFlipOnlyMouseDown, setIsFlipOnlyMouseDown] = useState(false);

    const [dragPosition, setDragPosition] = useState({ x: 0, y: 0 });
    const [isDragging, setIsDragging] = useState(false);
    const [isFlipped, setIsFlipped] = useState(false);
    // Tracks whether the user has flipped the current card at least once.
    // Dragging/dismissing is blocked until this is true.
    const [hasFlippedCurrentCard, setHasFlippedCurrentCard] = useState(false);

    // Reset flip-tracking whenever the card changes. New cards always start on
    // Side 1 (isFlipped=false) — the flip is one-way and the Side 1 language
    // randomization lives in the parent page now.
    useEffect(() => {
        setHasFlippedCurrentCard(false);
        setIsFlipped(false);
    }, [resetKey]);

    // Read the card's rendered pixel width at evaluation time.
    // On desktop the frame is capped at 393px inside a wider viewport, so using
    // window.innerWidth would produce a threshold that is far too large.
    // Falls back to window.innerWidth only before the element has mounted.
    const getCardWidth = () => cardRef.current?.offsetWidth ?? window.innerWidth;

    const handleTouchStart = (e: React.TouchEvent) => {
        if (isAnimating) return;

        // Always record the start position so handleTouchEnd can measure drag distance,
        // even when dragging is blocked (card not yet flipped).
        const touch = e.touches[0];
        dragStart.current = { x: touch.clientX, y: touch.clientY };

        // Dragging is only allowed after the card has been flipped at least once
        if (!hasFlippedCurrentCard) return;

        setIsDragging(true);
    };

    const handleTouchMove = useCallback((e: TouchEvent) => {
        if (!isDragging || isAnimating) return;

        // Prevent default to avoid scrolling while dragging the card.
        // Must be a native (non-React) listener registered with { passive: false }
        // so that preventDefault() is actually honoured by the browser.
        e.preventDefault();

        const touch = e.touches[0];
        const deltaX = touch.clientX - dragStart.current.x;
        const deltaY = touch.clientY - dragStart.current.y;
        setDragPosition({ x: deltaX, y: deltaY });
    }, [isDragging, isAnimating]);

    // Attach touchmove as a non-passive native listener so preventDefault works
    useEffect(() => {
        const el = cardRef.current;
        if (!el) return;
        el.addEventListener('touchmove', handleTouchMove, { passive: false });
        return () => el.removeEventListener('touchmove', handleTouchMove);
    }, [handleTouchMove]);

    const handleTouchEnd = (e: React.TouchEvent) => {
        // Prevent the browser from firing synthetic mouse events (mousedown/mouseup/click)
        // after this touch interaction, which would cause a double-flip bug.
        e.preventDefault();

        // If dragging hasn't started (blocked because card wasn't flipped),
        // only flip if this was a genuine tap — finger barely moved.
        if (!isDragging && !isAnimating) {
            const endTouch = e.changedTouches[0];
            const dist = Math.sqrt(
                (endTouch.clientX - dragStart.current.x) ** 2 +
                (endTouch.clientY - dragStart.current.y) ** 2
            );
            // One-way flip: only Side 1 → Side 2, never back.
            if (dist < 10 && !hasFlippedCurrentCard) {
                setIsFlipped(true);
                setHasFlippedCurrentCard(true);
            }
            return;
        }

        if (!isDragging || isAnimating) return;

        setIsDragging(false);

        const threshold = CARD_DISMISS_THRESHOLD_VW * getCardWidth();
        const tapThreshold = 10; // Small movement threshold to distinguish tap from drag
        const { x, y } = dragPosition;

        // Calculate total drag distance
        const dragDistance = Math.sqrt(x * x + y * y);

        if (dragDistance < tapThreshold) {
            // Tap on an already-flipped card: flip is one-way so we just snap
            // back to rest. The Side 1 → Side 2 flip was handled by the
            // tap-while-dragging-blocked branch above.
            setDragPosition({ x: 0, y: 0 });
        } else if (Math.abs(x) > threshold) {
            // Card dismissed — leave dragPosition at its current release position so
            // the fly-out animation starts from where the user dropped it. The parent
            // will call resetDragPosition() after the fly-out completes (450ms).
            onDismiss(x < 0 ? 'left' : 'right');
        } else {
            // Snap back
            setDragPosition({ x: 0, y: 0 });
        }
    };

    // Mouse handlers for desktop.
    // mousedown is the only React synthetic handler — it just records the start position
    // and flips isDragging on. mousemove and mouseup are attached to the document via
    // useEffect below, so rapid drags can never outpace the card's visual bounds and
    // accidentally fire onMouseLeave, which would otherwise cancel the drag.
    const handleMouseDown = (e: React.MouseEvent) => {
        if (isAnimating) return;
        if (!hasFlippedCurrentCard) {
            // Dragging is blocked, but we still need to record the mousedown so that
            // the document-level mouseup can fire a tap-to-flip.
            setIsFlipOnlyMouseDown(true);
            return;
        }

        dragStart.current = { x: e.clientX, y: e.clientY };
        setIsDragging(true);
    };

    const handleDocumentMouseMove = useCallback((e: MouseEvent) => {
        if (!isDragging || isAnimating) return;

        const deltaX = e.clientX - dragStart.current.x;
        const deltaY = e.clientY - dragStart.current.y;
        setDragPosition({ x: deltaX, y: deltaY });
    }, [isDragging, isAnimating]);

    const handleDocumentMouseUp = useCallback(() => {
        // Handle the flip-only case: mousedown was recorded but dragging was blocked.
        // Reachable only when !hasFlippedCurrentCard (mousedown gate at line 139),
        // so the one-way Side 1 → Side 2 transition is safe here.
        if (isFlipOnlyMouseDown) {
            setIsFlipOnlyMouseDown(false);
            if (!isAnimating) {
                setIsFlipped(true);
                setHasFlippedCurrentCard(true);
            }
            return;
        }

        if (!isDragging || isAnimating) return;
        setIsDragging(false);

        const threshold = CARD_DISMISS_THRESHOLD_VW * getCardWidth();
        const tapThreshold = 10; // Small movement threshold to distinguish click from drag
        const { x, y } = dragPosition;

        // Calculate total drag distance
        const dragDistance = Math.sqrt(x * x + y * y);

        if (dragDistance < tapThreshold) {
            // Click on an already-flipped card: flip is one-way, so just snap
            // back to rest. The Side 1 → Side 2 flip was handled by the
            // isFlipOnlyMouseDown branch above.
            setDragPosition({ x: 0, y: 0 });
        } else if (Math.abs(x) > threshold) {
            // Card dismissed — leave dragPosition at its release position so the
            // fly-out animation starts from where the user dropped it.
            onDismiss(x < 0 ? 'left' : 'right');
        } else {
            // Snap back
            setDragPosition({ x: 0, y: 0 });
        }
    }, [isDragging, isFlipOnlyMouseDown, isAnimating, dragPosition, onDismiss]);

    // Attach document-level mouse listeners while a drag is in progress OR while
    // a flip-only mousedown is pending (so the mouseup can still fire a tap-to-flip).
    useEffect(() => {
        if (!isDragging && !isFlipOnlyMouseDown) return;
        document.addEventListener('mousemove', handleDocumentMouseMove);
        document.addEventListener('mouseup', handleDocumentMouseUp);
        return () => {
            document.removeEventListener('mousemove', handleDocumentMouseMove);
            document.removeEventListener('mouseup', handleDocumentMouseUp);
        };
    }, [isDragging, isFlipOnlyMouseDown, handleDocumentMouseMove, handleDocumentMouseUp]);

    return {
        cardRef,
        dragPosition,
        isDragging,
        isFlipped,
        setIsFlipped,
        hasFlippedCurrentCard,
        resetDragPosition: () => setDragPosition({ x: 0, y: 0 }),
        handlers: {
            onTouchStart: handleTouchStart,
            onTouchEnd: handleTouchEnd,
            onMouseDown: handleMouseDown,
        },
    };
}
