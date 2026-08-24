import { useState, useEffect, useCallback, useMemo } from "react";
import { useAuth } from "../../AuthContext";
import { useCategoryCounts } from "../../hooks/useCategoryCounts";
import { useMasteredCounts } from "../../hooks/useMasteredCounts";
import { fetchDecks, createDeck, type DeckSummary } from "../../api/decks";
import { fetchCollectionCards } from "../../api/collections";
import { ALL_COLLECTION_ID, type MasteryBarId } from "../../../server/contracts/wire";
import type { VocabEntry } from "../../types";
import type { MasteryGoals } from "../../utils/masteryCompute";
import { filterVocabEntries } from "../../utils/vocabSearch";
import { sortVocabEntries, defaultSortKey, type VocabSortKey } from "../../utils/vocabSort";
import {
    builtinCollectionCount, lensCollectionEntries, type BuiltinCollectionEntry,
} from "./builtinCollections";

/**
 * useDecksPanel — everything the decks PANEL needs, for one mastery lens.
 *
 * ── What the panel is ─────────────────────────────────────────────────────────
 * The stack of "sets of cards" a learner owns: the built-in collections, their
 * Challenge decks, their own decks, and their whole card library as a searchable
 * grid. It is rendered by `DecksPanelBody` on three surfaces:
 *
 *   fdp (/flashcards/decks)      — as the persistent pull-up sheet, lens `core`
 *   Reading Center (/flashcards/reading) — as a plain page, lens `reading`
 *   Writing Center (/flashcards/writing) — as a plain page, lens `writing`
 *
 * ── Why a hook and not three copies ───────────────────────────────────────────
 * The three surfaces differ ONLY in their lens and in how the body is framed. Every
 * fetch, every piece of list state and every derivation below was already ~150 lines
 * inside FlashcardsDecksPage; copying it into two Center pages would have given the
 * app three places to fix the next time a collection, a count or a sort key changes.
 * The page keeps what is genuinely page-level (its layout, its dialogs, its own study
 * buttons); this owns the data.
 *
 * ── What a LENS changes ───────────────────────────────────────────────────────
 * One `MasteryBarId`, threaded into four places, and everything else follows:
 *   • the collection list — that bar's Learn Now and Mastered (`lensCollectionEntries`)
 *   • the tile figures — band counts read off that bar (`?bar=` on categoryCounts)
 *   • the card grid's ordering — that bar's mastery / cooldown keys (`defaultSortKey`)
 *   • every card's strip and badge — that bar alone (DecksPanelBody passes `lens` down)
 * See docs/DECKS_FEATURE.md § "Mastery Centers" and docs/MASTERY_REWORK.md.
 *
 * Layer: feature hook (src/features/flashcards). Data + derivation only; it renders
 * nothing and knows nothing about the sheet.
 */
export interface DecksPanelState {
    /** The lens this panel was built for — passed straight back down to the body. */
    lens: MasteryBarId;
    /** The account's goal flags, memoized (the sort control's bundle memo keys on it). */
    goals: MasteryGoals;
    /** The account's current language — decides the sort menu's pronunciation label. */
    language: string | null | undefined;
    /** The lens's two built-in collections (Learn Now, Mastered), in display order. */
    collections: BuiltinCollectionEntry[];
    /** Figure for one built-in tile; undefined while its count is still loading. */
    tileCount: (entry: BuiltinCollectionEntry) => number | undefined;
    /** Band counts of the LENS bar — also what the fdp's Review gate reads. */
    categoryCounts: Record<string, number>;

    challengeDecks: DeckSummary[];
    authoredDecks: DeckSummary[];
    decksLoading: boolean;
    decksError: string | null;
    /** Create a deck and prepend it to the list. Throws the server's message verbatim. */
    addDeck: (name: string) => Promise<void>;

    /**
     * The whole sorted library, UNFILTERED and in load order — the set every figure on
     * the page is a statement about. Exposed alongside `visibleCards` because the fdp's
     * study-hand figures are cooldown counts over the LIBRARY, and must not move when the
     * learner types in the card grid's search box.
     *
     * Provisional (lent) rows are already absent: this is a deck read, and those are
     * hidden from every deck/search read (docs/PROVISIONAL_CARDS.md).
     */
    allCards: VocabEntry[];
    /** The whole sorted library, filtered by `cardsSearch` and ordered by `cardsSortKey`. */
    visibleCards: VocabEntry[];
    /** Size of the library BEFORE the search filter — the figure on the section caption. */
    cardsTotal: number;
    cardsLoading: boolean;
    cardsError: string | null;
    cardsSearch: string;
    setCardsSearch: (value: string) => void;
    cardsSortKey: VocabSortKey;
    setCardsSortKey: (key: VocabSortKey) => void;
}

export function useDecksPanel(lens: MasteryBarId): DecksPanelState {
    const { isAuthenticated, user } = useAuth();

    // Per-band card counts THROUGH THIS LENS, driving the tile figures (and, on the
    // fdp, the Review eligibility check). These count SORTED cards only — never the
    // temporary cards a game may have lent (docs/PROVISIONAL_CARDS.md), so the sizes
    // shown always mean "cards you chose to keep".
    const { counts: categoryCounts } = useCategoryCounts(lens);
    // Mastered totals per bar. All three arrive in one response regardless of lens, so
    // the Mastered tile's figure needs no second request when the lens changes.
    const { counts: masteredCounts } = useMasteredCounts();

    // Memoized: a fresh object each render would invalidate the sort control's own
    // bundle memo (and the entries memo below) on every unrelated re-render.
    const goals: MasteryGoals = useMemo(
        () => ({ reading: user?.readingGoal === true, writing: user?.writingGoal === true }),
        [user?.readingGoal, user?.writingGoal]
    );

    // Exactly two tiles, whatever the lens: this bar's Learn Now and this bar's
    // Mastered (All Cards has no tile — the grid below IS it). Memoized so the body's
    // tile row keeps referential identity and its entrance stagger isn't restarted by
    // an unrelated render.
    const collections = useMemo(() => lensCollectionEntries(lens), [lens]);

    const [decks, setDecks] = useState<DeckSummary[]>([]);
    const [decksLoading, setDecksLoading] = useState(true);
    const [decksError, setDecksError] = useState<string | null>(null);
    // `/api/decks` returns BOTH kinds since migration 148, so the panel splits them:
    // generated ("preset") decks get their own captioned section ABOVE the user's own,
    // which is what keeps a new challenge from shuffling the authored decks the user
    // knows the position of. See docs/STUDY_CHALLENGE.md § 4.
    const challengeDecks = useMemo(() => decks.filter((d) => d.editMode === "preset"), [decks]);
    const authoredDecks = useMemo(() => decks.filter((d) => d.editMode !== "preset"), [decks]);

    // ── The inline card library ───────────────────────────────────────────────
    // The "all" collection — every SORTED card, mastered or not — loaded once per
    // visit and searched client-side. It is a single indexed read and the grid paces
    // its own reveal (MiniVocabCardGrid), so it costs a folded sheet nothing.
    //
    // Bar-agnostic on purpose: the LIBRARY is the same set through every lens (see
    // lensCollectionEntries), and only how its cards are read and ordered changes.
    const [cards, setCards] = useState<VocabEntry[]>([]);
    const [cardsLoading, setCardsLoading] = useState(true);
    const [cardsError, setCardsError] = useState<string | null>(null);
    const [cardsSearch, setCardsSearch] = useState("");
    // Ordering of that grid. Held per-visit rather than persisted, the same rule the
    // collection page follows: it is a way of LOOKING at the set, not a property of it.
    // `false` = not a deck, so core opens on card age and a Center on its own mastery.
    const [cardsSortKey, setCardsSortKey] = useState<VocabSortKey>(() => defaultSortKey(false, lens));

    const loadDecks = useCallback(async () => {
        try {
            setDecksLoading(true);
            setDecksError(null);
            setDecks(await fetchDecks());
        } catch (err: unknown) {
            console.error("Error loading decks:", err);
            setDecksError(err instanceof Error ? err.message : "Could not load your decks");
        } finally {
            setDecksLoading(false);
        }
    }, []);

    // Keyed on isAuthenticated — the stable auth-presence flag, not the `token`
    // string — so a silent refresh doesn't re-fetch and reset the list.
    // See CLAUDE.md "Never reload on token refresh".
    useEffect(() => {
        if (isAuthenticated) loadDecks();
    }, [isAuthenticated, loadDecks]);

    // The card library. Same auth keying as the deck list, and `cancelled` guards the
    // setState so a fast navigation away can't write into an unmounted page.
    useEffect(() => {
        if (!isAuthenticated) return;
        let cancelled = false;

        (async () => {
            try {
                setCardsLoading(true);
                setCardsError(null);
                const loaded = await fetchCollectionCards(ALL_COLLECTION_ID);
                if (!cancelled) setCards(loaded);
            } catch (err: unknown) {
                console.error("Error loading cards:", err);
                if (!cancelled) setCardsError(err instanceof Error ? err.message : "Failed to load cards");
            } finally {
                if (!cancelled) setCardsLoading(false);
            }
        })();

        return () => { cancelled = true; };
    }, [isAuthenticated]);

    const addDeck = useCallback(async (name: string) => {
        // The server owns the rules (blank name, duplicate name, the 100-deck
        // per-language cap), so its error propagates to the caller's dialog verbatim
        // rather than being re-derived here where it would drift.
        const deck = await createDeck(name);
        setDecks((prev) => [deck, ...prev]);
    }, []);

    // Filter, then order — the same two-step (and the same shared utilities) the
    // collection page uses. Client-side on both counts: the whole collection is
    // already in memory, so neither costs a round trip and neither introduces a
    // second notion of "matches" or "order".
    //
    // Sorting AFTER filtering keeps the work proportional to what is actually on
    // screen while the user types. Both memos stay referentially stable while their
    // inputs are unchanged, so MiniVocabCardGrid's reveal cascade isn't restarted by
    // an unrelated re-render.
    const filteredCards = useMemo(
        () => filterVocabEntries(cards, cardsSearch),
        [cards, cardsSearch]
    );
    const visibleCards = useMemo(
        () => sortVocabEntries(filteredCards, cardsSortKey),
        [filteredCards, cardsSortKey]
    );

    // Every figure on a built-in tile comes from the two count hooks already loaded —
    // no extra request. The derivation itself lives beside the collection list
    // (builtinCollectionCount) so a collection's definition and its number cannot
    // drift; feeding it the LENS's band counts is what makes a Center's Learn Now tile
    // report "not yet read" rather than "not yet known".
    const tileCount = useCallback(
        (entry: BuiltinCollectionEntry) =>
            builtinCollectionCount(entry.ref, categoryCounts, masteredCounts),
        [categoryCounts, masteredCounts]
    );

    return {
        lens,
        goals,
        language: user?.selectedLanguage,
        collections,
        tileCount,
        categoryCounts,
        challengeDecks,
        authoredDecks,
        decksLoading,
        decksError,
        addDeck,
        allCards: cards,
        visibleCards,
        cardsTotal: cards.length,
        cardsLoading,
        cardsError,
        cardsSearch,
        setCardsSearch,
        cardsSortKey,
        setCardsSortKey,
    };
}
