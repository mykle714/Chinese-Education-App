import { useState, useEffect, useCallback } from "react";
import { useAuth } from "../AuthContext";
import { fetchFlpReadyCounts, type FlpReadyCounts } from "../api/flpReadyCounts";
import type { FlpWorld } from "../../server/contracts/studyMode";

/**
 * One bar's OFF-COOLDOWN card counts per utcm band — the Deck Tower world's Learning
 * deck height (DeckTowerPage `learningCount`, useFocusLever), fetched independently of
 * the full card library. See `src/api/flpReadyCounts.ts` and
 * `OnDeckVocabService.getFlpReadyCounts` (the shared `flpReadyCountsByBand` formula,
 * server/contracts/flpReadiness.ts, run against a narrow `{ id, typedMarkHistory }` read).
 */
export function useFlpReadyCounts(
    world: FlpWorld = "core"
): FlpReadyCounts & { loaded: boolean; focusOn: boolean; reload: () => void; version: number } {
    const { isAuthenticated } = useAuth();
    const [counts, setCounts] = useState<Record<string, number>>({});
    const [focusOn, setFocusOn] = useState(false);
    const [loaded, setLoaded] = useState(false);
    // Bumped each time a fetch SETTLES (success or failure), so a caller waiting on a
    // `reload` can tell its re-read has landed even when the figures came back unchanged
    // (the Deck Tower's focus lever: DeckTowerPage → `resolveRecount`).
    const [version, setVersion] = useState(0);
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
                setFocusOn(result.focusOn === true);
            } catch (err) {
                console.error("Error fetching flp-ready counts:", err);
            } finally {
                if (!cancelled) {
                    setLoaded(true);
                    setVersion((v) => v + 1);
                }
            }
        })();

        return () => { cancelled = true; };
    // isAuthenticated not the auth token: see CLAUDE.md "Never reload on token
    // refresh".
    }, [isAuthenticated, world, reloadKey]);

    return { counts, focusOn, loaded, reload, version };
}
