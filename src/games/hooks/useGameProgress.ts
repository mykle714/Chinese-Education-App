import { useCallback, useEffect, useState } from "react";
import apiClient from "../../utils/apiClient";
import { useAuth } from "../../AuthContext";
import type { GameProgress } from "../types";

export interface UseGameProgressResult<TState = Record<string, unknown>> {
    progress: GameProgress | null;
    loading: boolean;
    error: Error | null;
    save: (state: TState) => Promise<void>;
}

/**
 * Fetches and persists per-user save state for a single game.
 *
 * For unauthenticated / public demo accounts this hook is a no-op: it returns
 * `progress = null` and a `save` that resolves without making a request. That
 * lets games run without persistence in demo contexts while still using the
 * same hook signature in code.
 */
export function useGameProgress<TState extends Record<string, unknown> = Record<string, unknown>>(
    gameId: string | null | undefined
): UseGameProgressResult<TState> {
    const { isAuthenticated, user } = useAuth();
    const canPersist = Boolean(isAuthenticated && user && !user.isPublic && gameId);

    const [progress, setProgress] = useState<GameProgress | null>(null);
    const [loading, setLoading] = useState(false);
    const [error, setError] = useState<Error | null>(null);

    useEffect(() => {
        if (!canPersist || !gameId) {
            setProgress(null);
            return;
        }
        let cancelled = false;

        setLoading(true);
        setError(null);

        apiClient
            .get<{ gameId: string; progress: GameProgress | null }>(`/api/games/${encodeURIComponent(gameId)}/progress`)
            .then((res) => {
                if (cancelled) return;
                setProgress(res.data?.progress ?? null);
            })
            .catch((err) => {
                if (cancelled) return;
                setError(err instanceof Error ? err : new Error(String(err)));
            })
            .finally(() => {
                if (cancelled) return;
                setLoading(false);
            });

        return () => {
            cancelled = true;
        };
    }, [gameId, canPersist]);

    const save = useCallback(
        async (state: TState) => {
            if (!canPersist || !gameId) return;
            try {
                const res = await apiClient.post<{ gameId: string; progress: GameProgress }>(
                    `/api/games/${encodeURIComponent(gameId)}/progress`,
                    { state }
                );
                setProgress(res.data?.progress ?? null);
            } catch (err) {
                setError(err instanceof Error ? err : new Error(String(err)));
                throw err;
            }
        },
        [gameId, canPersist]
    );

    return { progress, loading, error, save };
}
