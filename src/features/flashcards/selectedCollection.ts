/**
 * selectedCollection.ts — which collection the Games hub is currently playing with.
 *
 * The Games hub carries a collection selector in its header ("Playing with: …"),
 * and every game launched from the hub draws from that set. This module is the
 * one place that choice lives.
 *
 * ── Why a module singleton, not context or the URL ────────────────────────────
 * The choice is SESSION-SCOPED AND DELIBERATELY NOT PERSISTED: it must survive
 * leaving the hub for a game and coming back (otherwise every round would reset to
 * All Cards mid-session), but it must NOT survive a reload — a learner returning
 * tomorrow should not silently still be drilling one deck they picked once. That
 * rules out both localStorage and a per-page useState.
 *
 * A module singleton + useSyncExternalStore is the codebase's existing shape for a
 * small global flag with a handful of leaf readers (see minutePoints/minutePointsPause.ts);
 * it avoids adding a provider to App.tsx for a value only the hub and its own
 * sub-strips read.
 *
 * ── What it does NOT change ───────────────────────────────────────────────────
 * The selection reaches a game exactly the way a launch from a collection page
 * always has: the hub wraps each game link in `withCollectionParams`, so the game
 * arrives with `?deck=` / `?collection=` and reads it back with
 * `collectionFromSearch` / `useLaunchCollection`. No game page knows this store
 * exists, and the URL of a running round still names its own set.
 *
 * Depended on by:
 *   src/games/GamesCollectionSelector.tsx  (writes + reads)
 *   src/games/GamesPage.tsx                (reads, to build every game link)
 *   src/games/word-search/WordSearchHubItem.tsx (reads, it builds its own links)
 * See docs/GAMES_FEATURE.md § "Collection selector" and docs/DECKS_FEATURE.md.
 */
import { useSyncExternalStore } from 'react';
import type { CollectionRef } from './collectionRef';

/** The default: no narrowing at all, i.e. every playable card. */
export const ALL_CARDS: CollectionRef = { kind: 'all' };

let selected: CollectionRef = ALL_CARDS;
const listeners = new Set<() => void>();

/** Imperative read (non-React callers, e.g. an event handler building a path). */
export function getSelectedCollection(): CollectionRef {
    return selected;
}

/** Choose the collection every hub-launched game plays with. */
export function setSelectedCollection(ref: CollectionRef): void {
    if (ref === selected) return;
    selected = ref;
    listeners.forEach((l) => l());
}

/**
 * Drop back to All Cards if the selection is a deck that no longer exists —
 * deleted, or belonging to the learner's other language (decks are per-language,
 * so switching language invalidates the whole set). The selector calls this after
 * loading the deck list; without it a stale `?deck=` would 404 every game launch.
 */
export function clearSelectedDeckIfMissing(liveDeckIds: number[]): void {
    if (selected.kind !== 'deck') return;
    if (liveDeckIds.includes(selected.deckId)) return;
    setSelectedCollection(ALL_CARDS);
}

function subscribe(cb: () => void): () => void {
    listeners.add(cb);
    return () => listeners.delete(cb);
}

/** Reactive read, for anything that renders the selection or a link built from it. */
export function useSelectedCollection(): CollectionRef {
    return useSyncExternalStore(subscribe, getSelectedCollection);
}
