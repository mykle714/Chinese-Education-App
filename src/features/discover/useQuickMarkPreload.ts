import { useCallback, useEffect, useRef } from "react";
import { useAuth } from "../../AuthContext";
import { fetchQuickMarkPage, type QuickMarkCursorParams } from "./starterPacksApi";
import type { Language, DiscoverCard } from "../../types";

// QUICK MARK PRELOAD (docs/SORT_CARDS_REQUIREMENTS.md § 4.8 "Preload", docs/QUICK_MARK.md)
// — Sort Cards keeps the expanded panel's FIRST supply page fetched in the background, so
// the grid opens already full: its cards pop in WITH the panel's expand morph instead of
// a beat after it, when a fetch made at open time would land.
//
// ONE PAGE PER LEVEL, FILTERED AT OPEN. The page is fetched once for the level the panel
// would open at, and is not refetched as the learner sorts. Words sorted on the platform
// since then are filtered out when the panel takes the page (`take`, given the host's
// resolved ids) — the fetch can predate their write, or race the POST still in flight.
// It is refetched only when that filter would leave too little to fill a screen
// (`PRELOAD_MIN_USABLE`), when the level changes, or after the panel was used (its own
// swipes moved the supply; `invalidate`).
//
// `take` returns null when nothing usable is cached for that level — the grid then
// loads at open exactly as it would without a preload.
//
// LAYER: feature hook (owns one background API call via starterPacksApi). Consumed only
// by SortCardsPage; the seed it returns is handed to QuickMarkPanel → useQuickMarkGrid.
//
// Referenced by docs/SORT_CARDS_REQUIREMENTS.md § 4.8 and docs/QUICK_MARK.md.

/** A first supply page, handed to the grid so it can skip its open-time fetch. */
export interface QuickMarkSupplySeed {
    level: number;
    /** Already filtered: no word sorted on the platform, no pinned card. */
    cards: DiscoverCard[];
    hasMore: boolean;
    /** The last FETCHED card (pre-filter) — where the grid's next page resumes. */
    cursor: QuickMarkCursorParams | null;
}

// Fewer usable cards than this and the cached page is refetched: ~5 rows, more than one
// phone screen of the 3-across grid, so the panel never opens onto a half-empty wall.
const PRELOAD_MIN_USABLE = 15;
// The background fetch waits this long after the last trigger: it must not compete with
// the pack fetch, the dock entrance or the narration lookup a fresh pack starts.
const PRELOAD_DELAY_MS = 800;

interface CachedPage {
    language: Language;
    level: number;
    cards: DiscoverCard[];
    hasMore: boolean;
    cursor: QuickMarkCursorParams | null;
}

export interface UseQuickMarkPreloadOptions {
    language: Language | undefined;
    /** The level the panel would open at now (the dropdown's pin, else the pack's). */
    level: number | null;
    /** Off while the panel is open (it pages for itself) or before a pack is on deck. */
    enabled: boolean;
    /** Ids the platform has resolved this session — never offered back. Read live. */
    isExcluded: (cardId: number) => boolean;
    /** Re-checks the cache's usable count; pass the on-deck packKey. */
    recheckKey: string | undefined;
}

export function useQuickMarkPreload({ language, level, enabled, isExcluded, recheckKey }: UseQuickMarkPreloadOptions) {
    const { isAuthenticated } = useAuth();
    const cacheRef = useRef<CachedPage | null>(null);
    // Bumped by `invalidate` and every new fetch: a page that lands after either is stale.
    const fetchSeqRef = useRef(0);
    // A live mirror, so the delayed fetch and `take` see the host's latest exclusions.
    const isExcludedRef = useRef(isExcluded);
    isExcludedRef.current = isExcluded;

    const usableCards = useCallback((page: CachedPage, alsoExclude?: Set<number>) =>
        page.cards.filter((c) => !isExcludedRef.current(c.id) && !alsoExclude?.has(c.id)), []);

    useEffect(() => {
        if (!enabled || !language || level == null || !isAuthenticated) return;
        const cached = cacheRef.current;
        const fresh = cached?.language === language && cached.level === level
            // A level with no further pages has nothing more to fetch, however few remain.
            && (usableCards(cached).length >= PRELOAD_MIN_USABLE || !cached.hasMore);
        if (fresh) return;
        const seq = ++fetchSeqRef.current;
        const timer = window.setTimeout(() => {
            fetchQuickMarkPage(language, level, null)
                .then((data) => {
                    if (seq !== fetchSeqRef.current) return;
                    const last = data.cards[data.cards.length - 1];
                    cacheRef.current = {
                        language, level, cards: data.cards, hasMore: data.hasMore,
                        cursor: last ? { score: last.frequencyScore ?? null, id: last.id } : null,
                    };
                })
                // Best-effort: a failed preload only means the grid fetches at open.
                .catch((err) => console.warn("[QuickMark] preload failed:", err));
        }, PRELOAD_DELAY_MS);
        return () => window.clearTimeout(timer);
    // isAuthenticated, not token: a silent refresh must not refetch (CLAUDE.md).
    }, [enabled, language, level, isAuthenticated, recheckKey, usableCards]);

    /** The cached page for `level`, minus resolved ids and `pinnedIds`; null if none. */
    const take = useCallback((lvl: number, pinnedIds: Set<number>): QuickMarkSupplySeed | null => {
        const cached = cacheRef.current;
        if (!cached || cached.language !== language || cached.level !== lvl) return null;
        const cards = usableCards(cached, pinnedIds);
        if (cards.length === 0 && cached.hasMore) return null;
        return { level: lvl, cards, hasMore: cached.hasMore, cursor: cached.cursor };
    }, [language, usableCards]);

    /** Drop the cache (the panel's own swipes changed the supply). */
    const invalidate = useCallback(() => {
        fetchSeqRef.current += 1;
        cacheRef.current = null;
    }, []);

    return { take, invalidate };
}
