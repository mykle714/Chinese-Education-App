import { useRef, type PointerEvent as ReactPointerEvent } from "react";

/**
 * useScrollSafeTap — tap handlers for a button that must work WHILE its page is still
 * coasting from a fling (a "back to top" arrow).
 *
 * WHY: on iOS (and Chrome Android) a tap that lands while a scroller is in momentum is
 * spent on STOPPING the scroll — `pointerdown`/`pointerup` fire, but the `click` never
 * does. A button wired to `onClick` therefore looks dead mid-scroll: the first tap only
 * brakes the page and a second tap is needed. The up arrow on td's cards page sits INSIDE
 * the scroller (its sticky title row), so it hit this on every flick-then-tap.
 *
 * HOW: a touch/pen press fires on `pointerup` instead — provided the pointer travelled less
 * than `TAP_SLOP_PX` (a drag that starts on the button is a scroll, not a tap; a press the
 * browser hands to scrolling arrives as `pointercancel` and never reaches `pointerup`).
 * The `click` that follows a normal (non-momentum) tap is then swallowed so the action
 * runs once. Mouse and keyboard still go through `click` untouched.
 *
 * ⚠️ OPT-IN, not a default for every button: firing on `pointerup` means the browser's
 * own `click` comes AFTER the action, so an action that renders something under the finger
 * (a sheet, a popover) could have that trailing click land on the new element. Use it for
 * scroll actions, whose result is never a new tap target.
 *
 * Layer: shared hook. Depended on by: src/components/PageHeader.tsx → `HeaderIconButton`,
 * `HeaderActionChip` (their `scrollSafeTap` prop), used by
 * src/features/deckTower/TowerCardsPage.tsx (the cards page's up arrow) and
 * src/features/flashcards/writingNotebook/WritingNotebookPage.tsx (back to top).
 * Docs: docs/DECK_TOWER.md § "The cards page"; docs/UX_AND_NAVIGATION.md (touch & scroll).
 */

/** How far a touch may travel between down and up and still count as a tap, px. */
const TAP_SLOP_PX = 10;
/** How long after a pointerup-fired tap its trailing `click` is swallowed, ms. */
const CLICK_SWALLOW_MS = 600;

export interface ScrollSafeTapHandlers {
    onPointerDown: (e: ReactPointerEvent) => void;
    onPointerUp: (e: ReactPointerEvent) => void;
    onPointerCancel: () => void;
    onClick: () => void;
}

export function useScrollSafeTap(onTap: (() => void) | undefined): ScrollSafeTapHandlers {
    // Latest-ref: the handlers read `onTap` at event time, so a re-render mid-press is safe.
    const onTapRef = useRef(onTap);
    onTapRef.current = onTap;
    /** Where the current touch/pen press went down, or null when none is in progress. */
    const pressStart = useRef<{ x: number; y: number } | null>(null);
    /** When a pointerup last fired the tap — its trailing `click` must not fire it again. */
    const firedAt = useRef(0);

    return {
        onPointerDown: (e) => {
            // Mouse keeps the ordinary click path (no momentum to beat).
            pressStart.current = e.pointerType === "mouse" ? null : { x: e.clientX, y: e.clientY };
        },
        onPointerUp: (e) => {
            const start = pressStart.current;
            pressStart.current = null;
            if (!start) return;
            if (Math.hypot(e.clientX - start.x, e.clientY - start.y) > TAP_SLOP_PX) return;
            firedAt.current = performance.now();
            onTapRef.current?.();
        },
        // The browser took the press for scrolling: not a tap.
        onPointerCancel: () => {
            pressStart.current = null;
        },
        onClick: () => {
            // The trailing click of a tap pointerup already handled (when the browser sends one).
            if (performance.now() - firedAt.current < CLICK_SWALLOW_MS) {
                firedAt.current = 0;
                return;
            }
            onTapRef.current?.();
        },
    };
}
