import { useEffect } from "react";

/**
 * Suppress browser zoom (pinch-zoom and double-tap-zoom) app-wide while
 * `active` is true. Intended to be mounted once at the App root.
 *
 * Why JS is needed on top of the viewport meta: the `maximum-scale=1,
 * user-scalable=no` viewport tag in index.html kills zoom on Android/Chrome/
 * Firefox, but **iOS Safari deliberately ignores `user-scalable=no`** for
 * accessibility. The only reliable way to stop page-level zoom on iOS is to
 * cancel the gesture at the touch-event layer:
 *
 *   - `gesturestart`/`gesturechange`/`gestureend` — Safari-only events fired for
 *     a two-finger pinch on the *page* (these fire even when the two fingers land
 *     on different elements, which per-element `touch-action: none` does not
 *     cover). Cancelling `gesturestart` blocks the pinch-zoom outright.
 *   - multi-touch `touchmove` — a non-passive fallback that cancels any 2+ finger
 *     move, covering browsers/versions that don't emit gesture events.
 *   - double-tap zoom — cancelled by preventing the second of two taps within
 *     ~300ms, BUT ONLY when that tap lands on non-interactive content. Preventing a
 *     `touchend` also cancels the synthetic `click`, so suppressing it over a control
 *     would swallow rapid button/menu taps (undo/redo spam, snap toggles, …); controls
 *     already block double-tap zoom via their own `touch-action`. See `isInteractiveTarget`.
 *
 * This complements (does not replace) the per-surface `touch-action: none`/
 * `pan-y` already used across the app — those handle single-element gestures;
 * this handles the page-level holes (iOS pinch, default-`auto` backgrounds).
 * Mirrors the architecture of `useBlockEdgeSwipe`.
 *
 * @param active Whether zoom-blocking is engaged (default true).
 */
export function useBlockZoom(active = true): void {
    useEffect(() => {
        if (!active) return;

        // --- iOS Safari page-level pinch (gesture* events) ---
        const onGesture = (e: Event) => {
            e.preventDefault();
        };

        // --- Cross-browser fallback: cancel any multi-touch move (pinch) ---
        const onTouchMove = (e: TouchEvent) => {
            if (e.touches.length > 1) {
                e.preventDefault();
            }
        };

        // --- Does this tap target activate a control? ---
        // Calling preventDefault() on `touchend` blocks double-tap zoom BUT ALSO cancels the
        // synthetic `click` the browser would fire next. So we must NOT suppress a tap that
        // lands on an interactive control — otherwise rapid taps on any button / menu row
        // (undo/redo spam, snap toggles, contrast modes, shift-pad nudges, …) lose their second
        // click. On controls, double-tap zoom is already prevented by their `touch-action`
        // (and the viewport tag), so there is nothing to block there — only a click to preserve.
        // Detection: native controls + ARIA roles + `[tabindex]`, plus a `cursor: pointer`
        // fallback that catches the app's `<Box onClick>` rows (cursor inherits to children, so
        // a tap anywhere inside such a row computes `pointer`).
        const isInteractiveTarget = (el: Element | null): boolean => {
            if (!el) return false;
            if (
                el.closest(
                    'button, a[href], input, textarea, select, label, summary, ' +
                    '[role="button"], [role="menuitem"], [role="tab"], [role="switch"], [role="checkbox"], [tabindex]',
                )
            ) {
                return true;
            }
            return window.getComputedStyle(el).cursor === "pointer";
        };

        // --- Double-tap zoom: block the 2nd quick tap in the same spot ---
        let lastTouchEnd = 0;
        const onTouchEnd = (e: TouchEvent) => {
            const now = Date.now();
            if (now - lastTouchEnd <= 300 && !isInteractiveTarget(e.target as Element | null)) {
                // Second tap within the double-tap window AND on non-interactive content
                // (text/background) — suppress its zoom. Interactive targets are left alone so
                // their click still fires (see isInteractiveTarget).
                e.preventDefault();
            }
            lastTouchEnd = now;
        };

        // gesture* + touchmove must be non-passive for preventDefault() to work.
        document.addEventListener("gesturestart", onGesture, { passive: false });
        document.addEventListener("gesturechange", onGesture, { passive: false });
        document.addEventListener("gestureend", onGesture, { passive: false });
        document.addEventListener("touchmove", onTouchMove, { passive: false });
        document.addEventListener("touchend", onTouchEnd, { passive: false });
        return () => {
            document.removeEventListener("gesturestart", onGesture);
            document.removeEventListener("gesturechange", onGesture);
            document.removeEventListener("gestureend", onGesture);
            document.removeEventListener("touchmove", onTouchMove);
            document.removeEventListener("touchend", onTouchEnd);
        };
    }, [active]);
}
