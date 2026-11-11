import { useEffect, useRef } from "react";

/**
 * useHomePull — the pull past the top of the deck that goes back up to the home screen
 * (docs/HOME_SCREEN.md § "Back to home").
 *
 * THE RULE: momentum STOPS at the top of the deck, and only ANOTHER swipe goes home. A fling
 * up the tower that coasts into the top just stops there (the scroll's own edge; the browser's
 * rubber band on iOS); it never goes home, however fast it was. So a pull counts only when the
 * gesture STARTED with the scroller already at the top:
 *
 *   touch  A touch that STARTS at the top (`scrollTop` ≤ `TOP_EPS_PX`) and drags the finger
 *          down (= scrolling further up) is a pull. On RELEASE it goes home if the finger
 *          travelled `PULL_PX`, or `FLICK_MIN_PX` at `FLICK_SPEED` (the world swipe's
 *          commit-on-release). A shorter pull just springs back (the native rubber band). A
 *          touch that started lower down — including one that drove a fling into the top —
 *          is never armed.
 *   wheel  Wheels and trackpads have no "release", and a trackpad's momentum arrives as a
 *          continuous stream of wheel events. A STREAM is the run of events with no gap of
 *          `WHEEL_GAP_MS`. A stream that STARTS at the top and scrolls up `WHEEL_PULL_PX`
 *          goes home at once. The tail of a stream that began lower down (momentum coasting
 *          into the top) is never armed, so it stops at the top; the next stream does it.
 *
 * Listeners are passive and read only; the page decides (`enabled`) when a pull may count.
 *
 * The same gesture, read the other way, is the home screen's way IN (`useEnterSwipe`: a swipe
 * that scrolls down toward the tower). Both run on `usePullGesture`.
 *
 * Layer: feature page logic (src/features/deckTower/home). Depended on by DeckTowerPage.tsx
 * (`useHomePull`) and HomeStage.tsx (`useEnterSwipe`). Docs: docs/HOME_SCREEN.md.
 */

/** Within this many px of scrollTop 0 is "at the top" (iOS can report a fraction, or a bounce < 0). */
const TOP_EPS_PX = 2;
/** Finger travel that commits a pull on release, px. */
const PULL_PX = 80;
/** A flick commits a shorter pull: at least this far, px … */
const FLICK_MIN_PX = 28;
/** … moving at least this fast at release, px/ms. */
const FLICK_SPEED = 0.6;
/** Only the last stretch of a drag sets its release speed, ms. */
const FLICK_WINDOW_MS = 100;
/** A quiet gap this long ends a wheel stream, ms. */
const WHEEL_GAP_MS = 240;
/** Upward wheel travel within a top-started stream that goes home, px. */
const WHEEL_PULL_PX = 120;
/** px per wheel line, for `deltaMode` 1 (Firefox's line-mode wheels). */
const WHEEL_LINE_PX = 16;

/**
 * A committed pull's motion at release, along the counting way (both ≥ 0). A wheel stream has
 * no release: it reports its travel and no speed.
 */
export interface PullRelease {
    /** How far the finger (or wheel) travelled, px. */
    travel: number;
    /** The finger's speed over the last `FLICK_WINDOW_MS`, px/ms. */
    speed: number;
}

interface UsePullGestureArgs {
    /** The element the gesture is read on. */
    targetRef: React.RefObject<HTMLElement | null>;
    /**
     * The way the FINGER travels: "down" = dragging the content down (scrolling up, wheel
     * deltaY < 0); "up" = dragging it up (scrolling down, wheel deltaY > 0).
     */
    finger: "down" | "up";
    /** Whether a pull may count right now (read at the gesture's start and again at release). */
    enabled: boolean;
    /** An extra arming condition read at the start and at release (the pull home: scroller at its top). */
    canArm?: () => boolean;
    onPull: (release: PullRelease) => void;
}

/**
 * The shared gesture under both home moves: a one-finger drag that commits on RELEASE past
 * `PULL_PX` (or a `FLICK_MIN_PX` flick at `FLICK_SPEED`), and a wheel stream that commits
 * after `WHEEL_PULL_PX` — each only if it STARTED armed. Used by `useHomePull` (td → home)
 * and `useEnterSwipe` (home → td). Passive, read-only listeners.
 */
export function usePullGesture({ targetRef, finger, enabled, canArm, onPull }: UsePullGestureArgs): void {
    // Read through refs: the listeners are attached once with the element.
    const enabledRef = useRef(enabled);
    enabledRef.current = enabled;
    const canArmRef = useRef(canArm);
    canArmRef.current = canArm;
    const onPullRef = useRef(onPull);
    onPullRef.current = onPull;

    useEffect(() => {
        const el = targetRef.current;
        if (!el) return;
        const armable = () => enabledRef.current && (canArmRef.current?.() ?? true);
        // +1 when the finger moves the way that counts.
        const sign = finger === "down" ? 1 : -1;

        // ── Touch ──
        let armed = false;
        let startY = 0;
        let samples: { t: number; y: number }[] = [];
        const onTouchStart = (e: TouchEvent) => {
            // A second finger cancels: a pinch is not a pull.
            armed = e.touches.length === 1 && armable();
            if (!armed) return;
            startY = e.touches[0].clientY;
            samples = [{ t: performance.now(), y: startY }];
        };
        const onTouchMove = (e: TouchEvent) => {
            if (!armed) return;
            if (e.touches.length !== 1) {
                armed = false;
                return;
            }
            const now = performance.now();
            samples.push({ t: now, y: e.touches[0].clientY });
            while (samples.length > 2 && now - samples[0].t > FLICK_WINDOW_MS) samples.shift();
        };
        const onTouchEnd = () => {
            if (!armed) return;
            armed = false;
            const last = samples[samples.length - 1];
            const first = samples[0];
            if (!last || !armable()) return;
            const pulled = sign * (last.y - startY);
            // A drag that went the other way first and came back is not a pull.
            if (pulled <= 0) return;
            const speed = last.t > first.t ? (sign * (last.y - first.y)) / (last.t - first.t) : 0;
            if (pulled >= PULL_PX || (pulled >= FLICK_MIN_PX && speed >= FLICK_SPEED)) onPullRef.current({ travel: pulled, speed: Math.max(0, speed) });
        };
        const onTouchCancel = () => {
            armed = false;
        };

        // ── Wheel / trackpad ──
        let lastWheelAt = -Infinity;
        let streamArmed = false;
        let streamTravel = 0;
        const onWheel = (e: WheelEvent) => {
            const now = performance.now();
            if (now - lastWheelAt > WHEEL_GAP_MS) {
                // A new stream: it counts only if it starts armed.
                streamArmed = armable();
                streamTravel = 0;
            }
            lastWheelAt = now;
            if (!streamArmed) return;
            // Finger down = scrolling up = wheel deltaY < 0, so the counting way is −sign·deltaY.
            const travel = -sign * (e.deltaMode === 1 ? e.deltaY * WHEEL_LINE_PX : e.deltaY);
            // Any scroll the other way disarms the stream.
            if (travel < 0) {
                streamArmed = false;
                return;
            }
            streamTravel += travel;
            if (streamTravel >= WHEEL_PULL_PX && enabledRef.current) {
                streamArmed = false;
                onPullRef.current({ travel: streamTravel, speed: 0 });
            }
        };

        el.addEventListener("touchstart", onTouchStart, { passive: true });
        el.addEventListener("touchmove", onTouchMove, { passive: true });
        el.addEventListener("touchend", onTouchEnd, { passive: true });
        el.addEventListener("touchcancel", onTouchCancel, { passive: true });
        el.addEventListener("wheel", onWheel, { passive: true });
        return () => {
            el.removeEventListener("touchstart", onTouchStart);
            el.removeEventListener("touchmove", onTouchMove);
            el.removeEventListener("touchend", onTouchEnd);
            el.removeEventListener("touchcancel", onTouchCancel);
            el.removeEventListener("wheel", onWheel);
        };
        // The element mounts once with its owner.
    }, [targetRef, finger]);
}

interface UseHomePullArgs {
    scrollerRef: React.RefObject<HTMLDivElement | null>;
    /** Whether a pull may count right now (td fully in charge, nothing else moving the camera). */
    enabled: boolean;
    /** Called on the commit, from the release's own event (before the rubber band springs back). */
    onPull: (release: PullRelease) => void;
}

/** td → home: a finger-down pull that STARTED with td's scroller at its top (see the rule above). */
export function useHomePull({ scrollerRef, enabled, onPull }: UseHomePullArgs): void {
    usePullGesture({
        targetRef: scrollerRef,
        finger: "down",
        enabled,
        canArm: () => {
            const el = scrollerRef.current;
            return el !== null && el.scrollTop <= TOP_EPS_PX;
        },
        onPull,
    });
}

interface UseEnterSwipeArgs {
    /** The home stage's root. */
    stageRef: React.RefObject<HTMLDivElement | null>;
    /** Whether a swipe may count (the stage is at rest — not mid-shift). */
    enabled: boolean;
    onEnter: () => void;
}

/**
 * home → td (docs/HOME_SCREEN.md § "Enter"): a swipe anywhere on the home stage that scrolls
 * DOWN toward the tower — the finger travels UP, the wheel scrolls down — with the same
 * release thresholds as the pull home. The mirror of `useHomePull`: the home stands above the
 * tower, so the two gestures are one scroll axis read both ways.
 */
export function useEnterSwipe({ stageRef, enabled, onEnter }: UseEnterSwipeArgs): void {
    usePullGesture({ targetRef: stageRef, finger: "up", enabled, onPull: () => onEnter() });
}
