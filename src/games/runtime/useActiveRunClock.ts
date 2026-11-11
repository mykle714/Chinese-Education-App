import { useCallback, useEffect, useRef } from "react";
import { useBackgroundPause } from "./useBackgroundPause";

/**
 * A hidden stopwatch of ACCUMULATED ACTIVE TIME: it runs while `running` is true and the
 * app is in the foreground, and holds otherwise (the app-wide "backgrounding pauses the
 * clock" rule, `useBackgroundPause`). Nothing re-renders on a tick; read it with
 * `readElapsedMs()` when the run ends.
 *
 * Layer: engine (src/games/runtime). Used by Memory Map for its speed tier
 * (docs/MEMORY_MAP_GAME.md § Run tiers). Superposition and Writing Grid keep an inline
 * copy of the same `accumulatedRef` / `runningSinceRef` pair and could move onto this.
 */
export function useActiveRunClock(running: boolean): { readElapsedMs: () => number } {
    const { paused: backgroundPaused } = useBackgroundPause(running);
    const ticking = running && !backgroundPaused;
    /** Time banked from every finished running segment. */
    const accumulatedRef = useRef(0);
    /** `Date.now()` at the start of the current running segment, or null while held. */
    const runningSinceRef = useRef<number | null>(null);

    useEffect(() => {
        if (!ticking) return;
        runningSinceRef.current = Date.now();
        // The cleanup banks the segment, so a hold (run over, or app backgrounded) and an
        // unmount both stop the clock at the right moment.
        return () => {
            if (runningSinceRef.current !== null) accumulatedRef.current += Date.now() - runningSinceRef.current;
            runningSinceRef.current = null;
        };
    }, [ticking]);

    const readElapsedMs = useCallback(
        () => accumulatedRef.current + (runningSinceRef.current !== null ? Date.now() - runningSinceRef.current : 0),
        []
    );
    return { readElapsedMs };
}
