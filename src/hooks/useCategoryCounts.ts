import { useState, useEffect } from "react";
import { useAuth } from "../AuthContext";
import { API_BASE_URL } from "../constants";
import type { MasteryBarId } from "../utils/masteryCompute";

interface CategoryCountsResult {
    // Per-category library card counts, keyed by category label
    // (Unfamiliar / Target / Comfortable / Mastered).
    counts: Record<string, number>;
    // Whether the counts have finished loading. Consumers that gate behavior on a
    // minimum card total should fail open until this is true, so a slow fetch never
    // blocks a user who actually has plenty of cards.
    loaded: boolean;
    // Whether the fetch actually SUCCEEDED. `loaded` also flips true on a failed fetch,
    // leaving `counts` empty — which reads as "0 cards". Anything that would tell the
    // learner they are LOW on cards (the fdp Sort Cards tile's glow, the sort page's Learn
    // Now glow) must key on this instead, or a network blip nags a full library.
    ok: boolean;
}

/**
 * Fetches the user's per-category flashcard library counts from the OnDeck service.
 * Shared by the decks panel (tile figures + the Review gate + the Sort Cards tile's "card count low" glow),
 * the sort page's tally, and the Account page.
 *
 * `bar` is the mastery LENS the four bands are read through (docs/DECKS_FEATURE.md
 * § "Mastery Centers"). It defaults to `core`, which is what every caller meant before
 * the Mastery Centers existed — the whole-card question. A Center passes its own bar,
 * so its Learn Now tile counts what is left to READ rather than what is left to know.
 */
export function useCategoryCounts(bar: MasteryBarId = "core"): CategoryCountsResult {
    const { token, isAuthenticated } = useAuth();
    const [counts, setCounts] = useState<Record<string, number>>({});
    const [loaded, setLoaded] = useState(false);
    const [ok, setOk] = useState(false);

    useEffect(() => {
        if (!token) return;
        (async () => {
            try {
                const response = await fetch(`${API_BASE_URL}/api/onDeck/categoryCounts?bar=${bar}`, {
                    credentials: "include",
                    headers: { Authorization: `Bearer ${token}` },
                });
                if (response.ok) {
                    const data = await response.json();
                    setCounts(data && typeof data === "object" ? data : {});
                    setOk(true);
                }
            } catch (err) {
                console.error("Error fetching category counts:", err);
            } finally {
                setLoaded(true);
            }
        })();
    // isAuthenticated not `token`: a silent refresh must not re-fetch counts.
    // See CLAUDE.md "Never reload on token refresh". `bar` IS a dep — it changes only
    // when the surface itself is a different lens, which genuinely needs new numbers.
    // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [isAuthenticated, bar]);

    return { counts, loaded, ok };
}
