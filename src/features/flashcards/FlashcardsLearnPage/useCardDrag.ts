import { useState, useEffect, useRef, useCallback } from "react";
import { CARD_DISMISS_THRESHOLD_VW, CARD_FLY_OUT_MS } from "./constants";

interface UseCardDragReturn {
    cardRef: React.RefObject<HTMLDivElement | null>;
    dragPosition: { x: number; y: number };
    isDragging: boolean;
    isFlipped: boolean;
    setIsFlipped: React.Dispatch<React.SetStateAction<boolean>>;
    hasFlippedCurrentCard: boolean;
    resetDragPosition: () => void;
    // Whether the swipe-direction hint labels (← Incorrect / Correct →) should be
    // visible. Toggles on when the user taps an already-flipped card; off on dismiss.
    showSwipeHint: boolean;
    // Whether the "Tap to flip" hint should be visible. Toggles on when the user
    // attempts to drag a card that has not yet been flipped.
    showTapToFlipHint: boolean;
    // Incremented every time we want to (re-)play the card-shake animation. The
    // animated element keys on this value so React re-mounts the keyframe.
    shakeNonce: number;
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
    // Swipe-direction tutorial state: shown after a "wasted" tap on a flipped card.
    const [showSwipeHint, setShowSwipeHint] = useState(false);
    // Flip tutorial state: shown after a "wasted" drag on a not-yet-flipped card.
    const [showTapToFlipHint, setShowTapToFlipHint] = useState(false);
    const [shakeNonce, setShakeNonce] = useState(0);
    // Tracks the latest cursor position while a mouse interaction is in progress.
    // Used by the flip-only branch to distinguish a click from a swipe attempt
    // (the drag path uses dragPosition; the flip-only path can't, because we
    // intentionally don't translate the card before it's been flipped).
    const lastMousePos = useRef({ x: 0, y: 0 });

    // Flip-animation lockout. The one-way flip plays a CARD_FLY_OUT_MS linear
    // transition; a second tap during that window would otherwise be treated as a
    // tap on an already-flipped card and bump shakeNonce, which remounts the front
    // card (key=`front-${shakeNonce}`) and cuts the flip short into a shake. We hold
    // this lock for the flip's duration and ignore all taps/drags while it's set, so
    // the next interaction can only land after the flip has fully completed. A ref
    // (not state) keeps the event handlers from needing it as a dependency.
    const flipLockRef = useRef(false);
    const flipLockTimer = useRef<ReturnType<typeof setTimeout> | null>(null);

    // Tracks whether the current touch interaction's touchstart was actually
    // accepted (i.e. not swallowed by the isAnimating/flipLock gate). dragStart is
    // a single ref shared across every card and is only refreshed inside an
    // accepted touchstart, so a touch whose start was gated would leave dragStart
    // pointing at the *previous* card's coordinates. handleTouchEnd reads this flag
    // and bails when false, so it never measures tap distance against a stale point
    // (which would misclassify a genuine tap as a drag attempt and shake instead of
    // flipping).
    const touchAcceptedRef = useRef(false);

    // Perform the one-way Side 1 → Side 2 flip and arm the lockout. Shared by the
    // touch and mouse tap paths so the lock behaves identically across input types.
    const beginFlip = () => {
        setIsFlipped(true);
        setHasFlippedCurrentCard(true);
        setShowTapToFlipHint(false);
        flipLockRef.current = true;
        if (flipLockTimer.current) clearTimeout(flipLockTimer.current);
        flipLockTimer.current = setTimeout(() => {
            flipLockRef.current = false;
        }, CARD_FLY_OUT_MS);
    };

    // Clear any pending lockout timer on unmount to avoid a stray callback.
    useEffect(() => () => {
        if (flipLockTimer.current) clearTimeout(flipLockTimer.current);
    }, []);

    // Reset flip-tracking whenever the card changes. New cards always start on
    // Side 1 (isFlipped=false) — the flip is one-way and the Side 1 language
    // randomization lives in the parent page now.
    useEffect(() => {
        setHasFlippedCurrentCard(false);
        setIsFlipped(false);
        setShowSwipeHint(false);
        setShowTapToFlipHint(false);
        setShakeNonce(0);
        // A fresh card starts unflipped, so any in-flight flip lock is moot.
        flipLockRef.current = false;
        if (flipLockTimer.current) clearTimeout(flipLockTimer.current);
    }, [resetKey]);

    // Read the card's rendered pixel width at evaluation time.
    // On desktop the frame is capped at 393px inside a wider viewport, so using
    // window.innerWidth would produce a threshold that is far too large.
    // Falls back to window.innerWidth only before the element has mounted.
    const getCardWidth = () => cardRef.current?.offsetWidth ?? window.innerWidth;

    const handleTouchStart = (e: React.TouchEvent) => {
        // Ignore the whole interaction while a flip is mid-animation. Mark this
        // touch as not-accepted so the matching touchend can't act on a stale
        // dragStart left over from the previous card.
        if (isAnimating || flipLockRef.current) {
            touchAcceptedRef.current = false;
            return;
        }
        touchAcceptedRef.current = true;

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
        // Guard on `cancelable`: when the touch sequence was a scroll, the browser marks
        // touchend as non-cancelable and logs an "[Intervention] Ignored attempt to cancel a
        // touchend event with cancelable=false" warning if we call preventDefault anyway. In
        // that case there are no synthetic mouse events to suppress, so skipping it is safe.
        if (e.cancelable) e.preventDefault();

        // A flip is still animating — swallow this tap entirely (no flip, no shake)
        // so it can't remount the card mid-flip.
        if (flipLockRef.current) return;

        // The matching touchstart was swallowed by the gate, so dragStart still
        // holds the previous card's coordinates — measuring tap distance against it
        // would misread this tap as a drag attempt and shake instead of flipping.
        // Ignore the end entirely.
        if (!touchAcceptedRef.current) return;

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
                beginFlip();
            } else if (!hasFlippedCurrentCard) {
                // Drag attempt on an unflipped card: shake the card and fade in
                // the "Tap to flip" hint. Mirrors the swipe-direction tutorial.
                setShakeNonce(n => n + 1);
                setShowTapToFlipHint(true);
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
            // Tap on an already-flipped card: trigger the swipe tutorial — shake
            // the card and fade in the ← Incorrect / Correct → hint labels.
            setDragPosition({ x: 0, y: 0 });
            if (isFlipped) {
                setShakeNonce(n => n + 1);
                setShowSwipeHint(true);
            }
        } else if (Math.abs(x) > threshold) {
            // Card dismissed — leave dragPosition at its current release position so
            // the fly-out animation starts from where the user dropped it. The parent
            // will call resetDragPosition() after the fly-out completes (450ms).
            // Fade the hint out in lock-step with the fly-off.
            setShowSwipeHint(false);
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
        // Ignore the whole interaction while a flip is mid-animation.
        if (isAnimating || flipLockRef.current) return;
        if (!hasFlippedCurrentCard) {
            // Dragging is blocked, but we still need to record the mousedown so that
            // the document-level mouseup can fire a tap-to-flip — and so we can
            // measure cursor distance to detect a swipe attempt before flipping.
            dragStart.current = { x: e.clientX, y: e.clientY };
            lastMousePos.current = { x: e.clientX, y: e.clientY };
            setIsFlipOnlyMouseDown(true);
            return;
        }

        dragStart.current = { x: e.clientX, y: e.clientY };
        setIsDragging(true);
    };

    const handleDocumentMouseMove = useCallback((e: MouseEvent) => {
        // Always track latest cursor position while listeners are attached so
        // the flip-only mouseup can measure distance — but only update
        // dragPosition (which visually translates the card) when truly dragging.
        lastMousePos.current = { x: e.clientX, y: e.clientY };
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
                const dist = Math.sqrt(
                    (lastMousePos.current.x - dragStart.current.x) ** 2 +
                    (lastMousePos.current.y - dragStart.current.y) ** 2
                );
                if (dist < 10) {
                    beginFlip();
                } else {
                    // Swipe attempt on an unflipped card — same treatment as touch.
                    setShakeNonce(n => n + 1);
                    setShowTapToFlipHint(true);
                }
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
            // Click on an already-flipped card: trigger the swipe tutorial — shake
            // the card and fade in the ← Incorrect / Correct → hint labels.
            setDragPosition({ x: 0, y: 0 });
            if (isFlipped) {
                setShakeNonce(n => n + 1);
                setShowSwipeHint(true);
            }
        } else if (Math.abs(x) > threshold) {
            // Card dismissed — leave dragPosition at its release position so the
            // fly-out animation starts from where the user dropped it.
            setShowSwipeHint(false);
            onDismiss(x < 0 ? 'left' : 'right');
        } else {
            // Snap back
            setDragPosition({ x: 0, y: 0 });
        }
    }, [isDragging, isFlipOnlyMouseDown, isAnimating, dragPosition, isFlipped, onDismiss]);

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
        showSwipeHint,
        showTapToFlipHint,
        shakeNonce,
        resetDragPosition: () => setDragPosition({ x: 0, y: 0 }),
        handlers: {
            onTouchStart: handleTouchStart,
            onTouchEnd: handleTouchEnd,
            onMouseDown: handleMouseDown,
        },
    };
}
