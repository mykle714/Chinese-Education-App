import type { VocabEntry } from "../../types";
import type { DeckSummary } from "../../api/decks";
import type { VocabSortKey } from "../../utils/vocabSort";
import type { CardsFilter } from "./useDecksPanel";

/**
 * BACK-RESTORE — a card-grid page comes back EXACTLY as it was left when the learner
 * returns to it with Back (the ← arrow, the browser button, or iOS's edge swipe).
 *
 * ── What is restored ──────────────────────────────────────────────────────────
 * Which sheet was open and how tall it was (fdp only), the scroll position, the search
 * text, the sort key, the collection filter, and the loaded cards/decks themselves. The
 * cached lists let the page paint its final state on the FIRST frame; the page still
 * refetches in the background and swaps the fresh list in, so a mark made on the cdp
 * shows up a moment later rather than never.
 *
 * ── Keyed on the HISTORY ENTRY, not the route ─────────────────────────────────
 * Snapshots are stored under React Router's `location.key`, which is unique per history
 * entry and is handed back unchanged when that entry is returned to with Back. A fresh
 * arrival at the same URL (a footer-tab tap, a `navigate("/flashcards/decks")` push)
 * gets a NEW key, finds nothing, and opens fresh — so "restore" means "Back", never
 * "the last time you were here". Contrast `dictionaryBrowseState`, which is one
 * route-space singleton cleared on exit (docs/LEAF_NODE_PAGES.md).
 *
 * ── Why the swipe needed this, not just the arrow ─────────────────────────────
 * iOS Safari's edge swipe drags a SNAPSHOT of the page it saved when the learner left,
 * and after the gesture WebKit keeps that snapshot up (input blocked) until the live
 * page looks like it — falling back to a multi-second watchdog when it never does. The
 * fdp used to come back with its sheet closed, i.e. never matching a snapshot taken with
 * the Cards sheet open, so every swipe back froze the tab for a couple of seconds on
 * PPE. Restoring the page to the snapshot's state on the first frame is the fix for
 * that stall as well as for the lost place. (Diagnosed 2026-09-13 by elimination — the
 * arrow, which involves no Safari snapshot, never stalled. Not yet profiled on-device.)
 *
 * ── Lifetime ──────────────────────────────────────────────────────────────────
 * In memory only: a reload starts fresh, and an entry's snapshot is simply overwritten
 * the next time the learner leaves that entry. The store is bounded (`MAX_SNAPSHOTS`,
 * oldest evicted first) because each snapshot holds a whole card library.
 *
 * Layer: client feature utility (src/features/flashcards). No React, no DOM.
 * Callers: FlashcardsDecksPage (fdp), MasteryCenterPage, CollectionViewPage.
 * Docs: docs/DECKS_FEATURE.md § "Back restores the page", docs/LEAF_NODE_PAGES.md
 * § "Card-grid back-restore".
 */

/** The panel state `useDecksPanel` can be re-seeded from. Shared by the fdp and the Centers. */
export interface DecksPanelSnapshot {
    cards: VocabEntry[];
    decks: DeckSummary[];
    cardsSearch: string;
    cardsSortKey: VocabSortKey;
    cardsFilter: CardsFilter;
}

/** fdp: the panel state plus which sheet was up, its height and its scroll. */
export interface DecksPageSnapshot {
    panel: DecksPanelSnapshot;
    openSheet: "cards" | "decks" | null;
    /** The sheet's live height in px when the learner left, or null if none was open. */
    sheetHeight: number | null;
    scrollTop: number;
}

/** Mastery Center: the panel state plus the body's scroll. */
export interface MasteryCenterSnapshot {
    panel: DecksPanelSnapshot;
    scrollTop: number;
}

/** Collection / deck page. */
export interface CollectionPageSnapshot {
    entries: VocabEntry[];
    searchInput: string;
    sortKey: VocabSortKey;
    deckName: string | null;
    deckIsPreset: boolean;
    scrollTop: number;
}

/**
 * Which page a snapshot belongs to. Part of the storage key so a snapshot can only ever
 * be read back by the page type that wrote it — the routes all share one component per
 * page, but a defensive namespace costs nothing and keeps the casts below honest.
 */
export type BackRestoreScope = "decks" | "mastery-center" | "collection";

/** Enough for a realistic Back stack across the three pages; each entry is a library. */
const MAX_SNAPSHOTS = 12;

// Map iteration order is insertion order, so re-inserting on write keeps the oldest
// entry first — which is the one eviction drops.
const snapshots = new Map<string, unknown>();

const storageKey = (scope: BackRestoreScope, locationKey: string) => `${scope}:${locationKey}`;

/** Record how this history entry looked as the learner leaves it. */
export function saveBackSnapshot(scope: "decks", locationKey: string, snapshot: DecksPageSnapshot): void;
export function saveBackSnapshot(scope: "mastery-center", locationKey: string, snapshot: MasteryCenterSnapshot): void;
export function saveBackSnapshot(scope: "collection", locationKey: string, snapshot: CollectionPageSnapshot): void;
export function saveBackSnapshot(scope: BackRestoreScope, locationKey: string, snapshot: unknown): void {
    const key = storageKey(scope, locationKey);
    snapshots.delete(key);
    snapshots.set(key, snapshot);
    while (snapshots.size > MAX_SNAPSHOTS) {
        const oldest = snapshots.keys().next().value;
        if (oldest === undefined) break;
        snapshots.delete(oldest);
    }
}

/** The snapshot for this history entry, or undefined when it is a fresh arrival. */
export function readBackSnapshot(scope: "decks", locationKey: string): DecksPageSnapshot | undefined;
export function readBackSnapshot(scope: "mastery-center", locationKey: string): MasteryCenterSnapshot | undefined;
export function readBackSnapshot(scope: "collection", locationKey: string): CollectionPageSnapshot | undefined;
export function readBackSnapshot(scope: BackRestoreScope, locationKey: string): unknown {
    return snapshots.get(storageKey(scope, locationKey));
}
