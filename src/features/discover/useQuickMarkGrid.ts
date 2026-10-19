import { useState, useEffect, useLayoutEffect, useCallback, useRef, type RefObject } from "react";
import { useAuth } from "../../AuthContext";
import { fetchQuickMarkPage, sortCard, undoSort, type QuickMarkCursorParams } from "./starterPacksApi";
import type { QuickMarkSupplySeed } from "./useQuickMarkPreload";
import {
    QUICK_MARK_BUCKET, QUICK_MARK_COMMIT_PX,
    paintQuickMarkDrag, snapshotCardSlots, playCardSlotSlide, observeCardDrawWindow, type CardSlots,
} from "../../components/quickMarkSwipe";
import { useSwipeCommit, type SwipeDirection } from "../../hooks/useSwipeCommit";
import { CARD_FLY_OUT_MS } from "../flashcards/constants";
import type { Language, DiscoverCard } from "../../types";

// QUICK MARK GRID STATE (docs/QUICK_MARK.md) — the bulk-triage grid's supply, paging,
// swipe commit and undo toast. Lifted out of the deleted standalone QuickMarkPage when
// Quick Mark moved INSIDE Sort Cards as the expanded on-deck panel (QuickMarkPanel.tsx,
// docs/SORT_CARDS_REQUIREMENTS.md § 4.8).
//
// PINNED CARDS. The panel opens from an on-deck pack, and that pack's still-unsorted
// cards are the grid's first cards ("pinned"). A pinned card is NOT sorted here: its
// swipe and its undo are handed to the host (`onSortPinned` / `onUndoPinned`), which runs
// them through Sort Cards' own pack machinery — crater, adaptive-leveling signal, tally,
// Undo stack — so a pack card resolved in the grid is indistinguishable from one dragged
// into a bucket. Every other card is the plain Quick Mark supply, sorted here with a bare
// `sortCard({ packId: null })`, and reported to the host (`onSupplySorted` /
// `onSupplyUnsorted`) so it can keep its tally honest.
//
// Pinning only holds at the level the panel opened at: a level change reloads the grid
// from the supply alone (the host replaces its pack on a level change anyway).
//
// SEED. The host may hand over the first supply page it preloaded (useQuickMarkPreload).
// The grid then mounts FULL — pinned cards, then the seed — and skips its open-time
// fetch, so the supply's pop-in plays during the panel's expand morph. Paging resumes
// from the seed's cursor. Without a seed (or for a different level) the grid fetches.
//
// LAYER: feature hook (view-state + its own API calls via starterPacksApi). Consumed only
// by QuickMarkPanel.
//
// Referenced by docs/QUICK_MARK.md and docs/SORT_CARDS_REQUIREMENTS.md § 4.8.

// How long the Undo toast stays up after a swipe.
export const QUICK_MARK_UNDO_TOAST_MS = 4000;

// A card cursor for keyset pagination — the last FETCHED card's sort-key coordinates.
// Matches the server's ORDER BY (frequencyScore DESC NULLS LAST, id ASC).
type QuickMarkCursor = QuickMarkCursorParams;

// The bottom toast: the last swipe (with Undo), or a failure message. `seq` keys the
// Snackbar so back-to-back swipes restart its auto-hide instead of extending a stale one.
type QuickMarkToastInput =
    | { kind: "undo"; card: DiscoverCard; index: number; direction: SwipeDirection }
    | { kind: "error"; message: string };
export type QuickMarkToast = QuickMarkToastInput & { seq: number };

type QuickMarkBucket = (typeof QUICK_MARK_BUCKET)[SwipeDirection];

export interface UseQuickMarkGridOptions {
    language: Language | undefined;
    /** The concrete 1..6 level the grid shows. A change reloads the grid (unpinned). */
    level: number;
    /** The host pack's unsorted cards, placed first. Read at MOUNT only. */
    pinnedCards: DiscoverCard[];
    /** A preloaded first supply page. Read at MOUNT only, and only if it is for `level`. */
    seed?: QuickMarkSupplySeed | null;
    /** Class on the grid container — how the gap-fill slide and draw window find it. */
    gridClass: string;
    /** The panel's own scroll container (draw window + infinite-scroll root). */
    scrollerRef: RefObject<HTMLElement | null>;
    onSortPinned: (card: DiscoverCard, bucket: QuickMarkBucket) => void;
    onUndoPinned: (card: DiscoverCard, bucket: QuickMarkBucket) => void;
    onSupplySorted: (card: DiscoverCard, bucket: QuickMarkBucket) => void;
    onSupplyUnsorted: (card: DiscoverCard, bucket: QuickMarkBucket) => void;
}

// Re-insert a card at (up to) its old position, unless it's already there.
const reinsert = (cards: DiscoverCard[], card: DiscoverCard, index: number): DiscoverCard[] =>
    cards.some((c) => c.id === card.id)
        ? cards
        : [...cards.slice(0, index), card, ...cards.slice(index)];

export function useQuickMarkGrid({
    language, level, pinnedCards, seed, gridClass, scrollerRef,
    onSortPinned, onUndoPinned, onSupplySorted, onSupplyUnsorted,
}: UseQuickMarkGridOptions) {
    const { isAuthenticated } = useAuth();
    const gridSelector = `.${gridClass}`;

    // Pinned ids, fixed at mount and emptied for good by the first level change.
    const mountLevelRef = useRef(level);
    const pinnedIdsRef = useRef<Set<number>>(new Set(pinnedCards.map((c) => c.id)));
    const isPinned = useCallback((cardId: number) => pinnedIdsRef.current.has(cardId), []);
    // Ids a fetched page must never re-add: every card pinned at mount, and every card
    // swiped (until its Undo). A page requested before a swipe's write landed can still
    // carry that word, and de-duping against the cards ON SCREEN would let it back in.
    const supplyExcludedRef = useRef<Set<number>>(new Set(pinnedCards.map((c) => c.id)));

    // A seed counts only for the level the grid opens at; mount-time only.
    const [mountSeed] = useState(() => (seed && seed.level === level ? seed : null));
    // The cards still to triage. Seeded on the FIRST render — the pinned cards, then the
    // preloaded supply page — so the panel's expand morph can measure the pinned cells,
    // and the supply pops in during the morph rather than after a fetch.
    const [cards, setCards] = useState<DiscoverCard[]>(() =>
        mountSeed ? [...pinnedCards, ...mountSeed.cards.filter((c) => !pinnedIdsRef.current.has(c.id))] : pinnedCards);
    // Cards mid fly-off (committed, still on screen), keyed by det id.
    const [leaving, setLeaving] = useState<Record<number, SwipeDirection>>({});
    // Initial page. Never shown while pinned cards are already on screen — the supply
    // simply appends after them when it lands.
    const [loading, setLoading] = useState(pinnedCards.length === 0 && !mountSeed);
    const [loadingMore, setLoadingMore] = useState(false);
    const [hasMore, setHasMore] = useState(mountSeed?.hasMore ?? false);
    const [error, setError] = useState<string | null>(null);
    const [toast, setToast] = useState<QuickMarkToast | null>(null);
    const toastSeq = useRef(0);

    // Host callbacks through a ref: they close over the host's latest pack/undo state,
    // and the swipe handler that calls them is deliberately stable.
    const hostRef = useRef({ onSortPinned, onUndoPinned, onSupplySorted, onSupplyUnsorted });
    hostRef.current = { onSortPinned, onUndoPinned, onSupplySorted, onSupplyUnsorted };

    // Supply cards whose sort the host has been credited for. A credit is taken back at
    // most once, however the reversal arrives (Undo, or the sort failing after an Undo
    // already restored the card).
    const creditedRef = useRef<Set<number>>(new Set());
    const credit = useCallback((card: DiscoverCard, bucket: QuickMarkBucket) => {
        creditedRef.current.add(card.id);
        hostRef.current.onSupplySorted(card, bucket);
    }, []);
    const uncredit = useCallback((card: DiscoverCard, bucket: QuickMarkBucket) => {
        if (creditedRef.current.delete(card.id)) hostRef.current.onSupplyUnsorted(card, bucket);
    }, []);

    // Guard so the intersection-observer sentinel doesn't fire overlapping loads.
    const loadingMoreRef = useRef(false);
    // The keyset cursor is the last card FETCHED, not the last card on screen: swipes
    // remove cards from `cards`, and resuming after an earlier card would re-request
    // rows the client already holds (or, with every card swiped, have no cursor at all).
    const cursorRef = useRef<QuickMarkCursor | null>(mountSeed?.cursor ?? null);
    // What the grid last (re)loaded for — language, level and auth state. The load effect
    // skips a key it already holds: the seed's key at mount (so a seeded grid does not
    // refetch, even when StrictMode runs the effect twice), and any re-run that changed
    // nothing the page depends on.
    const loadedKeyRef = useRef<string | null>(null);
    // Bumped by every reset: a page that lands after a newer reset (a quick level change)
    // belongs to the old level and is dropped rather than appended.
    const requestSeqRef = useRef(0);
    // Live mirror of `cards` for the swipe commit, which runs from a stable handler.
    const cardsRef = useRef(cards);
    cardsRef.current = cards;
    // Per-card fly-off timers (cleared when a failed save or an Undo restores the card
    // first) and in-flight sort promises (an Undo waits for its sort to land, so the
    // delete can't race ahead of the insert it reverses).
    const removeTimers = useRef(new Map<number, number>());
    const pendingSorts = useRef(new Map<number, Promise<unknown>>());
    useEffect(() => {
        const timers = removeTimers.current;
        return () => { for (const t of timers.values()) window.clearTimeout(t); };
    }, []);

    const showToast = useCallback((t: QuickMarkToastInput) => {
        setToast({ ...t, seq: ++toastSeq.current });
    }, []);
    const dismissToast = useCallback(() => setToast(null), []);

    // Load a page. `reset` (level change / mount) replaces the supply part of the grid —
    // the pinned cards still standing stay at the front; otherwise the page is appended
    // after the keyset cursor. Fetched cards are de-duped against what is already shown,
    // which also keeps a pinned card from appearing twice.
    const loadPage = useCallback(async (lvl: number, reset: boolean) => {
        if (reset) {
            requestSeqRef.current += 1;
            cursorRef.current = null;
            setCards((prev) => prev.filter((c) => pinnedIdsRef.current.has(c.id)));
            setLeaving({});
            setToast(null); // an Undo for the previous level's card would be confusing
            if (pinnedIdsRef.current.size === 0) setLoading(true);
        } else {
            setLoadingMore(true);
            loadingMoreRef.current = true;
        }
        setError(null);
        const seq = requestSeqRef.current;
        try {
            const data = await fetchQuickMarkPage(language as Language, lvl, cursorRef.current);
            if (seq !== requestSeqRef.current) return; // superseded by a newer reset
            setHasMore(data.hasMore);
            const last = data.cards[data.cards.length - 1];
            if (last) cursorRef.current = { score: last.frequencyScore ?? null, id: last.id };
            setCards((prev) => {
                const seen = new Set(prev.map((c) => c.id));
                return [...prev, ...data.cards.filter((c) => !seen.has(c.id) && !supplyExcludedRef.current.has(c.id))];
            });
        } catch (err: unknown) {
            if (seq !== requestSeqRef.current) return;
            console.error("Error loading quick-mark cards:", err);
            if (reset && pinnedIdsRef.current.size === 0) setError(err instanceof Error ? err.message : "Failed to load cards");
        } finally {
            if (reset) { if (seq === requestSeqRef.current) setLoading(false); }
            else { setLoadingMore(false); loadingMoreRef.current = false; }
        }
    // No `token` dep: starterPacksApi reads the bearer token itself at call time, so a
    // silent ~15-min refresh never re-creates this callback.
    }, [language]);

    // (Re)load on mount, on a level change, and on auth settle. Keyed on isAuthenticated,
    // NOT token — a silent token refresh must not reload the grid mid-triage (CLAUDE.md
    // "Never reload on token refresh"). Leaving the opening level unpins for good.
    useEffect(() => {
        if (!language) return;
        const key = `${language}:${level}:${isAuthenticated}`;
        if (loadedKeyRef.current === null && mountSeed) loadedKeyRef.current = key;
        if (loadedKeyRef.current === key) return;
        loadedKeyRef.current = key;
        if (level !== mountLevelRef.current) pinnedIdsRef.current = new Set();
        loadPage(level, true);
    }, [language, level, isAuthenticated, loadPage, mountSeed]);

    // Load the next page after the last-fetched card (keyset cursor).
    const loadMore = useCallback(() => {
        if (loadingMoreRef.current || !hasMore || !cursorRef.current) return;
        loadPage(level, false);
    }, [hasMore, level, loadPage]);

    // Swiped the whole loaded page away while more exist: the sentinel lives inside the
    // grid's card list, which is gone, so fetch the next page directly.
    useEffect(() => {
        if (!loading && cards.length === 0 && hasMore) loadMore();
    }, [loading, cards.length, hasMore, loadMore]);

    // ── Gap fill ────────────────────────────────────────────────────────────────
    // When a card leaves (or comes back), the cards after it SLIDE to their new slots
    // instead of jumping (quickMarkSwipe.ts → FLIP). The slots are snapshotted just before
    // the list changes and the slide is played in a layout effect, i.e. before the browser
    // paints the jumped layout.
    const slotsBeforeChange = useRef<CardSlots | null>(null);
    const snapshotSlots = useCallback(() => {
        const root = document.querySelector(gridSelector);
        if (root) slotsBeforeChange.current = snapshotCardSlots(root);
    }, [gridSelector]);
    useLayoutEffect(() => {
        const before = slotsBeforeChange.current;
        if (!before) return;
        slotsBeforeChange.current = null;
        const root = document.querySelector(gridSelector);
        if (root) playCardSlotSlide(root, before);
    }, [cards, gridSelector]);

    // Draw window: only cards within two rows of the screen are painted
    // (quickMarkSwipe.ts → observeCardDrawWindow). Rebuilt whenever the list changes so
    // new cards (next page, an Undo) are observed and removed ones are released.
    useEffect(() => {
        const root = document.querySelector(gridSelector);
        if (!root) return;
        return observeCardDrawWindow(root, scrollerRef.current);
    }, [cards, gridSelector, scrollerRef]);

    // Put a card back where it was: cancel its pending removal, clear its fly-off.
    const restoreCard = useCallback((card: DiscoverCard, index: number) => {
        if (!pinnedIdsRef.current.has(card.id)) supplyExcludedRef.current.delete(card.id);
        const timer = removeTimers.current.get(card.id);
        if (timer !== undefined) { window.clearTimeout(timer); removeTimers.current.delete(card.id); }
        setLeaving((prev) => { const next = { ...prev }; delete next[card.id]; return next; });
        snapshotSlots();
        setCards((prev) => reinsert(prev, card, index));
    }, [snapshotSlots]);

    // Drop a card from the grid: the fly-off is over (or an Undo failed).
    const removeCard = useCallback((cardId: number) => {
        removeTimers.current.delete(cardId);
        setLeaving((prev) => { const next = { ...prev }; delete next[cardId]; return next; });
        snapshotSlots();
        setCards((prev) => prev.filter((c) => c.id !== cardId));
    }, [snapshotSlots]);

    // A committed swipe: fly the card off, then close the gap. A pinned card is handed to
    // the host; a supply card is written NOW, and a failed write puts it back and says
    // so — the grid must never show a card as sorted that the server didn't take.
    const handleCommit = useCallback((id: string, direction: SwipeDirection) => {
        const cardId = Number(id);
        const index = cardsRef.current.findIndex((c) => c.id === cardId);
        const card = cardsRef.current[index];
        if (!card || !language) return;
        const bucket = QUICK_MARK_BUCKET[direction];
        setLeaving((prev) => ({ ...prev, [cardId]: direction }));
        supplyExcludedRef.current.add(cardId);
        removeTimers.current.set(cardId, window.setTimeout(() => removeCard(cardId), CARD_FLY_OUT_MS));
        showToast({ kind: "undo", card, index, direction });

        if (pinnedIdsRef.current.has(cardId)) {
            hostRef.current.onSortPinned(card, bucket);
            return;
        }
        credit(card, bucket);
        const sort = sortCard({ cardId, bucket, language, packId: null })
            .catch((err) => {
                console.error(`[QuickMark] sort failed → card ${cardId} (${bucket}):`, err);
                restoreCard(card, index);
                uncredit(card, bucket);
                showToast({ kind: "error", message: `Couldn't save ${card.entryKey} — try again.` });
                throw err; // keep the rejection for an Undo awaiting this sort
            })
            .finally(() => pendingSorts.current.delete(cardId));
        pendingSorts.current.set(cardId, sort);
    }, [language, removeCard, restoreCard, showToast, credit, uncredit]);

    // Undo the last swipe: put the card back immediately, then reverse the write. A
    // pinned card's reversal is the host's (its Undo stack). A supply card's is
    // `undoSort` — the same reversal Sort Cards uses; if the sort itself failed there is
    // nothing to delete (and the card is already back).
    const handleUndo = useCallback(async () => {
        if (toast?.kind !== "undo" || !language) return;
        const { card, index, direction } = toast;
        const bucket = QUICK_MARK_BUCKET[direction];
        setToast(null);
        restoreCard(card, index);
        if (pinnedIdsRef.current.has(card.id)) {
            hostRef.current.onUndoPinned(card, bucket);
            return;
        }
        uncredit(card, bucket);
        try {
            await pendingSorts.current.get(card.id);
        } catch {
            return; // the sort never landed — restoring the card was the whole undo
        }
        try {
            await undoSort({ cardId: card.id, bucket, language, packId: null });
        } catch (err) {
            console.error(`[QuickMark] undo failed → card ${card.id}:`, err);
            removeCard(card.id); // still sorted on the server — don't show it as unsorted
            credit(card, bucket);
            showToast({ kind: "error", message: `Couldn't undo ${card.entryKey}.` });
        }
    }, [toast, language, restoreCard, removeCard, showToast, credit, uncredit]);

    const swipe = useSwipeCommit({
        axisLock: true,
        threshold: () => QUICK_MARK_COMMIT_PX,
        onCommit: handleCommit,
        // Painted straight to the DOM: a state-driven drag re-rendered the grid's whole
        // card list on every pointermove.
        paint: paintQuickMarkDrag,
    });

    return {
        cards, leaving, loading, loadingMore, hasMore, error,
        toast, dismissToast, handleUndo, swipe, loadMore, isPinned,
    };
}
