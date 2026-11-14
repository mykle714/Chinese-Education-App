import { useEffect, useRef } from "react";

/**
 * useJustChanged — true ONLY for the render in which `value` differs from the value of the
 * last committed render; false on mount and on every render after.
 *
 * Why: the Deck Tower's feature-tester toggles must show their effect at once, but the same
 * prop (e.g. SpaceBackdrop `snapSky`) must NOT stay on, or real changes (weather arriving,
 * the clock moving through a twilight) would stop fading too. SpaceBackdrop reads `snapSky`
 * in the very commit the new sky colour lands in, so a one-render flag is exactly enough.
 *
 * The ref catches up in an effect (after commit), not during render, so a render React
 * throws away (StrictMode, an interrupted render) cannot consume the change.
 *
 * Layer: page logic (feature module `src/features/deckTower`).
 * Depended on by: DeckTowerPage.tsx (`testerSkyTap`). Docs: docs/DECK_TOWER.md § "Feature-tester rows".
 */
export function useJustChanged<T>(value: T): boolean {
    const committed = useRef(value);
    useEffect(() => {
        committed.current = value;
    }, [value]);
    return !Object.is(committed.current, value);
}
