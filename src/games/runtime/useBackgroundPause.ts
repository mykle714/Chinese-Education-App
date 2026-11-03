import { useEffect, useState } from "react";

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
 *     const { paused: backgroundPaused } = useBackgroundPause(phase === "playing");
 *     const clockPaused = noticeOpen || backgroundPaused;
 *
 * and feed `clockPaused` to everything that advances on its own.
 *
 * ⚠️ THE PAUSE IS ONLY REAL IF ELAPSED TIME IS ACCUMULATED ACTIVE TIME. A game that
 * computes elapsed as `now − startedAt` will honour this hook visually and still bill
 * the player for the time they were away — the pause is then cosmetic, which is worse
 * than none because it looks correct. Word Search's `pauseTimer`/`resumeTimer` pair is
 * the reference for doing it properly.
 *
 * ── AUTO-RESUME (2026-11-02) ──────────────────────────────────────────────────
 * `paused` tracks visibility: it goes true when the app is hidden and clears by itself
 * the moment the player is back. There is NO tap-to-resume screen any more — the old
 * latch + `GamePausedOverlay` pair was removed app-wide (challenge rounds included) as
 * friction, matching what Word Search always did. The trade-off accepted with it: the
 * board is no longer hidden while paused, so a backgrounded round can be looked at on
 * return before the clock restarts — but only for as long as the app is visible, which
 * is exactly when the clock is running again, so it buys no free study time.
 *
 * ── WHY BOTH EVENTS ───────────────────────────────────────────────────────────
 * `visibilitychange` is the one that fires for tab switches and for backgrounding on
 * desktop. `pagehide` is the one that fires on iOS Safari when the app is swiped away
 * or the screen locks, cases where `visibilitychange` is unreliable. `pageshow` (a
 * bfcache restore) and `visibilitychange` → visible clear it again.
 *
 * Docs that depend on this hook: docs/GAMES_FEATURE.md § "Backgrounding pauses the
 * clock", docs/FLP_GAME_BREAKS.md § 6, docs/STUDY_CHALLENGE.md § 5.8.
 *
 * @param active Only pause while the round is genuinely running. Pass the game's
 *   "playing" condition; leaving it clears the pause.
 */
export function useBackgroundPause(active: boolean): { paused: boolean } {
    const [hidden, setHidden] = useState(false);

    useEffect(() => {
        if (!active) {
            setHidden(false);
            return;
        }

        const sync = () => setHidden(document.visibilityState === "hidden");
        // `pagehide` carries no visibility state — its firing IS the signal.
        const onHide = () => setHidden(true);
        const onShow = () => setHidden(false);

        // Arm in the current state, so a round that goes live while hidden starts paused.
        sync();
        document.addEventListener("visibilitychange", sync);
        window.addEventListener("pagehide", onHide);
        window.addEventListener("pageshow", onShow);
        return () => {
            document.removeEventListener("visibilitychange", sync);
            window.removeEventListener("pagehide", onHide);
            window.removeEventListener("pageshow", onShow);
        };
    }, [active]);

    return { paused: active && hidden };
}
