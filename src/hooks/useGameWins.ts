import { useCallback, useEffect, useState } from "react";
import { useAuth } from "../AuthContext";
import { apiGet, apiPost } from "../api/http";

/** Shape returned by GET /api/users/me/wins. */
interface WinsResponse {
    weekly?: Array<{ game: string; level: string }>;
    lifetime?: Record<string, Record<string, number>>;
}

/**
 * Per-level "cleared this week" (⭐) and lifetime win counts for a single game,
 * backed by the shared `wins` table (GET/POST /api/users/me/wins). Extracted
 * out of BubbleMatchPage so the Games hub can show the same badges on its
 * level sub-cards without duplicating the fetch — both call this with the
 * same `gameKey`.
 *
 * Two granularities are exposed on purpose (see docs/HUB_MENU_SYSTEM.md):
 *   - `clearedLevels` / `lifetimeWins` — per level/mode, keyed by level number.
 *   - `totalWins` — the game-wide sum, which is what the hub now DISPLAYS as a
 *     single "×N" on the strip's group header. Per-level counts stay available
 *     for callers that want them, but no UI renders them today.
 */
export function useGameWins(gameKey: string) {
    const { isAuthenticated } = useAuth();
    const [clearedLevels, setClearedLevels] = useState<Set<number>>(new Set());
    const [lifetimeWins, setLifetimeWins] = useState<Record<number, number>>({});

    useEffect(() => {
        if (!isAuthenticated) return;
        let cancelled = false;
        (async () => {
            try {
                const data = await apiGet<WinsResponse>("/api/users/me/wins");
                if (cancelled) return;

                const levels = (data.weekly ?? [])
                    .filter((w) => w.game === gameKey)
                    .map((w) => Number(w.level))
                    .filter((lv) => Number.isFinite(lv));
                setClearedLevels(new Set(levels));

                const counts: Record<number, number> = {};
                for (const [lvStr, count] of Object.entries(data.lifetime?.[gameKey] ?? {})) {
                    const lv = Number(lvStr);
                    if (Number.isFinite(lv)) counts[lv] = count;
                }
                setLifetimeWins(counts);
            } catch {
                /* leave badges empty */
            }
        })();
        return () => {
            cancelled = true;
        };
    // Keyed on isAuthenticated — the STABLE auth identity — not the raw `token`,
    // which rotates every ~15 min. Keying on `token` re-ran this effect on every
    // silent refresh, wiping and refetching the badges mid-session.
    // See CLAUDE.md "Never reload on token refresh".
    }, [isAuthenticated, gameKey]);

    // Log one win for the given level. Fire-and-forget, with an optimistic local
    // update so the ⭐/×N reflect it immediately (the server is the source of
    // truth on next load).
    const recordWin = useCallback(
        (level: number) => {
            setClearedLevels((prev) => new Set(prev).add(level));
            setLifetimeWins((prev) => ({ ...prev, [level]: (prev[level] ?? 0) + 1 }));
            apiPost("/api/users/me/wins", { game: gameKey, level })
                .catch((err) => console.error(`[useGameWins] win L${level} record failed:`, err));
        },
        // No `token` dep: apiPost reads the header at call time, so this callback's
        // identity survives a silent refresh.
        [gameKey]
    );

    // Game-wide lifetime total, aggregated across every level/mode bucket. This
    // is the number the Games hub shows — a player thinks in "I've won Bubble
    // Match 12 times", not "4 on Easy, 5 on Medium, 3 on Hard".
    const totalWins = Object.values(lifetimeWins).reduce((sum, n) => sum + n, 0);

    return { clearedLevels, lifetimeWins, totalWins, recordWin };
}
