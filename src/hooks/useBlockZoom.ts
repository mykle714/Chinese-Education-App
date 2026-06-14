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
 *   - double-tap zoom — cancelled by preventing the second of two taps that land
 *     in the same spot within ~300ms.
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

        // --- Double-tap zoom: block the 2nd quick tap in the same spot ---
        let lastTouchEnd = 0;
        const onTouchEnd = (e: TouchEvent) => {
            const now = Date.now();
            if (now - lastTouchEnd <= 300) {
                // Second tap within the double-tap window — suppress its zoom.
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
