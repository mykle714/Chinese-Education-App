import { useCallback, useEffect, useState } from "react";
import { useAuth } from "../AuthContext";
import { API_BASE_URL } from "../constants";

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
 */
export function useGameWins(gameKey: string) {
    const { token } = useAuth();
    const [clearedLevels, setClearedLevels] = useState<Set<number>>(new Set());
    const [lifetimeWins, setLifetimeWins] = useState<Record<number, number>>({});

    useEffect(() => {
        if (!token) return;
        let cancelled = false;
        (async () => {
            try {
                const res = await fetch(`${API_BASE_URL}/api/users/me/wins`, {
                    credentials: "include",
                    headers: { Authorization: `Bearer ${token}` },
                });
                if (!res.ok) return;
                const data: WinsResponse = await res.json();
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
    }, [token, gameKey]);

    // Log one win for the given level. Fire-and-forget, with an optimistic local
    // update so the ⭐/×N reflect it immediately (the server is the source of
    // truth on next load).
    const recordWin = useCallback(
        (level: number) => {
            setClearedLevels((prev) => new Set(prev).add(level));
            setLifetimeWins((prev) => ({ ...prev, [level]: (prev[level] ?? 0) + 1 }));
            const headers: HeadersInit = { "Content-Type": "application/json" };
            if (token && token !== "null" && token !== "undefined") {
                headers["Authorization"] = `Bearer ${token}`;
            }
            fetch(`${API_BASE_URL}/api/users/me/wins`, {
                method: "POST",
                headers,
                credentials: "include",
                body: JSON.stringify({ game: gameKey, level }),
            }).catch((err) => console.error(`[useGameWins] win L${level} record failed:`, err));
        },
        [token, gameKey]
    );

    return { clearedLevels, lifetimeWins, recordWin };
}
