import { useState, useEffect, useRef, useCallback } from "react";
import { CARD_DISMISS_THRESHOLD_VW } from "./constants";

interface UseCardDragReturn {
    cardRef: React.RefObject<HTMLDivElement | null>;
    dragPosition: { x: number; y: number };
    isDragging: boolean;
    isFlipped: boolean;
    setIsFlipped: React.Dispatch<React.SetStateAction<boolean>>;
    handlers: {
        onTouchStart: (e: React.TouchEvent) => void;
        onTouchEnd: (e: React.TouchEvent) => void;
        onMouseDown: (e: React.MouseEvent) => void;
    };
}

export function useCardDrag(
    isAnimating: boolean,
    onDismiss: (direction: 'left' | 'right') => void
): UseCardDragReturn {
    const cardRef = useRef<HTMLDivElement>(null);
    const dragStart = useRef({ x: 0, y: 0 });

    const [dragPosition, setDragPosition] = useState({ x: 0, y: 0 });
    const [isDragging, setIsDragging] = useState(false);
    const [isFlipped, setIsFlipped] = useState(false);

    // Read the card's rendered pixel width at evaluation time.
    // On desktop the frame is capped at 393px inside a wider viewport, so using
    // window.innerWidth would produce a threshold that is far too large.
    // Falls back to window.innerWidth only before the element has mounted.
    const getCardWidth = () => cardRef.current?.offsetWidth ?? window.innerWidth;

    const handleTouchStart = (e: React.TouchEvent) => {
        if (isAnimating) return;

        const touch = e.touches[0];
        dragStart.current = { x: touch.clientX, y: touch.clientY };
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
        if (!isDragging || isAnimating) return;

        setIsDragging(false);

        const threshold = CARD_DISMISS_THRESHOLD_VW * getCardWidth();
        const tapThreshold = 10; // Small movement threshold to distinguish tap from drag
        const { x, y } = dragPosition;

        // Calculate total drag distance
        const dragDistance = Math.sqrt(x * x + y * y);

        if (dragDistance < tapThreshold) {
            // This was a tap, not a drag - flip the card
            setDragPosition({ x: 0, y: 0 });
            setIsFlipped(prev => !prev);
        } else if (Math.abs(x) > threshold) {
            // Card dismissed — reset position first so the transition animates
            // back to center while the parent awaits its 300ms delay before
            // swapping in the next card.
            setDragPosition({ x: 0, y: 0 });
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
        if (!isDragging || isAnimating) return;
        setIsDragging(false);

        const threshold = CARD_DISMISS_THRESHOLD_VW * getCardWidth();
        const tapThreshold = 10; // Small movement threshold to distinguish click from drag
        const { x, y } = dragPosition;

        // Calculate total drag distance
        const dragDistance = Math.sqrt(x * x + y * y);

        if (dragDistance < tapThreshold) {
            // This was a click, not a drag - flip the card
            setDragPosition({ x: 0, y: 0 });
            setIsFlipped(prev => !prev);
        } else if (Math.abs(x) > threshold) {
            // Card dismissed — reset position first so the transition animates
            // back to center while the parent awaits its 300ms delay before
            // swapping in the next card.
            setDragPosition({ x: 0, y: 0 });
            onDismiss(x < 0 ? 'left' : 'right');
        } else {
            // Snap back
            setDragPosition({ x: 0, y: 0 });
        }
    }, [isDragging, isAnimating, dragPosition, onDismiss]);

    // Attach document-level mouse listeners only while a drag is in progress.
    // This prevents the drag from being cancelled if the mouse briefly leaves the
    // card's hit-test area during a fast swipe.
    useEffect(() => {
        if (!isDragging) return;
        document.addEventListener('mousemove', handleDocumentMouseMove);
        document.addEventListener('mouseup', handleDocumentMouseUp);
        return () => {
            document.removeEventListener('mousemove', handleDocumentMouseMove);
            document.removeEventListener('mouseup', handleDocumentMouseUp);
        };
    }, [isDragging, handleDocumentMouseMove, handleDocumentMouseUp]);

    return {
        cardRef,
        dragPosition,
        isDragging,
        isFlipped,
        setIsFlipped,
        handlers: {
            onTouchStart: handleTouchStart,
            onTouchEnd: handleTouchEnd,
            onMouseDown: handleMouseDown,
        },
    };
}
