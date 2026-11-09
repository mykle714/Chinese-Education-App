import { useEffect, useLayoutEffect, useRef, type MutableRefObject, type RefObject } from "react";

/**
 * useTabSwipeTrack — swipe-to-change-tab for a sheet whose tab panes sit side by side
 * on a permanent (N·100%)-wide TRACK inside a clipping viewport (the CLIP).
 *
 * Shared by the eip (InfoCardPanelBody) and the Account panel (AccountSheet), so a
 * sideways swipe behaves identically in both.
 *
 * Changing tabs — by tap or by swipe — never mounts, unmounts, restyles or resizes
 * anything. It only moves the track's transform:
 *
 *   · Tap: purely declarative. The host's `selectedTab` changes → its sx transform
 *     (`restingTabTransform`) changes → the track's persistent CSS transition
 *     (TAB_SWIPE_TRANSITION) animates it. No JS animation lifecycle at all.
 *   · Finger drag: the raw listeners below override transform/transition via INLINE
 *     styles only (no React state per touchmove), then hand control back to the
 *     declarative value on release.
 *
 * Deliberately NOT a state machine. Earlier designs mounted a temporary two-pane track
 * per slide and tore it down on transitionend; a dropped touch sequence (native-scroll
 * intervention) or a missed transitionend left the panel visibly frozen mid-slide.
 * Inline overrides that are cleared on release, on the next tab render, AND on the next
 * touchstart cannot wedge that way — the resting position always belongs to plain CSS.
 *
 * THE HOST must render the track with `transform: restingTabTransform(selectedTab,
 * tabCount)` and `transition: TAB_SWIPE_TRANSITION`, and give the clip (and the sheet
 * body around it) `touchAction: "pan-y"` or looser so vertical scroll stays native.
 *
 * LAYER: shared presentational hook (src/components/sheet). No data, no server calls.
 *
 * Depended on by: src/features/flashcards/FlashcardsLearnPage/InfoCardPanelBody.tsx,
 * src/pages/AccountSheet.tsx. Docs: docs/EIP_SHEET_GESTURES.md (§ tab swipe).
 */

// Cumulative touch movement before the gesture commits to horizontal (tab swipe) vs
// vertical (sheet resize/scroll). Below this slop, moves are held back from both so tiny
// wobbles don't glitch either gesture.
export const TAB_SWIPE_AXIS_LOCK_PX = 8;
// Fraction of the pane's width a swipe must travel before release advances the tab
// instead of snapping back.
export const TAB_SWIPE_COMMIT_RATIO = 0.22;
// Rubber-band at the ends of the strip. Swiping left on the LAST tab or right on the
// FIRST used to clamp the track to exactly zero travel, which is visually identical to
// "this tab has no swipe" — the gesture looked broken rather than bounded. The track now
// follows the finger at EDGE_RUBBER_RATIO of its travel, capped at EDGE_RUBBER_MAX_PX,
// and springs back on release (settleDrag can never commit past an end). The cap stays
// well under paneWidth · TAB_SWIPE_COMMIT_RATIO so an overscroll can never read as a
// committed swipe.
export const TAB_SWIPE_EDGE_RUBBER_RATIO = 0.25;
export const TAB_SWIPE_EDGE_RUBBER_MAX_PX = 40;

/**
 * Resting track offset for a tab: the track is (N·100%) wide with N equal panes, so
 * showing tab k means shifting it left by exactly k panes, i.e. k·(100/N)% of its own width.
 */
export const restingTabTransform = (tab: number, tabCount: number) =>
    `translateX(${(-tab * 100) / tabCount}%)`;

interface UseTabSwipeTrackOptions {
    /** The clipping viewport. The gesture listeners attach here. */
    clipRef: RefObject<HTMLElement | null>;
    /** The sliding track inside the clip. */
    trackRef: RefObject<HTMLElement | null>;
    tabCount: number;
    selectedTab: number;
    onTabChange: (tab: number) => void;
    /** Called on every touchstart in the clip, before anything else (the eip warms its
     *  deferred off-screen panes here, so a swipe finds its neighbour drawn). */
    onGestureStart?: () => void;
    /** While true, a tab change must NOT clear the track's inline styles — the host has
     *  pinned the track itself this frame (the eip's silent entry-change jump). */
    pinnedRef?: MutableRefObject<boolean>;
}

interface TabSwipeTrack {
    /** Mirror of `selectedTab`, readable outside the render cycle. */
    selectedTabRef: MutableRefObject<number>;
    /** Live finger delta of an in-flight horizontal drag; null = no finger on the track.
     *  Hosts that write the track's inline styles themselves must leave it alone while
     *  this is non-null. */
    dragDxRef: MutableRefObject<number | null>;
}

export function useTabSwipeTrack({
    clipRef,
    trackRef,
    tabCount,
    selectedTab,
    onTabChange,
    onGestureStart,
    pinnedRef,
}: UseTabSwipeTrackOptions): TabSwipeTrack {
    const selectedTabRef = useRef(selectedTab);
    // Pane width in px (= clip-box width). Feeds only the gesture threshold/clamp math —
    // layout is purely percentage-based, so this never has to be pixel-perfect.
    const paneWidthRef = useRef(0);
    const touchStartRef = useRef<{ x: number; y: number } | null>(null);
    // null = undecided (within the axis-lock slop), "x" = swipe owns the gesture,
    // "y" = handed off untouched to SheetPanel's vertical listener.
    const swipeAxisRef = useRef<"x" | "y" | null>(null);
    // Doubles as the "drag in flight" flag for the self-heal paths.
    const dragDxRef = useRef<number | null>(null);

    // Latest-value refs, so the mount-once listeners never read a stale closure.
    const onTabChangeRef = useRef(onTabChange);
    onTabChangeRef.current = onTabChange;
    const onGestureStartRef = useRef(onGestureStart);
    onGestureStartRef.current = onGestureStart;
    const tabCountRef = useRef(tabCount);
    tabCountRef.current = tabCount;

    useLayoutEffect(() => {
        const el = clipRef.current;
        if (!el) return;
        const update = () => { paneWidthRef.current = el.clientWidth; };
        update();
        const ro = new ResizeObserver(update);
        ro.observe(el);
        return () => ro.disconnect();
        // eslint-disable-next-line react-hooks/exhaustive-deps
    }, []);

    // Keep selectedTabRef in sync, and clear any inline transform/transition a drag left
    // behind once the declarative resting transform owns the position again. On a
    // committed swipe the inline transform was already set to this tab's resting value,
    // so removing it here is visually a no-op and the in-flight CSS transition continues
    // undisturbed. Also a self-heal: even if a drag's release was swallowed entirely, the
    // next tab change re-normalizes the track.
    useEffect(() => {
        selectedTabRef.current = selectedTab;
        const track = trackRef.current;
        if (track && dragDxRef.current === null && !pinnedRef?.current) {
            track.style.transition = "";
            track.style.transform = "";
        }
        // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [selectedTab]);

    // Gesture listeners are raw `addEventListener`s (not React onTouch* JSX props)
    // attached directly to the clip box, mirroring SheetPanel's own pattern. This is
    // required, not stylistic: SheetPanel's resize/scroll listener is itself a raw
    // addEventListener on an ANCESTOR. Native touch events reach that ancestor's raw
    // listener DURING REAL DOM BUBBLING — which completes before React ever dispatches a
    // synthetic onTouchMove (React delegates to one listener at its own root container,
    // higher up). So a React handler's stopPropagation() is always too late to stop
    // SheetPanel's listener. Our own raw listener on the clip (a descendant) runs earlier
    // in the real bubble order, so our stopPropagation() actually works.
    useEffect(() => {
        const el = clipRef.current;
        if (!el) return;

        // Settle an in-flight drag to a resting position: commit the tab change when the
        // finger traveled past the commit threshold, else snap back. Restores the
        // persistent CSS transition first so the remaining travel animates. Called from
        // touchend/touchcancel, and from touchstart if a previous drag's release was
        // swallowed by the browser — so a dropped gesture can freeze the track only until
        // the next touch or tab change.
        const settleDrag = () => {
            const dx = dragDxRef.current;
            dragDxRef.current = null;
            const track = trackRef.current;
            if (track === null || dx === null) return;
            const tab = selectedTabRef.current;
            const count = tabCountRef.current;
            const target = dx < 0 ? tab + 1 : tab - 1;
            const committed =
                target >= 0 &&
                target <= count - 1 &&
                Math.abs(dx) > paneWidthRef.current * TAB_SWIPE_COMMIT_RATIO;
            track.style.transition = ""; // back to the sx transition
            if (committed) {
                // Aim the inline transform at the target immediately so the snap starts
                // this frame; the declarative transform catches up to the SAME value when
                // onTabChange re-renders, and the selectedTab effect above then clears the
                // (now redundant) inline override without disturbing the motion.
                track.style.transform = restingTabTransform(target, count);
                onTabChangeRef.current(target);
            } else {
                // Not committed: drop the override — the computed style falls back to the
                // current tab's resting transform and animates back.
                track.style.transform = "";
            }
        };

        const onTouchStart = (e: TouchEvent) => {
            onGestureStartRef.current?.();
            if (e.touches.length !== 1) return;
            if (dragDxRef.current !== null) settleDrag(); // self-heal a swallowed release
            touchStartRef.current = { x: e.touches[0].clientX, y: e.touches[0].clientY };
            swipeAxisRef.current = null;
        };

        const onTouchMove = (e: TouchEvent) => {
            const start = touchStartRef.current;
            if (!start || e.touches.length !== 1 || !paneWidthRef.current) return;
            const dx = e.touches[0].clientX - start.x;
            const dy = e.touches[0].clientY - start.y;
            if (swipeAxisRef.current === null) {
                if (Math.max(Math.abs(dx), Math.abs(dy)) < TAB_SWIPE_AXIS_LOCK_PX) {
                    // Still ambiguous. Block SheetPanel from seeing this event too, not
                    // just events after the axis is decided — otherwise a few px of
                    // pre-lock vertical noise leaks into SheetPanel's touchmove, which
                    // locks its gesture into "resize" and shrinks the sheet by those few
                    // px. If the gesture then resolves "x", SheetPanel never sees another
                    // move but still gets the touchend, and reads "resize + height a hair
                    // below the default stop" as a drag-down release — DISMISSING the
                    // panel out from under the swipe. Blocking from the very first event
                    // means SheetPanel's gesture mode is never set for a horizontal
                    // gesture. (No preventDefault yet — if this resolves "y", the
                    // browser's native vertical scroll should engage normally.)
                    e.stopPropagation();
                    return;
                }
                // Biased toward horizontal: a straight horizontal swipe very often has a
                // few px of vertical noise at the start (the press-down wobble). A plain
                // dx>dy comparison would misfire "y" and — since the axis stays locked
                // for the rest of the gesture — the swipe would fall through to
                // SheetPanel's resize/scroll. Only lock "y" when vertical movement is
                // clearly (30%+) ahead of horizontal.
                swipeAxisRef.current = Math.abs(dy) > Math.abs(dx) * 1.3 ? "y" : "x";
                if (swipeAxisRef.current === "y") {
                    // Vertical intent: hand off to SheetPanel's resize/scroll listener.
                    // Its lastTouchY is still the touchstart value (every event so far
                    // was blocked), so its next event computes one correct delta covering
                    // the whole gesture — no motion is lost.
                    return;
                }
            }
            if (swipeAxisRef.current !== "x") return;
            // Horizontal intent: keep SheetPanel's vertical listener out of this gesture
            // and stop the browser's own scroll/edge-swipe.
            e.stopPropagation();
            e.preventDefault();
            const track = trackRef.current;
            if (!track) return;
            const tab = selectedTabRef.current;
            const count = tabCountRef.current;
            // Toward a neighbouring tab: clamp the finger delta to at most one pane, so
            // the track can never pass the next resting position. Toward an END of the
            // strip: rubber-band instead (see TAB_SWIPE_EDGE_RUBBER_RATIO).
            const hasNeighbor = dx < 0 ? tab < count - 1 : tab > 0;
            const clampedDx = hasNeighbor
                ? Math.max(-paneWidthRef.current, Math.min(paneWidthRef.current, dx))
                : Math.sign(dx) *
                  Math.min(TAB_SWIPE_EDGE_RUBBER_MAX_PX, Math.abs(dx) * TAB_SWIPE_EDGE_RUBBER_RATIO);
            dragDxRef.current = clampedDx;
            // Drive the drag with inline styles only — no React work per move.
            track.style.transition = "none";
            track.style.transform = `translateX(calc(${(-tab * 100) / count}% + ${clampedDx}px))`;
        };

        const onTouchEnd = () => {
            touchStartRef.current = null;
            swipeAxisRef.current = null;
            if (dragDxRef.current !== null) settleDrag();
        };

        el.addEventListener("touchstart", onTouchStart, { passive: false });
        el.addEventListener("touchmove", onTouchMove, { passive: false });
        el.addEventListener("touchend", onTouchEnd);
        el.addEventListener("touchcancel", onTouchEnd);
        return () => {
            el.removeEventListener("touchstart", onTouchStart);
            el.removeEventListener("touchmove", onTouchMove);
            el.removeEventListener("touchend", onTouchEnd);
            el.removeEventListener("touchcancel", onTouchEnd);
        };
        // eslint-disable-next-line react-hooks/exhaustive-deps
    }, []);

    return { selectedTabRef, dragDxRef };
}
