import { useState, useEffect, useCallback, useMemo, useDeferredValue } from "react";
import { useAuth } from "../../AuthContext";
import { useCategoryCounts } from "../../hooks/useCategoryCounts";
import { useMasteredCounts } from "../../hooks/useMasteredCounts";
import { libraryKey, loadCardLibrary, peekCardLibrary } from "./cardLibrary";
import type { MasteryWorldId } from "../../../server/contracts/wire";
import type { VocabEntry } from "../../types";
import type { MasteryGoals } from "../../utils/masteryCompute";
import { filterVocabEntries } from "../../utils/vocabSearch";
import { barCategory } from "../../utils/masteryCompute";
import { sortVocabEntries, masteryLowestKey, type VocabSortKey } from "../../utils/vocabSort";
import {
    builtinCollectionCount, lensCollectionEntries, type BuiltinCollectionEntry,
} from "./builtinCollections";

/**
 * Which of the lens's two constants the card grid is narrowed to, if either.
 *
 * `"all"` is the neutral state — no filter key pressed, the whole library on screen —
 * and it is what pressing the ACTIVE key returns to, so the pair behaves as a two-button
 * toggle group rather than a mode the learner can get stuck in.
 *
 * The two values match the `CollectionRef.kind`s of `lensCollectionEntries`, which is
 * what lets a filter key map to a filter without a second vocabulary.
 */
export type CardsFilter = "all" | "learn-now" | "mastered";

/**
 * useCardLibrary — the learner's whole card library through ONE mastery lens, as a
 * searchable, sortable, filterable grid.
 *
 * Host: the Deck Tower's cards page (src/features/deckTower/TowerCardsPage.tsx), once
 * per world — lens `core` under the main platform, `reading` / `writing` under theirs.
 * It was `useDecksPanel` until 2026-11-04, when its other hosts (the old Home page's
 * Cards/Decks sheets and the Reading/Writing Centers) were deleted along with Decks.
 *
 * ── What a LENS changes ───────────────────────────────────────────────────────
 * One `MasteryWorldId`, threaded into three places, and everything else follows:
 *   • the filter keys — that bar's Learning and Mastered (`lensCollectionEntries`)
 *   • the key figures — band counts read off that bar (`?world=` on categoryCounts)
 *   • the grid's ordering and banding — that bar's mastery keys (`masteryLowestKey`,
 *     `barCategory`)
 * The LIBRARY is the same set through every lens; only how it is read changes.
 *
 * Layer: feature hook (src/features/flashcards). Data + derivation only; renders nothing.
 * Docs: docs/DECK_TOWER.md § "The cards page".
 */
export interface CardLibraryState {
    /** The account's goal flags, memoized (the sort control's bundle memo keys on it). */
    goals: MasteryGoals;
    /** The account's current language — decides the sort menu's pronunciation label. */
    language: string | null | undefined;
    /** The lens's two built-in collections (Learning, Mastered), in display order. */
    collections: BuiltinCollectionEntry[];
    /** Figure for one filter key; undefined while its count is still loading. */
    tileCount: (entry: BuiltinCollectionEntry) => number | undefined;
    /**
     * The library narrowed by `cardsFilter`, then by `cardsSearch`, then ordered by
     * `cardsSortKey`.
     */
    visibleCards: VocabEntry[];
    cardsLoading: boolean;
    cardsError: string | null;
    cardsSearch: string;
    setCardsSearch: (value: string) => void;
    cardsSortKey: VocabSortKey;
    setCardsSortKey: (key: VocabSortKey) => void;
    /** Which library constant the grid is narrowed to, or `"all"`. */
    cardsFilter: CardsFilter;
    /** The filter key currently narrowing the grid, or null for the whole library. */
    activeCollection: BuiltinCollectionEntry | null;
    /**
     * The toggle-group contract: pressing a key narrows the grid to it, pressing the
     * ACTIVE key clears back to `"all"`. The key's `CollectionRef.kind` IS the filter
     * value, so there is no mapping table to drift.
     */
    toggleCardsFilter: (entry: BuiltinCollectionEntry) => void;
}

export function useCardLibrary(lens: MasteryWorldId): CardLibraryState {
    const { isAuthenticated, user } = useAuth();

    // Per-band card counts THROUGH THIS LENS, driving the filter keys' figures. These
    // count SORTED cards only — never cards a game lent (docs/PROVISIONAL_CARDS.md).
    const { counts: categoryCounts } = useCategoryCounts(lens);
    // Mastered totals per bar — all three arrive in one response regardless of lens.
    const { counts: masteredCounts } = useMasteredCounts();

    // Memoized: a fresh object each render would invalidate the sort control's own
    // bundle memo on every unrelated re-render.
    const goals: MasteryGoals = useMemo(
        () => ({ reading: user?.readingGoal === true, writing: user?.writingGoal === true }),
        [user?.readingGoal, user?.writingGoal]
    );

    // Exactly two keys, whatever the lens: this bar's Learning and this bar's Mastered.
    const collections = useMemo(() => lensCollectionEntries(lens), [lens]);

    // ── The library ───────────────────────────────────────────────────────────
    // Loaded through cardLibrary.ts, so a world pan (which remounts this hook) seeds its
    // first paint from the library the previous world just loaded, then refreshes
    // quietly instead of swapping the grid for a spinner.
    const libKey = user ? libraryKey(user.id, user.selectedLanguage) : null;
    const [seed] = useState(() => (libKey ? peekCardLibrary(libKey) : null));
    const quietRefresh = seed !== null;
    const [cards, setCards] = useState<VocabEntry[]>(() => seed ?? []);
    const [cardsLoading, setCardsLoading] = useState(() => !quietRefresh);
    const [cardsError, setCardsError] = useState<string | null>(null);
    const [cardsSearch, setCardsSearch] = useState("");
    // Per-visit, not persisted: a way of LOOKING at the library, not a property of it.
    // Opens on the lens bar's mastery, lowest first — see `masteryLowestKey`.
    const [cardsSortKey, setCardsSortKey] = useState<VocabSortKey>(() => masteryLowestKey(lens));
    const [cardsFilter, setCardsFilter] = useState<CardsFilter>("all");

    // Keyed on the stable auth identity, never the token (CLAUDE.md "Never reload on
    // token refresh"); `cancelled` guards the setState after a fast navigation away.
    useEffect(() => {
        if (!isAuthenticated || !libKey) return;
        let cancelled = false;

        (async () => {
            try {
                if (!quietRefresh) setCardsLoading(true);
                setCardsError(null);
                const loaded = await loadCardLibrary(libKey);
                if (!cancelled) setCards(loaded);
            } catch (err: unknown) {
                console.error("Error loading cards:", err);
                if (!cancelled) setCardsError(err instanceof Error ? err.message : "Failed to load cards");
            } finally {
                if (!cancelled) setCardsLoading(false);
            }
        })();

        return () => { cancelled = true; };
    }, [isAuthenticated, libKey, quietRefresh]);

    // Filter by collection, then by the (deferred) search, then order — client-side, the
    // whole library is already in memory. The search term is DEFERRED so the keystroke
    // updates the input at normal priority while the re-filter/re-sort/re-render rides a
    // copy React may interrupt when the next keystroke lands.
    //
    // The collection filter bands each card on THIS LENS's bar with the same
    // `barCategory` the mini-card strips and the server's collection SQL use, so the
    // grid's membership and the key's figure are one rule — "Learning" is exactly
    // `category <> 'Mastered'`.
    const collectionCards = useMemo(() => {
        if (cardsFilter === "all") return cards;
        const wantMastered = cardsFilter === "mastered";
        return cards.filter(
            (card) => (barCategory(card.typedMarkHistory, lens, card.writingMastery) === "Mastered") === wantMastered
        );
    }, [cards, cardsFilter, lens]);

    const deferredSearch = useDeferredValue(cardsSearch);
    const filteredCards = useMemo(
        () => filterVocabEntries(collectionCards, deferredSearch),
        [collectionCards, deferredSearch]
    );
    const visibleCards = useMemo(
        () => sortVocabEntries(filteredCards, cardsSortKey),
        [filteredCards, cardsSortKey]
    );

    // Every key figure comes from the two count hooks — no extra request. The derivation
    // lives beside the collection list (builtinCollectionCount) so a collection's
    // definition and its number cannot drift.
    const tileCount = useCallback(
        (entry: BuiltinCollectionEntry) =>
            builtinCollectionCount(entry.ref, categoryCounts, masteredCounts),
        [categoryCounts, masteredCounts]
    );

    const activeCollection = useMemo(
        () => collections.find((entry) => entry.ref.kind === cardsFilter) ?? null,
        [collections, cardsFilter]
    );
    const toggleCardsFilter = useCallback((entry: BuiltinCollectionEntry) => {
        const next = entry.ref.kind as CardsFilter;
        setCardsFilter((current) => (current === next ? "all" : next));
    }, []);

    return {
        goals,
        language: user?.selectedLanguage,
        collections,
        tileCount,
        visibleCards,
        cardsLoading,
        cardsError,
        cardsSearch,
        setCardsSearch,
        cardsSortKey,
        setCardsSortKey,
        cardsFilter,
        activeCollection,
        toggleCardsFilter,
    };
}
