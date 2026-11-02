import { useCallback, useRef } from "react";

/**
 * useRunClock — Word Search's count-up clock (docs/WORD_SEARCH_GAME.md §5, §5b).
 *
 * It runs out of sight: nothing on the board shows it, so it holds refs and no state, and
 * never re-renders the Stage. Its readers are the finish (medal, personal best) and the
 * save slot, both of which call `readElapsedMs`.
 *
 * `startRef` is non-null ONLY while the clock is running; `pausedElapsedRef` holds the
 * elapsed time while it is not. `hasStartedRef` records whether the clock has EVER started
 * on this board, independent of whether it is running now, which is what decides whether
 * a pause may resume at all.
 *
 * Every function is stable, so callers can list them in dependency arrays.
 *
 * Layer: game hook. Depended on by: WordSearchStage.tsx.
 */
export function useRunClock() {
    const startRef = useRef<number | null>(null);
    const pausedElapsedRef = useRef(0);
    const hasStartedRef = useRef(false);

    /** A new board's clock, from 0 or from a saved board's elapsed time. */
    const startClock = useCallback((fromElapsedMs: number) => {
        pausedElapsedRef.current = fromElapsedMs;
        startRef.current = Date.now() - fromElapsedMs;
        hasStartedRef.current = true;
    }, []);

    /** Tab hidden, or a popup up: elapsed time freezes rather than following the wall clock. */
    const pauseTimer = useCallback(() => {
        if (startRef.current === null) return;
        pausedElapsedRef.current = Date.now() - startRef.current;
        startRef.current = null;
    }, []);

    const resumeTimer = useCallback(() => {
        if (!hasStartedRef.current) return; // never started — nothing to resume
        if (startRef.current !== null) return; // already running
        startRef.current = Date.now() - pausedElapsedRef.current;
    }, []);

    const readElapsedMs = useCallback(
        () => (startRef.current !== null ? Date.now() - startRef.current : pausedElapsedRef.current),
        []
    );

    const hasStarted = useCallback(() => hasStartedRef.current, []);

    // A win or a run left early. The same freeze as a pause: nothing resumes it, because
    // only the `playing` phase's effects call `resumeTimer`.
    return { startClock, stopTimer: pauseTimer, pauseTimer, resumeTimer, readElapsedMs, hasStarted };
}
