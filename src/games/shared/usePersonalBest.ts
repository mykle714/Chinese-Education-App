import { useCallback, useEffect, useRef, useState } from "react";
import { useAuth } from "../../AuthContext";
import { fetchPersonalBests, submitPersonalBest, type PersonalBestGame } from "../../api/personalBests";

/**
 * usePersonalBest — one game mode's personal best (docs/WRITING_PRACTICE_REWORK.md § 2a).
 *
 * Loads the stored best for (language, game, mode) and exposes `record(value)` for the
 * end of a run: the server keeps the value only if it beats the stored best (direction per
 * game, server/contracts/personalBests.ts), and the hook remembers whether THIS run set it
 * (`isNewBest`) so the end screen can celebrate it. `reset()` clears the run state for a
 * Play Again.
 *
 * Keyed on `isAuthenticated`, never the token (CLAUDE.md "Never reload on token refresh").
 * Failures are non-fatal: the end screen simply shows no best.
 *
 * Consumers: Word Search, Match Speed, Speed Reading, Hydra Bubbles, Writing Grid.
 */
export function usePersonalBest(game: PersonalBestGame, mode: string | number | null | undefined) {
    const { user, isAuthenticated } = useAuth();
    const language = user?.selectedLanguage ?? "zh";
    const modeKey = mode === null || mode === undefined ? null : String(mode);

    const [best, setBest] = useState<number | null>(null);
    const [isNewBest, setIsNewBest] = useState(false);
    // The best as it stood BEFORE the last recorded run — "previous best" on the end screen.
    const [previousBest, setPreviousBest] = useState<number | null>(null);
    // Guard against recording one run twice (an end screen effect re-running).
    const recordedRef = useRef(false);

    useEffect(() => {
        setBest(null);
        setIsNewBest(false);
        setPreviousBest(null);
        recordedRef.current = false;
        if (!isAuthenticated || !modeKey) return;
        let cancelled = false;
        fetchPersonalBests(language, game)
            .then((rows) => {
                if (cancelled) return;
                const row = rows.find((r) => r.mode === modeKey);
                setBest(row ? row.bestValue : null);
            })
            .catch(() => { /* non-fatal: no best shown */ });
        return () => {
            cancelled = true;
        };
    }, [isAuthenticated, language, game, modeKey]);

    /** Submit a finished run once. Resolves to whether it set a new best. */
    const record = useCallback(
        async (value: number): Promise<boolean> => {
            if (!isAuthenticated || !modeKey || recordedRef.current) return false;
            recordedRef.current = true;
            try {
                const res = await submitPersonalBest(language, game, modeKey, value);
                setBest(res.best.bestValue);
                setPreviousBest(res.previousValue);
                setIsNewBest(res.isNewBest);
                return res.isNewBest;
            } catch (err) {
                console.warn(`[PersonalBest] submit failed (${game}/${modeKey})`, err);
                return false;
            }
        },
        [isAuthenticated, language, game, modeKey],
    );

    /** A new run is starting (Play Again): allow the next record, drop the celebration. */
    const reset = useCallback(() => {
        recordedRef.current = false;
        setIsNewBest(false);
    }, []);

    return { best, previousBest, isNewBest, record, reset };
}
