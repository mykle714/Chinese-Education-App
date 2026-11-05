import { useCallback, useEffect, useRef, useState } from "react";
import { prefersReducedMotion } from "./iso";

/**
 * useLightningFlashes — the storm's lightning clock (docs/DECK_TOWER.md § "Weather" →
 * "Lightning strikes").
 *
 * Layer: page hook (feature module `src/features/deckTower`). It used to live inside
 * WeatherLayer, which only DREW the flash. It moved up to the page because a flash is now
 * also a chance of a STRIKE on the platform (in the scene, not the sky). One clock serves
 * both the sky flash and the strike roll, so a strike always lands on a flash.
 *
 * - While `enabled` (the weather has lightning), a flash fires every `FLASH_GAP_MS` ± jitter.
 *   No flash fires while the tab is hidden.
 * - `fire()` fires one now, whatever the weather (the feature-tester Strike chips).
 * - `flashId` bumps per flash. WeatherLayer keys its flash overlay on it.
 * - `onFlash` is called per scheduled flash (not per `fire()`; the caller of `fire` already
 *   knows). It is read through a ref, so a new inline callback never restarts the clock.
 * - `prefers-reduced-motion`: no scheduled flashes (as before the move).
 *
 * Depends on: iso/skyTraffic.ts (`prefersReducedMotion`).
 * Depended on by: DeckTowerPage.tsx (→ SpaceBackdrop → WeatherLayer `flashId`).
 */

/** Mean gap between lightning flashes, and its ± jitter fraction. */
const FLASH_GAP_MS = 11_000;
const FLASH_JITTER = 0.45;

export function useLightningFlashes(enabled: boolean, onFlash?: () => void): { flashId: number; fire: () => void } {
    const [flashId, setFlashId] = useState(0);
    const onFlashRef = useRef(onFlash);
    onFlashRef.current = onFlash;
    const reducedMotion = prefersReducedMotion();

    useEffect(() => {
        if (!enabled || reducedMotion) return;
        let timer = 0;
        const schedule = () => {
            timer = window.setTimeout(() => {
                if (document.visibilityState === "visible") {
                    setFlashId((n) => n + 1);
                    onFlashRef.current?.();
                }
                schedule();
            }, FLASH_GAP_MS * (1 - FLASH_JITTER + Math.random() * 2 * FLASH_JITTER));
        };
        schedule();
        return () => window.clearTimeout(timer);
    }, [enabled, reducedMotion]);

    const fire = useCallback(() => setFlashId((n) => n + 1), []);
    return { flashId, fire };
}
