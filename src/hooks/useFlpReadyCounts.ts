import { useState, useEffect, useCallback } from "react";
import { useAuth } from "../AuthContext";
import { fetchFlpReadyCounts, type FlpReadyCounts } from "../api/flpReadyCounts";
import type { FlpWorld } from "../../server/contracts/studyMode";

/**
 * The fdp study-hand figures (Challenge/Review/Study Mix), fetched independently of
 * the full card library. See `src/api/flpReadyCounts.ts` and
 * `OnDeckVocabService.getFlpReadyCounts` — the same `flpReadyCountsByBand` /
 * `nextFlpReadyMs` formula the client used to run against `panel.allCards`, now
 * computed server-side against a narrow `{ id, typedMarkHistory }` read so the hand's
 * three figures no longer wait on the fully-enriched collection fetch.
 */
export function useFlpReadyCounts(
    world: FlpWorld = "core"
): FlpReadyCounts & { loaded: boolean; focusOn: boolean; reload: () => void } {
    const { isAuthenticated } = useAuth();
    const [counts, setCounts] = useState<Record<string, number>>({});
    const [reviewNextReadyMs, setReviewNextReadyMs] = useState<number | null>(null);
    const [focusOn, setFocusOn] = useState(false);
    const [loaded, setLoaded] = useState(false);
    // Bumped by `reload` (the Deck Tower after its focus lever flips) to re-fetch.
    const [reloadKey, setReloadKey] = useState(0);
    const reload = useCallback(() => setReloadKey((k) => k + 1), []);

    useEffect(() => {
        if (!isAuthenticated) return;
        let cancelled = false;

        (async () => {
            try {
                const result = await fetchFlpReadyCounts(world);
                if (cancelled) return;
                setCounts(result.counts ?? {});
                setReviewNextReadyMs(result.reviewNextReadyMs ?? null);
                setFocusOn(result.focusOn === true);
            } catch (err) {
                console.error("Error fetching flp-ready counts:", err);
            } finally {
                if (!cancelled) setLoaded(true);
            }
        })();

        return () => { cancelled = true; };
    // isAuthenticated not the auth token: see CLAUDE.md "Never reload on token
    // refresh".
    }, [isAuthenticated, world, reloadKey]);

    return { counts, reviewNextReadyMs, focusOn, loaded, reload };
}
