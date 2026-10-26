import { useCallback, useState } from "react";

/**
 * studyPlatformStore.ts — the study header's "hide the platform" toggle, kept per device
 * (docs/DECK_TOWER.md § "Studying the tower" → "Hiding the platform"). On, the studied
 * world's whole platform — the tower, the pawns, the plate and the lever — fades out under
 * the session's cards as the camera dives (and back in as it climbs), so the cards float
 * on the bare sky.
 *
 * Layer: page logic (feature module `src/features/deckTower`). localStorage only — a
 * convenience, not a record: a missing, unreadable or blocked store just means the
 * platform shows (the default). One key for the device, not per account or world: it is a
 * viewing preference, like the time-of-day override.
 *
 * Depended on by: DeckTowerPage.tsx (owns the state; useTowerStudy and the flp host read it).
 */

const STORAGE_KEY = "deckTower.studyPlatformHidden";

function readHidden(): boolean {
    try {
        return window.localStorage.getItem(STORAGE_KEY) === "1";
    } catch {
        return false;
    }
}

function writeHidden(hidden: boolean): void {
    try {
        if (hidden) window.localStorage.setItem(STORAGE_KEY, "1");
        else window.localStorage.removeItem(STORAGE_KEY);
    } catch {
        // Private mode / blocked storage: the toggle still works for this visit.
    }
}

/** The toggle's state and its setter (which also writes it back to the device). */
export function useStudyPlatformHidden(): [boolean, (hidden: boolean) => void] {
    const [hidden, setHiddenState] = useState(readHidden);
    const setHidden = useCallback((next: boolean) => {
        setHiddenState(next);
        writeHidden(next);
    }, []);
    return [hidden, setHidden];
}
