import { useCallback, useRef } from "react";
import type React from "react";

/**
 * How far a finger may travel between press and release and still count as a tap
 * rather than a pan, in SCREEN pixels.
 *
 * Screen pixels, not world units, because it models a thumb's wobble — which does not
 * get bigger when the map is zoomed out.
 *
 * One grid cell. That is a coincidence rather than a derivation — a movement threshold
 * is not spacing — but it is a plausible thumb wobble and there is no reason to sit it
 * off the grid, so it is written as the literal 8.
 */
export const TAP_SLOP_PX = 8;

/**
 * "This pointer went down and came back up without really moving" — the map's only
 * definition of a tap (docs/MEMORY_MAP_GAME.md § 3.3).
 *
 * ── WHY THIS IS MEASURED BY HAND AND NOT READ OFF THE GESTURE LAYER ──────────
 * The world's pan is bound through @use-gesture with `pointer: { touch: true }`, so it
 * listens to TOUCH events while these are POINTER handlers. The two never see the same
 * event object and cannot be correlated, so a tap has to be recognised independently.
 *
 * ── WHY IT LIVES IN ITS OWN FILE ─────────────────────────────────────────────
 * Both ends of the map need the identical rule: a word needs it so that a pan which
 * merely CROSSES it is not an answer, and the world needs it so that a pan which ends
 * over open water is not a deselect. Two hand-copied versions would drift, and the one
 * that drifted would silently start eating gestures.
 */
export function useTapGesture(
    onTap: (event: React.PointerEvent) => void
): Pick<React.DOMAttributes<HTMLElement>, "onPointerDown" | "onPointerUp" | "onPointerCancel"> {
    // Where the finger went down, so a release can tell a tap from a pan.
    const pressRef = useRef<{ x: number; y: number } | null>(null);

    const onPointerDown = useCallback((event: React.PointerEvent) => {
        pressRef.current = { x: event.clientX, y: event.clientY };
    }, []);

    const onPointerUp = useCallback(
        (event: React.PointerEvent) => {
            const press = pressRef.current;
            pressRef.current = null;
            if (!press) return;
            const moved = Math.hypot(event.clientX - press.x, event.clientY - press.y);
            if (moved > TAP_SLOP_PX) return; // that was a pan, not a tap
            onTap(event);
        },
        [onTap]
    );

    // A pointer that leaves the element mid-gesture (or is cancelled by the browser)
    // must not leave a stale press behind for the NEXT release to match against, which
    // would make an unrelated release count as a tap.
    const onPointerCancel = useCallback(() => {
        pressRef.current = null;
    }, []);

    return { onPointerDown, onPointerUp, onPointerCancel };
}
