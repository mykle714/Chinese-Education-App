import { useState, useEffect, useRef, useCallback } from "react";

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
        onMouseMove: (e: React.MouseEvent) => void;
        onMouseUp: () => void;
        onMouseLeave: () => void;
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

        const threshold = 150;
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

    // Mouse handlers for desktop
    const handleMouseDown = (e: React.MouseEvent) => {
        if (isAnimating) return;

        dragStart.current = { x: e.clientX, y: e.clientY };
        setIsDragging(true);
    };

    const handleMouseMove = (e: React.MouseEvent) => {
        if (!isDragging || isAnimating) return;

        const deltaX = e.clientX - dragStart.current.x;
        const deltaY = e.clientY - dragStart.current.y;
        setDragPosition({ x: deltaX, y: deltaY });
    };

    const handleMouseUp = () => {
        if (!isDragging || isAnimating) return;
        setIsDragging(false);

        const threshold = 150;
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
    };

    const handleMouseLeave = () => {
        // Reset drag state if mouse leaves the card while dragging
        if (isDragging && !isAnimating) {
            setIsDragging(false);
            setDragPosition({ x: 0, y: 0 });
        }
    };

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
            onMouseMove: handleMouseMove,
            onMouseUp: handleMouseUp,
            onMouseLeave: handleMouseLeave,
        },
    };
}
