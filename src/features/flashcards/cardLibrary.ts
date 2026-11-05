import { fetchCollectionCards } from "../../api/collections";
import { ALL_COLLECTION_ID } from "../../../server/contracts/wire";
import type { VocabEntry } from "../../types";

/**
 * cardLibrary — the learner's whole card library (the "all" collection), loaded once
 * and shared by every reader on the page.
 *
 * Its reader is the Deck Tower's cards page (`useCardLibrary`), which mounts once per
 * WORLD: a pan between worlds remounts it (DeckTowerPage keys TowerCardsPage by world).
 * Routing every load through here means the next world's page
 *   • JOINS a load that is still on the wire instead of starting the same request, and
 *   • SEEDS its first paint from the library that last landed, then refreshes quietly,
 * so a pan never flashes a spinner over a grid the learner was just looking at.
 *
 * Module-level and in-memory on purpose: it lives as long as the page session, and the
 * entry is keyed by (user, language) plus a max age so a stale library is never served
 * to the wrong reader.
 *
 * Layer: feature data helper (src/features/flashcards). Calls go through src/api/*.
 * Depended on by: src/features/flashcards/useCardLibrary.ts.
 * Docs: docs/DECK_TOWER.md § "The cards page".
 */

/**
 * How old a landed library may be and still seed a first paint. The reader refreshes in
 * the background regardless; this only bounds how stale the FIRST frame can be. An hour
 * so a study session's worth of time away still seeds; capped so a tab left open
 * overnight does not paint yesterday's library.
 */
const LIBRARY_SEED_MAX_AGE_MS = 60 * 60 * 1000;

/** The request currently on the wire, if any. */
let inFlight: { key: string; promise: Promise<VocabEntry[]> } | null = null;
/** The last library that arrived. Kept across a refresh, so a failed refresh still leaves a seed. */
let landed: { key: string; cards: VocabEntry[]; at: number } | null = null;

/** `${userId}:${language}` — the server reads the library for the selected language. */
export const libraryKey = (userId: string | number, language: string | null | undefined) =>
    `${userId}:${language ?? ""}`;

/**
 * Load the library for `key`. While a load for the same key is IN FLIGHT this joins it;
 * otherwise it starts a fresh one. Every mount still refreshes — this removes the
 * duplicate request, it does not make the library sticky.
 */
export function loadCardLibrary(key: string): Promise<VocabEntry[]> {
    if (inFlight?.key === key) return inFlight.promise;
    const request = { key, promise: fetchCollectionCards(ALL_COLLECTION_ID) };
    inFlight = request;
    request.promise.then(
        (cards) => { landed = { key, cards, at: Date.now() }; },
        () => { /* the caller handles the error; `landed` keeps the last good copy */ }
    ).finally(() => { if (inFlight === request) inFlight = null; });
    return request.promise;
}

/** A recently landed library for `key`, or null — the seed for a reader's first paint. */
export function peekCardLibrary(key: string): VocabEntry[] | null {
    if (!landed || landed.key !== key || Date.now() - landed.at > LIBRARY_SEED_MAX_AGE_MS) return null;
    return landed.cards;
}
