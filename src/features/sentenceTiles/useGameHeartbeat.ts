import { useEffect, useRef } from "react";
import { pollSentenceTilesGame } from "../../api/sentenceTiles";
import { SENTENCE_TILES_POLL_MS } from "../../../server/contracts/sentenceTiles";
import type { SentenceTilesGameView } from "../../../server/contracts/sentenceTiles";

/**
 * useGameHeartbeat — the correspondence game's cheap update check
 * (docs/SENTENCE_TILES_GAME.md § "Updates: a heartbeat, not a socket").
 *
 * Every SENTENCE_TILES_POLL_MS while the page is visible, asks the server whether the game has
 * moved past the version on screen. The server answers 204 (one indexed row read) when nothing
 * changed, so an idle open page costs almost nothing. Also checks immediately when the tab
 * becomes visible again, so a player returning to the app sees the opponent's move at once.
 *
 * Paused while hidden, while `paused` is true (a move is being submitted — its own response
 * carries the new state), and once the game is over (`enabled` false).
 *
 * The version and callback are read through refs so the interval is set up once per game and
 * never torn down on a re-render.
 */
export function useGameHeartbeat(
    gameId: string | undefined,
    version: number | undefined,
    enabled: boolean,
    paused: boolean,
    onUpdate: (game: SentenceTilesGameView) => void,
): void {
    const versionRef = useRef(version);
    const pausedRef = useRef(paused);
    const onUpdateRef = useRef(onUpdate);
    versionRef.current = version;
    pausedRef.current = paused;
    onUpdateRef.current = onUpdate;

    useEffect(() => {
        if (!gameId || !enabled) return;
        let inFlight = false;
        let cancelled = false;

        const check = async () => {
            if (inFlight || pausedRef.current || document.hidden || versionRef.current === undefined) return;
            inFlight = true;
            try {
                const next = await pollSentenceTilesGame(gameId, versionRef.current);
                // Ignore a response that arrives after a newer state was set by a move.
                if (!cancelled && next && next.version > (versionRef.current ?? 0)) onUpdateRef.current(next);
            } catch (err) {
                // A missed beat is harmless; the next one retries.
                console.warn("useGameHeartbeat: poll failed", err);
            } finally {
                inFlight = false;
            }
        };

        const timer = window.setInterval(check, SENTENCE_TILES_POLL_MS);
        const onVisible = () => { if (!document.hidden) void check(); };
        document.addEventListener("visibilitychange", onVisible);
        return () => {
            cancelled = true;
            window.clearInterval(timer);
            document.removeEventListener("visibilitychange", onVisible);
        };
    }, [gameId, enabled]);
}
