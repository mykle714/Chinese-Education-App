import { useEffect } from "react";

/**
 * Suppress the mobile browser's edge-swipe navigation gesture (swipe from the
 * very left/right screen edge to go back/forward) while `active` is true.
 *
 * Why this is needed: a CSS `touch-action: none` on the game stage stops the
 * page from scrolling/panning, but it does NOT stop the browser/OS history-
 * navigation gesture — that gesture is claimed by the browser before the touch
 * ever reaches the element. The only reliable cross-browser way to cancel it is
 * to register a *non-passive* `touchmove` listener and `preventDefault()` any
 * gesture whose first touch landed within a few pixels of a screen edge.
 *
 * We track the start X in `touchstart` (passive — we never cancel the start)
 * and only cancel subsequent `touchmove`s for edge-originating, predominantly
 * horizontal drags, so normal in-bounds dragging/tapping is untouched.
 *
 * @param active     Whether the block is currently engaged (e.g. only while a
 *                   game is mounted/playing).
 * @param edgePx     How close to an edge the touch must start to be blocked.
 */
export function useBlockEdgeSwipe(active: boolean, edgePx = 30): void {
    useEffect(() => {
        if (!active) return;

        // X of the active touch's starting point; null when it didn't start in
        // an edge zone (so we never interfere with it).
        let edgeStartX: number | null = null;
        let startY = 0;

        const onTouchStart = (e: TouchEvent) => {
            if (e.touches.length !== 1) {
                edgeStartX = null;
                return;
            }
            const { clientX, clientY } = e.touches[0];
            const nearEdge = clientX <= edgePx || clientX >= window.innerWidth - edgePx;
            edgeStartX = nearEdge ? clientX : null;
            startY = clientY;
        };

        const onTouchMove = (e: TouchEvent) => {
            if (edgeStartX === null || e.touches.length !== 1) return;
            const { clientX, clientY } = e.touches[0];
            // Only cancel predominantly-horizontal drags so a vertical scroll
            // that happens to begin near an edge still behaves normally.
            if (Math.abs(clientX - edgeStartX) > Math.abs(clientY - startY)) {
                e.preventDefault();
            }
        };

        const onTouchEnd = () => {
            edgeStartX = null;
        };

        // touchmove must be non-passive for preventDefault() to take effect.
        document.addEventListener("touchstart", onTouchStart, { passive: true });
        document.addEventListener("touchmove", onTouchMove, { passive: false });
        document.addEventListener("touchend", onTouchEnd, { passive: true });
        document.addEventListener("touchcancel", onTouchEnd, { passive: true });
        return () => {
            document.removeEventListener("touchstart", onTouchStart);
            document.removeEventListener("touchmove", onTouchMove);
            document.removeEventListener("touchend", onTouchEnd);
            document.removeEventListener("touchcancel", onTouchEnd);
        };
    }, [active, edgePx]);
}
