import { useEffect, useSyncExternalStore } from "react";

/**
 * studySurface — lets a page that is NOT a study route earn minute points while it is
 * hosting a study surface (docs/MINUTE_POINTS_SYSTEM.md § "Study surfaces on other routes").
 *
 * LAYER: shared client state (src/minutePoints). Eligibility is otherwise decided by the
 * route alone (`./eligibility`): a page earns because its PATH is on a list. The Deck
 * Tower breaks that rule on purpose — its flp session mounts inside `/deck-tower`, over
 * the tower scene, without a route change (docs/DECK_TOWER.md § "Studying the tower"),
 * and `/deck-tower` itself must not earn (it is a menu: you pick a deck there). So the
 * page CLAIMS the surface while the session is up, and `useMinutePoints` treats a claimed
 * surface exactly like an eligible path: interaction starts the clock, the usual idle
 * timeout stops it, and releasing the claim saves and deactivates as leaving a study
 * route does.
 *
 * A counter rather than a flag, so two claimants (or a StrictMode double-mount) cannot
 * release each other's claim.
 *
 * Depended on by: src/minutePoints/useMinutePoints.ts (reads it);
 * src/features/deckTower/useTowerStudy.ts (claims it).
 */

let claims = 0;
const listeners = new Set<() => void>();

function emit(): void {
    for (const listener of listeners) listener();
}

function subscribe(listener: () => void): () => void {
    listeners.add(listener);
    return () => {
        listeners.delete(listener);
    };
}

/** Whether any page is hosting a study surface right now. */
export function useIsStudySurfaceClaimed(): boolean {
    return useSyncExternalStore(subscribe, () => claims > 0, () => false);
}

/** Claim the study surface while `active` is true (released on false or unmount). */
export function useClaimStudySurface(active: boolean): void {
    useEffect(() => {
        if (!active) return;
        claims += 1;
        emit();
        return () => {
            claims -= 1;
            emit();
        };
    }, [active]);
}
