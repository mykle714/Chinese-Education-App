import { useState, useEffect, useCallback, useMemo } from "react";
import { useAuth } from "../AuthContext";
import { fetchFlpReadyCounts, type FlpReadyCounts } from "../api/flpReadyCounts";
import type { FlpWorld } from "../../server/contracts/studyMode";
import type { FlpUpcomingRelease } from "../../server/contracts/flpReadiness";

/**
 * One bar's OFF-COOLDOWN card counts per utcm band — the Deck Tower world's Learning
 * deck height (DeckTowerPage `learningCount`, useFocusLever), fetched independently of
 * the full card library. See `src/api/flpReadyCounts.ts` and
 * `OnDeckVocabService.getFlpReadyCounts` (the shared `flpReadyCountsByBand` formula,
 * server/contracts/flpReadiness.ts, run against a narrow `{ id, typedMarkHistory }` read).
 *
 * COOLDOWN RELEASES (docs/DECK_TOWER.md § "Cooldown releases"). The fetch also returns the
 * cooling cards' release schedule (`upcoming`, soonest first). The hook keeps one timer on
 * the next `readyAt`; when it passes, that card becomes DUE (`pendingReleases`). A due card
 * is not in `counts` until the caller `applyReleases` it — the Deck Tower applies one at a
 * time, each as its own sky drop, so the count and the animation change together. No
 * re-fetch is made for a release: the schedule stays true until the next mark, and every
 * mark path re-reads (`reload`), which replaces the schedule.
 */
export interface FlpReadyCountsState extends Omit<FlpReadyCounts, "upcoming"> {
    loaded: boolean;
    focusOn: boolean;
    reload: () => void;
    version: number;
    /** Cards whose cooldown has ended since the fetch, not yet counted into `counts`. */
    pendingReleases: number;
    /** Count the next `n` due releases into `counts`. */
    applyReleases: (n: number) => void;
}

/** `setTimeout`'s ceiling (~24.8 days); the schedule's horizon is 24 h, well inside it. */
const MAX_TIMER_MS = 2 ** 31 - 1;

/** How many of `upcoming` (sorted) have a `readyAt` at or before `now`. */
function dueCount(upcoming: readonly FlpUpcomingRelease[], now: number): number {
    let n = 0;
    while (n < upcoming.length && upcoming[n].readyAt <= now) n++;
    return n;
}

export function useFlpReadyCounts(world: FlpWorld = "core"): FlpReadyCountsState {
    const { isAuthenticated } = useAuth();
    // The figures as fetched: ready at the moment the server read them.
    const [fetchedCounts, setFetchedCounts] = useState<Record<string, number>>({});
    const [focusOn, setFocusOn] = useState(false);
    const [loaded, setLoaded] = useState(false);
    // Bumped each time a fetch SETTLES (success or failure), so a caller waiting on a
    // `reload` can tell its re-read has landed even when the figures came back unchanged
    // (the Deck Tower's focus lever: DeckTowerPage → `resolveRecount`).
    const [version, setVersion] = useState(0);
    // Bumped by `reload` (the Deck Tower after its focus lever flips) to re-fetch.
    const [reloadKey, setReloadKey] = useState(0);
    const reload = useCallback(() => setReloadKey((k) => k + 1), []);

    // The release schedule and how far through it we are:
    //   upcoming[0 .. applied)  counted into `counts`
    //   upcoming[applied .. due) off cooldown, waiting for the caller (`pendingReleases`)
    //   upcoming[due ..)        still cooling; the timer waits on upcoming[due]
    const [upcoming, setUpcoming] = useState<FlpUpcomingRelease[]>([]);
    const [due, setDue] = useState(0);
    const [applied, setApplied] = useState(0);

    useEffect(() => {
        if (!isAuthenticated) return;
        let cancelled = false;

        (async () => {
            try {
                const result = await fetchFlpReadyCounts(world);
                if (cancelled) return;
                setFetchedCounts(result.counts ?? {});
                setFocusOn(result.focusOn === true);
                // A new schedule replaces the old one: anything the old one had released is in
                // the fresh `counts` already, so nothing carries over.
                const next = Array.isArray(result.upcoming) ? result.upcoming : [];
                setUpcoming(next);
                setDue(dueCount(next, Date.now()));
                setApplied(0);
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

    // The one timer: wakes when the next still-cooling card's clock runs out and marks
    // every card released by then as due. A backgrounded tab's timer may fire late; the
    // catch-up `dueCount` then releases everything that passed meanwhile in one step.
    useEffect(() => {
        if (due >= upcoming.length) return;
        const delay = Math.min(MAX_TIMER_MS, Math.max(0, upcoming[due].readyAt - Date.now()));
        const timer = window.setTimeout(() => setDue(dueCount(upcoming, Date.now())), delay);
        return () => window.clearTimeout(timer);
    }, [upcoming, due]);

    const applyReleases = useCallback(
        (n: number) => setApplied((a) => Math.min(due, a + Math.max(0, n))),
        [due]
    );

    // The fetched figures plus every applied release, in its band.
    const counts = useMemo(() => {
        if (applied === 0) return fetchedCounts;
        const next = { ...fetchedCounts };
        for (let i = 0; i < applied; i++) {
            const band = upcoming[i].band;
            next[band] = (next[band] ?? 0) + 1;
        }
        return next;
    }, [fetchedCounts, upcoming, applied]);

    return { counts, focusOn, loaded, reload, version, pendingReleases: due - applied, applyReleases };
}
