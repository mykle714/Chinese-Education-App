import { useEffect } from 'react';

/**
 * activitySuppression — lets a page say "interactions right now are not study activity"
 * (docs/MINUTE_POINTS_SYSTEM.md § "Suppressed activity").
 *
 * LAYER: shared client state (src/minutePoints).
 *
 * ⚠️ NOT THE SAME AS A PAUSE (`./minutePointsPause`). A pause freezes the per-second tick
 * outright. Suppression only stops interactions from REFRESHING the activity window: a clock
 * that is already running keeps running until the usual `ACTIVITY_TIMEOUT_MS` (15 s) idle
 * timeout lapses, and then stops unless something that does count happens. So a learner who
 * types a few words of English mid-passage loses nothing; one who types English for a minute
 * earns at most the 15 s tail of their last counted interaction.
 *
 * Motivating case: the cyoa editors, where typing on the system `abc` keyboard is writing
 * English rather than practising Chinese (docs/CYOA_FEATURE.md § 8).
 *
 * A counter rather than a flag, like `./studySurface`, so two suppressors (or a StrictMode
 * double-mount) cannot release each other.
 *
 * Depended on by: src/minutePoints/useMinutePoints.ts (reads it in its activity callback);
 * src/features/cyoa/useAbcTypingIsNotActivity.ts (sets it).
 */

let suppressions = 0;

/** Imperative read for the document-level activity listener (no React subscription needed). */
export function isMinutePointsActivitySuppressed(): boolean {
    return suppressions > 0;
}

/** Suppress activity while `active` is true (released on false or unmount). */
export function useSuppressMinutePointsActivity(active: boolean): void {
    useEffect(() => {
        if (!active) return;
        suppressions += 1;
        return () => {
            suppressions -= 1;
        };
    }, [active]);
}
