import { useState, useEffect } from "react";
import { useAuth } from "../AuthContext";
import { fetchMasteredCounts } from "../api/masteredCounts";
import type { MasteryWorldId } from "../utils/masteryCompute";

/**
 * How many cards the learner has mastered in EACH mastery bar (core / reading /
 * writing) — the Deck Tower's Mastered deck heights and its cards page's Mastered key.
 * See docs/MASTERY_REWORK.md § "Three bars".
 *
 * Kept apart from `useCategoryCounts`, which answers a different question: that hook
 * returns the four BANDS of the core bar, this one returns the Mastered count of each
 * BAR. One endpoint each, so neither response has to be disambiguated by key name.
 *
 * All three counts are fetched regardless of the account's goals; the page decides
 * which rows to render. That way toggling a goal reveals a row that already has its
 * number rather than triggering a refetch.
 *
 * The request goes through src/api/masteredCounts.ts → `fetchMasteredCounts` (the shared
 * http client attaches the token at call time; docs/FRONTEND_LAYERING.md §3.2).
 */
export function useMasteredCounts(refreshKey = 0): {
    counts: Record<MasteryWorldId, number>;
    loaded: boolean;
    /**
     * Whether a fetch has actually SUCCEEDED. `counts` starts at zeros and `loaded` also
     * flips true on a failed fetch, so neither can tell "0 mastered" from "not known".
     * A surface that prints the figure (td's cards page, useCardLibrary → `tileCount`)
     * keys on this, so it never shows a 0 that was never loaded. Mirrors
     * useCategoryCounts → `ok`.
     */
    ok: boolean;
} {
    const { isAuthenticated } = useAuth();
    const [counts, setCounts] = useState<Record<MasteryWorldId, number>>({
        core: 0,
        reading: 0,
        writing: 0,
    });
    const [loaded, setLoaded] = useState(false);
    const [ok, setOk] = useState(false);

    useEffect(() => {
        if (!isAuthenticated) return;
        // A newer read (a `refreshKey` bump) or an unmount supersedes this one: its answer
        // must not land over the newer one's.
        let cancelled = false;
        fetchMasteredCounts()
            .then((next) => {
                if (cancelled) return;
                setCounts(next);
                setOk(true);
            })
            // A failed read keeps the last good counts and `ok` as it was: false until a
            // read has succeeded, so callers show "not loaded" rather than 0 (DeckTowerPage
            // retries by bumping `refreshKey`).
            .catch((err) => console.error("Error fetching mastered counts:", err))
            .finally(() => { if (!cancelled) setLoaded(true); });
        return () => { cancelled = true; };
    // Keyed on isAuthenticated, never `token`: a silent refresh must not re-fetch counts
    // (CLAUDE.md "Never reload on token refresh"). `refreshKey` re-reads on demand (td's
    // cards page when its card view closes — useCardLibrary; DeckTowerPage's retry).
    }, [isAuthenticated, refreshKey]);

    return { counts, loaded, ok };
}
