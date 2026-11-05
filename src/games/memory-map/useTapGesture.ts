import { useCallback, useRef } from "react";
import type React from "react";

/**
 * How far a finger may travel between press and release and still count as a tap
 * rather than a slide, in SCREEN pixels — a thumb's wobble, which is the same at any
 * fit zoom.
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
 * Written when the map still panned, to tell a tap from a pan whose touch events the
 * gesture layer owned. The map no longer pans (2026-11-04, § 6), but the rule still
 * earns its place: a finger that slides off a word has not deliberately tapped it, and
 * one that slides across water has not deliberately dismissed the armed word.
 *
 * ── WHY IT LIVES IN ITS OWN FILE ─────────────────────────────────────────────
 * Both ends of the map need the identical rule (a word, and the water around it). Two
 * hand-copied versions would drift, and the one that drifted would silently start
 * eating taps.
 */
export function useTapGesture(
    onTap: (event: React.PointerEvent) => void
): Pick<React.DOMAttributes<HTMLElement>, "onPointerDown" | "onPointerUp" | "onPointerCancel"> {
    // Where the finger went down, so a release can tell a tap from a slide.
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
            if (moved > TAP_SLOP_PX) return; // that was a slide, not a tap
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
