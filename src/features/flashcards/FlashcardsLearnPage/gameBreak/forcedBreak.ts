import { useSyncExternalStore } from "react";
import type { FlpWorld } from "../../../../../server/contracts/studyMode";

/**
 * forcedBreak — the feature-tester pin that makes every next card of a Deck Tower session
 * a game break, one pin per world (docs/FLP_GAME_BREAKS.md § 10).
 *
 * Layer: feature store (features/flashcards). The Deck Tower's ForcedBreakPicker writes a
 * pin; FlashcardsLearnPage reads it and hands it to useGameBreak as `forcedKey`.
 *
 * A pin is a candidate's `key` (`${gameId}:${mode}`, FlpBreakCandidate), stored per device
 * in localStorage like the time-of-day pin. It is a module-level STORE, not hook state,
 * because the writer (the tower's header) and the reader (a mounted, parked session) are
 * different trees. Honoured only when the reader says so (`allow`), so a stale key on a
 * shared device never changes a learner's session.
 *
 * Depended on by: FlashcardsLearnPage.tsx, deckTower/ForcedBreakPicker.tsx.
 */

const storageKey = (world: FlpWorld) => `deckTower.forcedBreak.${world}`;

function readPin(world: FlpWorld): string | null {
    try {
        return localStorage.getItem(storageKey(world));
    } catch {
        return null;
    }
}

const pins: Record<FlpWorld, string | null> = {
    core: readPin("core"),
    reading: readPin("reading"),
    writing: readPin("writing"),
};
const listeners = new Set<() => void>();

function subscribe(listener: () => void): () => void {
    listeners.add(listener);
    return () => listeners.delete(listener);
}

/** Pin `key` in `world`; null goes back to Auto (the usual rhythm and random pick). */
export function setForcedBreak(world: FlpWorld, key: string | null): void {
    try {
        if (key === null) localStorage.removeItem(storageKey(world));
        else localStorage.setItem(storageKey(world), key);
    } catch {
        // Storage unavailable — the pin just won't persist past this session.
    }
    pins[world] = key;
    listeners.forEach((listener) => listener());
}

/** The world's pin, or null when there is none or `allow` is false. */
export function useForcedBreak(world: FlpWorld, allow: boolean): string | null {
    const pin = useSyncExternalStore(subscribe, () => pins[world]);
    return allow ? pin : null;
}
