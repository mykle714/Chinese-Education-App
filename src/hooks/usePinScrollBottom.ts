import { useLayoutEffect, type RefObject } from "react";
import { scrollParentOf } from "../utils/scrollParent";

/** How long the pin holds when the learner never touches the page. */
const DEFAULT_HOLD_MS = 5000;

/**
 * Scroll the page that holds `contentRef` all the way down, and KEEP it there while
 * the content above is still loading.
 *
 * A one-shot `scrollTop = scrollHeight` is not enough on a page whose sections load
 * asynchronously (the Reading Center's word of the day, card hand and swipe grid all
 * fetch after mount). Each one that grows pushes the foot back down out of view. So
 * the pin re-applies on every resize of the content (ResizeObserver). It lets go as
 * soon as the learner takes over (wheel, touch, pointer down on the scroller), or
 * after `holdMs` either way, so it never fights a deliberate scroll.
 *
 * Runs in a layout effect so the first pin lands before paint, with no visible jump
 * from the top.
 *
 * Used by: MasteryCenterPage (returning from a Reading Center game).
 * Docs: docs/READING_WRITING_CENTERS.md § "Returning from a game".
 */
export function usePinScrollBottom(
    contentRef: RefObject<HTMLElement | null>,
    active: boolean,
    holdMs: number = DEFAULT_HOLD_MS
): void {
    useLayoutEffect(() => {
        const content = contentRef.current;
        if (!active || !content) return;
        const scroller = scrollParentOf(content);
        if (!scroller) return;

        const pin = () => { scroller.scrollTop = scroller.scrollHeight; };
        pin();

        const observer = new ResizeObserver(pin);
        observer.observe(content);

        let released = false;
        const release = () => {
            if (released) return;
            released = true;
            observer.disconnect();
            window.clearTimeout(timer);
            for (const type of RELEASE_EVENTS) scroller.removeEventListener(type, release);
        };
        const timer = window.setTimeout(release, holdMs);
        for (const type of RELEASE_EVENTS) scroller.addEventListener(type, release, { passive: true });
        return release;
    }, [contentRef, active, holdMs]);
}

/** Any of these on the scroller means the learner is driving — stop pinning. */
const RELEASE_EVENTS = ["wheel", "touchstart", "pointerdown", "keydown"] as const;
