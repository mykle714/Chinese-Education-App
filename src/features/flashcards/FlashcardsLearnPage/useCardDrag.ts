import { useState, useEffect, useRef, useCallback } from "react";
import {
    CARD_DISMISS_THRESHOLD_VW,
    CARD_DRAG_SENSITIVITY,
    CARD_FLICK_MIN_DISTANCE,
    CARD_FLICK_MIN_VELOCITY,
    CARD_FLICK_WINDOW_MS,
    CARD_TAP_SLOP,
    TOWER_CARD_FLIP_MS,
} from "../constants";

/**
 * The flp card's tap / drag / swipe controller.
 *
 * ── Why the gesture lives in refs (2026-11-17 rewrite) ──
 * The previous version kept the drag in React STATE and classified the release from the
 * last RENDERED dragPosition, with a touchmove listener whose closure was rebuilt on every
 * isDragging change. Recorded real-flp input (docs/SWIPE_LAB.md) showed what that does on
 * a phone: the flp's render is heavy, so a fast flick's touchmoves arrived before the
 * re-render that "started" the drag and were dropped by a listener still holding
 * isDragging=false, and touchend ran a handler from an equally stale render. 13 of 31 real
 * flicks were lost — read as nothing, or as a tap (shake) — and the learner had to swipe
 * again. Now every sample is recorded synchronously into `gestureRef`, the release is
 * classified from the finger's real lift-off point, and React state is only the VISUAL
 * copy (the card's translate + the drag-transition switch).
 *
 * ── Release classification (`classifyRelease`) ──
 *   furthest travel < CARD_TAP_SLOP                       → tap
 *   sideways release speed ≥ CARD_FLICK_MIN_VELOCITY and
 *   sideways travel ≥ CARD_FLICK_MIN_DISTANCE             → flick (dismiss toward motion)
 *   |amplified dx| > CARD_DISMISS_THRESHOLD_VW × width    → dismiss (distance, any speed)
 *   otherwise                                             → snap back
 *
 * ── Locks ──
 *  • Flip lock (flipMs after a flip): TAPS are swallowed, so a second tap can't remount
 *    the card mid-flip into a shake; SWIPES are allowed (flip-then-flick).
 *  • Fly-out (isAnimating): the new front card can be TAPPED to flip while the previous
 *    card is still flying. A swipe classified during the fly-out is queued and fired the
 *    moment it ends (the working loop refuses a dismiss mid-fly-out).
 *
 * Docs: docs/SWIPE_LAB.md (the data and thresholds), docs/DECK_TOWER.md (the flp).
 */

interface UseCardDragReturn {
    cardRef: React.RefObject<HTMLDivElement | null>;
    dragPosition: { x: number; y: number };
    isDragging: boolean;
    isFlipped: boolean;
    setIsFlipped: (value: boolean) => void;
    // Full per-card reset (Side 1, not-yet-flipped, hints/shake/flip-lock cleared) for
    // when the card under resetKey is REPLACED without resetKey changing — the
    // working loop's fresh fetch, which always lands at index 0. Clearing only
    // isFlipped there would leave hasFlippedCurrentCard stuck true from a tap on the
    // card that was replaced: the new card then can't be flipped (so More Info stays
    // greyed) yet can be swiped unseen.
    resetCard: () => void;
    // Puts the (restored) card back on Side 2 — used by mark-undo, which brings a
    // card the user has already flipped back into view. Survives the per-card
    // reset effect that would otherwise force Side 1 (see restoreFlippedRef).
    restoreFlipped: (targetResetKey: number) => void;
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

/** A position sample of the gesture's tracked finger, on the event-timeStamp clock. */
interface Sample { t: number; x: number; y: number }

/** One press, from finger-down to lift-off. Mutated in place; never rendered. */
interface Gesture {
    /** Touch identifier being followed (null for the mouse). */
    touchId: number | null;
    start: Sample;
    last: Sample;
    /** Furthest raw distance from start reached at any point — the tap test reads this. */
    maxDist: number;
    /** Recent samples for the release-speed estimate (trimmed to the flick window). */
    recent: Sample[];
    /** Whether the card may follow this press (it was flipped when the press began). */
    canDrag: boolean;
    /** The press began inside the flip lock: a tap now is swallowed. */
    inFlipLock: boolean;
}

type Release =
    | { kind: "tap" }
    | { kind: "dismiss"; direction: "left" | "right" }
    | { kind: "snap" };

/**
 * Decide what a lift-off was. Pure — reads only the gesture and the card width — so the
 * thresholds can be replayed offline against recorded input (docs/SWIPE_LAB.md).
 */
export function classifyRelease(g: Pick<Gesture, "start" | "last" | "maxDist" | "recent">, cardWidth: number): Release {
    if (g.maxDist < CARD_TAP_SLOP) return { kind: "tap" };
    const dx = g.last.x - g.start.x;

    // Release speed over the last CARD_FLICK_WINDOW_MS. A finger that paused before
    // lifting has no sample pair inside the window, so its speed reads 0 (not a flick).
    const windowStart = g.last.t - CARD_FLICK_WINDOW_MS;
    const inWindow = g.recent.filter((s) => s.t >= windowStart);
    let vx = 0;
    if (inWindow.length >= 2) {
        const first = inWindow[0];
        const dt = g.last.t - first.t;
        if (dt > 0) vx = (g.last.x - first.x) / dt;
    }
    if (Math.abs(vx) >= CARD_FLICK_MIN_VELOCITY && Math.abs(dx) >= CARD_FLICK_MIN_DISTANCE && Math.sign(vx) === Math.sign(dx)) {
        return { kind: "dismiss", direction: vx < 0 ? "left" : "right" };
    }

    if (Math.abs(dx * CARD_DRAG_SENSITIVITY) > CARD_DISMISS_THRESHOLD_VW * cardWidth) {
        return { kind: "dismiss", direction: dx < 0 ? "left" : "right" };
    }
    return { kind: "snap" };
}

export function useCardDrag(
    isAnimating: boolean,
    onDismiss: (direction: 'left' | 'right') => void,
    // resetKey should change whenever a new card is shown so flip-tracking resets
    resetKey: number = 0,
    // The flip's duration — the lockout below lasts exactly this long. The flp's card is
    // the Deck Tower's, with its slower flip (TOWER_CARD_FLIP_MS).
    flipMs: number = TOWER_CARD_FLIP_MS,
): UseCardDragReturn {
    const cardRef = useRef<HTMLDivElement>(null);

    const [dragPosition, setDragPosition] = useState({ x: 0, y: 0 });
    const [isDragging, setIsDragging] = useState(false);
    const [isFlippedRaw, setIsFlippedRaw] = useState(false);
    // The card (resetKey) the current flip belongs to. A dismiss advances resetKey
    // one render BEFORE the per-card reset effect below clears the flip, so a raw
    // isFlipped reads "flipped" for the incoming card for that one render. That
    // window is not cosmetic: the flp's narration effect derives which face is
    // showing from isFlipped, and a stale `true` made it auto-play the Chinese
    // audio over an English Side 1 (see FlashcardsLearnPage's "TTS narration"
    // effect). Scoping the flip to the card it was made on closes that window
    // without depending on effect ordering.
    const flippedForKeyRef = useRef<number | null>(null);
    const isFlipped = isFlippedRaw && flippedForKeyRef.current === resetKey;

    // Exposed setter — only ever called with `false` (a fresh deck fetch forcing
    // Side 1) or by revealAnswer with `true`, so it keys the flip like a tap does.
    const setIsFlipped = useCallback((value: boolean) => {
        flippedForKeyRef.current = value ? resetKey : null;
        hasFlippedRef.current = hasFlippedRef.current || value;
        if (value) setHasFlippedCurrentCard(true);
        setIsFlippedRaw(value);
        // resetKey is read at call time; a stale closure would mis-key the flip.
    }, [resetKey]);
    // Tracks whether the user has flipped the current card at least once.
    // Dragging/dismissing is blocked until this is true. Mirrored in a ref so a press
    // right after a flip sees it before the re-render lands.
    const [hasFlippedCurrentCard, setHasFlippedCurrentCard] = useState(false);
    const hasFlippedRef = useRef(false);
    // Swipe-direction tutorial state: shown after a "wasted" tap on a flipped card.
    const [showSwipeHint, setShowSwipeHint] = useState(false);
    // Flip tutorial state: shown after a "wasted" drag on a not-yet-flipped card.
    const [showTapToFlipHint, setShowTapToFlipHint] = useState(false);
    const [shakeNonce, setShakeNonce] = useState(0);

    // Flip lock: true for `flipMs` after a flip (see the header). A ref so the press
    // handlers read it synchronously.
    const flipLockRef = useRef(false);
    const flipLockTimer = useRef<ReturnType<typeof setTimeout> | null>(null);

    // Holds the resetKey that restoreFlipped() is restoring for, so the per-card
    // reset effect can land on Side 2 instead of Side 1 for exactly that card.
    // Undo changes resetKey (currentIndex) and restores the flip in the same
    // batch, so the reset effect always runs afterwards and would otherwise
    // clobber the restored flip back to Side 1. Storing the key (rather than a
    // bare flag) makes a stale value harmless.
    const restoreFlippedForKeyRef = useRef<number | null>(null);

    // The press in progress, or null. See `Gesture`.
    const gestureRef = useRef<Gesture | null>(null);
    // Detaches the document listeners of the press in progress.
    const detachRef = useRef<(() => void) | null>(null);
    // A swipe classified during the previous card's fly-out, fired when it ends.
    const pendingDismissRef = useRef<'left' | 'right' | null>(null);

    // Latest-render values for the document listeners, which are bound once per press.
    const liveRef = useRef({ isAnimating, onDismiss, resetKey, flipMs });
    liveRef.current = { isAnimating, onDismiss, resetKey, flipMs };

    // Perform the one-way Side 1 → Side 2 flip and arm the lockout.
    const beginFlip = useCallback(() => {
        const { resetKey: key, flipMs: ms } = liveRef.current;
        flippedForKeyRef.current = key;
        hasFlippedRef.current = true;
        setIsFlippedRaw(true);
        setHasFlippedCurrentCard(true);
        setShowTapToFlipHint(false);
        flipLockRef.current = true;
        if (flipLockTimer.current) clearTimeout(flipLockTimer.current);
        flipLockTimer.current = setTimeout(() => {
            flipLockRef.current = false;
        }, ms);
    }, []);

    // Put the card straight onto Side 2 without the tap-to-flip gate. Used when a
    // card the user already flipped is brought back into view (mark-undo): the
    // user has seen the answer, so re-hiding it behind Side 1 would be wrong —
    // and hasFlippedCurrentCard must be true or the card couldn't be swiped again.
    const restoreFlipped = useCallback((targetResetKey: number) => {
        restoreFlippedForKeyRef.current = targetResetKey;
        flippedForKeyRef.current = targetResetKey;
        hasFlippedRef.current = true;
        setIsFlippedRaw(true);
        setHasFlippedCurrentCard(true);
    }, []);

    // Drop the press in progress without classifying it.
    const abandonGesture = useCallback(() => {
        detachRef.current?.();
        detachRef.current = null;
        gestureRef.current = null;
        setIsDragging(false);
    }, []);

    // Clear timers and listeners on unmount.
    useEffect(() => () => {
        if (flipLockTimer.current) clearTimeout(flipLockTimer.current);
        detachRef.current?.();
    }, []);

    // Reset flip-tracking whenever the card changes. New cards always start on
    // Side 1 (isFlipped=false). The one exception is an undo restore (restoreFlipped).
    //
    // `resetCard` is the same reset for the non-undo case, also exposed so the working
    // loop can run it when it swaps the card WITHOUT changing resetKey (see the
    // UseCardDragReturn docblock). Refs + state setters only, so its identity is stable.
    const resetCard = useCallback(() => {
        restoreFlippedForKeyRef.current = null;
        hasFlippedRef.current = false;
        setHasFlippedCurrentCard(false);
        flippedForKeyRef.current = null;
        setIsFlippedRaw(false);
        setShowSwipeHint(false);
        setShowTapToFlipHint(false);
        setShakeNonce(0);
        // A press begun on the replaced card must not flip or dismiss the new one.
        // (A press begun on the NEW card during its predecessor's fly-out starts after
        // this runs — the reset fires on the render that advanced resetKey.)
        abandonGesture();
        pendingDismissRef.current = null;
        flipLockRef.current = false;
        if (flipLockTimer.current) clearTimeout(flipLockTimer.current);
    }, [abandonGesture]);

    useEffect(() => {
        if (restoreFlippedForKeyRef.current === resetKey) {
            // Undo restore: restoreFlipped already put this card on Side 2; only the
            // transient hints and any flip lock need clearing.
            restoreFlippedForKeyRef.current = null;
            setShowSwipeHint(false);
            setShowTapToFlipHint(false);
            setShakeNonce(0);
            flipLockRef.current = false;
            if (flipLockTimer.current) clearTimeout(flipLockTimer.current);
            return;
        }
        resetCard();
    }, [resetKey, resetCard]);

    // A swipe made during the fly-out fires the moment the fly-out ends.
    useEffect(() => {
        if (isAnimating || !pendingDismissRef.current) return;
        const dir = pendingDismissRef.current;
        pendingDismissRef.current = null;
        setShowSwipeHint(false);
        onDismiss(dir);
    }, [isAnimating, onDismiss]);

    // Read the card's rendered pixel width at evaluation time (the frame is capped on
    // desktop, so window.innerWidth would over-size the threshold).
    const getCardWidth = () => cardRef.current?.offsetWidth ?? window.innerWidth;

    // ── The press, input-agnostic ──────────────────────────────────────────────────────
    const begin = (x: number, y: number, t: number, touchId: number | null): boolean => {
        const { isAnimating: animating } = liveRef.current;
        if (gestureRef.current) return false; // a second finger; keep following the first
        const canDrag = hasFlippedRef.current;
        // Mid-fly-out only a tap-to-flip on the new card is accepted; a flipped card
        // can't be pressed yet (its fly-out predecessor still owns the dismiss slot).
        if (animating && canDrag) return false;
        const s = { t, x, y };
        gestureRef.current = {
            touchId,
            start: s,
            last: s,
            maxDist: 0,
            recent: [s],
            canDrag,
            inFlipLock: flipLockRef.current,
        };
        if (canDrag) setIsDragging(true);
        return true;
    };

    const move = (x: number, y: number, t: number) => {
        const g = gestureRef.current;
        if (!g) return;
        const s = { t, x, y };
        g.last = s;
        g.recent.push(s);
        // Keep a little more than the flick window; the classifier filters exactly.
        while (g.recent.length > 2 && g.recent[0].t < t - CARD_FLICK_WINDOW_MS * 2) g.recent.shift();
        const dist = Math.hypot(x - g.start.x, y - g.start.y);
        if (dist > g.maxDist) g.maxDist = dist;
        if (g.canDrag) {
            setDragPosition({
                x: (x - g.start.x) * CARD_DRAG_SENSITIVITY,
                y: (y - g.start.y) * CARD_DRAG_SENSITIVITY,
            });
        }
    };

    const end = (x: number, y: number, t: number) => {
        const g = gestureRef.current;
        if (!g) return;
        move(x, y, t);
        detachRef.current?.();
        detachRef.current = null;
        gestureRef.current = null;
        setIsDragging(false);

        const release = classifyRelease(g, getCardWidth());

        // Card not yet flipped: a tap flips it, anything else is a swipe attempt
        // (shake + "Tap to flip" hint).
        if (!g.canDrag) {
            if (release.kind === "tap") {
                if (!hasFlippedRef.current) beginFlip();
            } else {
                setShakeNonce((n) => n + 1);
                setShowTapToFlipHint(true);
            }
            return;
        }

        if (release.kind === "tap") {
            setDragPosition({ x: 0, y: 0 });
            // Inside the flip lock a tap is swallowed: a shake would remount the card
            // (key=`front-${shakeNonce}`) and cut the flip short.
            if (g.inFlipLock) return;
            // Tap on an already-flipped card: shake it and show the ← Incorrect /
            // Correct → hint labels.
            setShakeNonce((n) => n + 1);
            setShowSwipeHint(true);
        } else if (release.kind === "dismiss") {
            // Fly out from the real lift-off point (the rendered dragPosition can be a
            // frame or more behind the finger). The parent resets it after the fly-out.
            setDragPosition({
                x: (g.last.x - g.start.x) * CARD_DRAG_SENSITIVITY,
                y: (g.last.y - g.start.y) * CARD_DRAG_SENSITIVITY,
            });
            if (liveRef.current.isAnimating) {
                pendingDismissRef.current = release.direction;
                return;
            }
            setShowSwipeHint(false);
            liveRef.current.onDismiss(release.direction);
        } else {
            setDragPosition({ x: 0, y: 0 });
        }
    };

    // ── Touch ──────────────────────────────────────────────────────────────────────────
    // Only touchstart is a React handler. move/end/cancel are DOCUMENT listeners bound for
    // the life of the press: they can't go stale with a render, they survive the card's
    // element being remounted or re-slotted, and touchmove is non-passive so
    // preventDefault() actually stops a scroll.
    const handleTouchStart = (e: React.TouchEvent) => {
        const touch = e.changedTouches[0];
        if (!touch) return;
        if (!begin(touch.clientX, touch.clientY, e.timeStamp, touch.identifier)) return;
        const id = touch.identifier;
        const find = (list: TouchList) => {
            for (let i = 0; i < list.length; i++) if (list[i].identifier === id) return list[i];
            return null;
        };
        const onMove = (ev: TouchEvent) => {
            const tp = find(ev.touches);
            if (!tp) return;
            if (ev.cancelable) ev.preventDefault();
            move(tp.clientX, tp.clientY, ev.timeStamp);
        };
        const onEnd = (ev: TouchEvent) => {
            const tp = find(ev.changedTouches);
            if (!tp) return;
            // Stop the browser from firing synthetic mouse events (mousedown/click) after
            // this touch, which would double-flip. Non-cancelable when the touch became a
            // scroll — then there are no synthetic events to suppress.
            if (ev.cancelable) ev.preventDefault();
            end(tp.clientX, tp.clientY, ev.timeStamp);
        };
        const onCancel = (ev: TouchEvent) => {
            if (!find(ev.changedTouches)) return;
            // The OS took the touch (a system gesture, an alert): no verdict, card home.
            abandonGesture();
            setDragPosition({ x: 0, y: 0 });
        };
        const opts = { passive: false } as AddEventListenerOptions;
        document.addEventListener('touchmove', onMove, opts);
        document.addEventListener('touchend', onEnd, opts);
        document.addEventListener('touchcancel', onCancel);
        detachRef.current = () => {
            document.removeEventListener('touchmove', onMove, opts);
            document.removeEventListener('touchend', onEnd, opts);
            document.removeEventListener('touchcancel', onCancel);
        };
    };

    // The release is handled by the document listener above; this only keeps the
    // synthetic-mouse suppression for a touch whose start was refused (e.g. mid-fly-out).
    const handleTouchEnd = (e: React.TouchEvent) => {
        if (e.cancelable) e.preventDefault();
    };

    // ── Mouse (desktop) ────────────────────────────────────────────────────────────────
    // Same press model; move/up are document listeners so a fast drag can't outrun the
    // card and lose the gesture.
    const handleMouseDown = (e: React.MouseEvent) => {
        if (e.button !== 0) return;
        if (!begin(e.clientX, e.clientY, e.timeStamp, null)) return;
        const onMove = (ev: MouseEvent) => move(ev.clientX, ev.clientY, ev.timeStamp);
        const onUp = (ev: MouseEvent) => end(ev.clientX, ev.clientY, ev.timeStamp);
        document.addEventListener('mousemove', onMove);
        document.addEventListener('mouseup', onUp);
        detachRef.current = () => {
            document.removeEventListener('mousemove', onMove);
            document.removeEventListener('mouseup', onUp);
        };
    };

    const resetDragPosition = useCallback(() => setDragPosition({ x: 0, y: 0 }), []);

    return {
        cardRef,
        dragPosition,
        isDragging,
        isFlipped,
        setIsFlipped,
        resetCard,
        restoreFlipped,
        hasFlippedCurrentCard,
        showSwipeHint,
        showTapToFlipHint,
        shakeNonce,
        resetDragPosition,
        handlers: {
            onTouchStart: handleTouchStart,
            onTouchEnd: handleTouchEnd,
            onMouseDown: handleMouseDown,
        },
    };
}
