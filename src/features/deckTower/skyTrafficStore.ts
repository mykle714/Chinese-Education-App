import { useState } from "react";
import type { CloudDrift, WindGust } from "./iso";

/**
 * skyTrafficStore — the hand-off between SkyTraffic.tsx's scheduler (`SkyTrafficSource`) and
 * its two drawing layers (`SkyTrafficLayer`): the clouds and gusts currently in the sky,
 * read with `useSyncExternalStore`. Its own module so SkyTraffic.tsx exports only components
 * (react-refresh/only-export-components).
 *
 * Depended on by: SkyTraffic.tsx, DeckTowerPage.tsx. Docs: docs/DECK_TOWER.md § "The scene".
 */

export interface SkyTrafficSnapshot {
    /** Back to front (sortCloudsBackToFront): clouds can overlap each other. */
    clouds: CloudDrift[];
    gusts: WindGust[];
}

export interface SkyTrafficStore {
    get: () => SkyTrafficSnapshot;
    set: (next: SkyTrafficSnapshot) => void;
    subscribe: (listener: () => void) => () => void;
}

const EMPTY: SkyTrafficSnapshot = { clouds: [], gusts: [] };

function createSkyTrafficStore(): SkyTrafficStore {
    let snapshot = EMPTY;
    const listeners = new Set<() => void>();
    return {
        get: () => snapshot,
        set: (next) => {
            snapshot = next;
            listeners.forEach((l) => l());
        },
        subscribe: (listener) => {
            listeners.add(listener);
            return () => listeners.delete(listener);
        },
    };
}

/** One store per page instance, stable for its lifetime. */
export function useSkyTrafficStore(): SkyTrafficStore {
    return useState(createSkyTrafficStore)[0];
}
