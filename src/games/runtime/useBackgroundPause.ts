import { useCallback, useEffect, useState } from "react";

/**
 * Backgrounding pauses the clock — the app-wide games rule
 * (docs/GAMES_FEATURE.md § "Backgrounding pauses the clock", and
 * docs/STUDY_CHALLENGE.md § 5.8, which is where the requirement came from).
 *
 * A player who backgrounds the app mid-round must find the round exactly as they left
 * it. This is NOT a challenge-specific rule: it applies to every game, unconditionally,
 * and it is what removes "abandoned round" as a scoring question entirely — rounds do
 * not run while nobody is watching.
 *
 * ── HOW TO USE IT ─────────────────────────────────────────────────────────────
 * Backgrounding is a SECOND SOURCE for the `clockPaused` boolean each game already
 * derives from its input-blocking popups. Compose, never replace:
 *
 *     const { paused: backgroundPaused, resume } = useBackgroundPause(phase === "playing");
 *     const clockPaused = noticeOpen || settingsOpen || backgroundPaused;
 *
 * and feed `clockPaused` to everything that advances on its own. Then render
 * `<GamePausedOverlay open={backgroundPaused} onResume={resume} />`.
 *
 * ⚠️ THE PAUSE IS ONLY REAL IF ELAPSED TIME IS ACCUMULATED ACTIVE TIME. A game that
 * computes elapsed as `now − startedAt` will honour this hook visually and still bill
 * the player for the time they were away — the pause is then cosmetic, which is worse
 * than none because it looks correct. Word Search's `pauseTimer`/`resumeTimer` pair is
 * the reference for doing it properly.
 *
 * ── WHY `paused` STAYS TRUE AFTER THE PLAYER RETURNS ──────────────────────────
 * It latches. Returning to the tab does NOT clear it; only `resume()` does. That is
 * deliberate (§ 5.8): dropping somebody straight back into a live timer they have not
 * had a chance to look at yet is the same as not pausing at all for the first second.
 * The caller renders a tap-to-resume affordance, and the player chooses when the clock
 * restarts.
 *
 * ── WHY BOTH EVENTS ───────────────────────────────────────────────────────────
 * `visibilitychange` is the one that fires for tab switches and for backgrounding on
 * desktop. `pagehide` is the one that fires on iOS Safari when the app is swiped away
 * or the screen locks, cases where `visibilitychange` is unreliable. Neither is
 * sufficient alone, and both setting the same latch is harmless.
 *
 * @param active Only latch while the round is genuinely running. Pass the game's
 *   "playing" condition, so a player who backgrounds the app on the results screen does
 *   not come back to a resume prompt over a finished board.
 */
export function useBackgroundPause(active: boolean): { paused: boolean; resume: () => void } {
    const [paused, setPaused] = useState(false);

    useEffect(() => {
        if (!active) return;

        const latch = () => {
            // Only latch on the way OUT. `visibilitychange` also fires when the player
            // comes back, and treating that as an event would clear the latch the
            // resume affordance exists to hold.
            if (document.visibilityState === "hidden") setPaused(true);
        };
        // `pagehide` carries no visibility state — its firing IS the signal.
        const latchOnHide = () => setPaused(true);

        document.addEventListener("visibilitychange", latch);
        window.addEventListener("pagehide", latchOnHide);
        return () => {
            document.removeEventListener("visibilitychange", latch);
            window.removeEventListener("pagehide", latchOnHide);
        };
    }, [active]);

    // Leaving the "playing" phase clears the latch, so a player who backgrounds during a
    // round and returns after it ended (a timer expiring while they were away is normal)
    // is not shown a resume prompt for a round that no longer exists.
    useEffect(() => {
        if (!active) setPaused(false);
    }, [active]);

    const resume = useCallback(() => setPaused(false), []);

    return { paused, resume };
}
