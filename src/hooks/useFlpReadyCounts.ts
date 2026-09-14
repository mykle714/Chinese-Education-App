import { useState, useEffect } from "react";
import { useAuth } from "../AuthContext";
import { fetchFlpReadyCounts, type FlpReadyCounts } from "../api/flpReadyCounts";
import type { FlpForeignTrack } from "../../server/contracts/wire";

/**
 * The fdp study-hand figures (Challenge/Review/Study Mix), fetched independently of
 * the full card library. See `src/api/flpReadyCounts.ts` and
 * `OnDeckVocabService.getFlpReadyCounts` — the same `flpReadyCountsByBand` /
 * `nextFlpReadyMs` formula the client used to run against `panel.allCards`, now
 * computed server-side against a narrow `{ id, typedMarkHistory }` read so the hand's
 * three figures no longer wait on the fully-enriched collection fetch.
 *
 * `loaded` starts false and never regresses back to false on a `foreignTrack` change
 * mid-visit — the settings toggle that flips it is rare and the old figures are a
 * better placeholder than a spinner while the new ones land.
 */
export function useFlpReadyCounts(foreignTrack: FlpForeignTrack): FlpReadyCounts & { loaded: boolean } {
    const { isAuthenticated } = useAuth();
    const [counts, setCounts] = useState<Record<string, number>>({});
    const [reviewNextReadyMs, setReviewNextReadyMs] = useState<number | null>(null);
    const [loaded, setLoaded] = useState(false);

    useEffect(() => {
        if (!isAuthenticated) return;
        let cancelled = false;

        (async () => {
            try {
                const result = await fetchFlpReadyCounts(foreignTrack);
                if (cancelled) return;
                setCounts(result.counts ?? {});
                setReviewNextReadyMs(result.reviewNextReadyMs ?? null);
            } catch (err) {
                console.error("Error fetching flp-ready counts:", err);
            } finally {
                if (!cancelled) setLoaded(true);
            }
        })();

        return () => { cancelled = true; };
    // isAuthenticated not the auth token: see CLAUDE.md "Never reload on token
    // refresh". `foreignTrack` IS a dep — it changes when the reading-track setting
    // does, which genuinely changes which cards are counted ready.
    // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [isAuthenticated, foreignTrack]);

    return { counts, reviewNextReadyMs, loaded };
}
