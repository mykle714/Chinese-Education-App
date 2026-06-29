import { useEffect, useState } from "react";
import { apiGet } from "../../api/http";
import type { GameAsset } from "../types";

export interface UseGameAssetsResult {
    assets: GameAsset[];
    loading: boolean;
    error: Error | null;
}

/**
 * Fetches the asset registry rows for a single game from
 * `/api/games/:gameId/assets`. Consumed by `GameStage` to drive texture
 * preload, and by individual games for any per-asset metadata they store.
 */
export function useGameAssets(gameId: string | null | undefined): UseGameAssetsResult {
    const [assets, setAssets] = useState<GameAsset[]>([]);
    const [loading, setLoading] = useState(false);
    const [error, setError] = useState<Error | null>(null);

    useEffect(() => {
        if (!gameId) {
            setAssets([]);
            return;
        }
        let cancelled = false;

        setLoading(true);
        setError(null);

        apiGet<{ gameId: string; assets: GameAsset[] }>(`/api/games/${encodeURIComponent(gameId)}/assets`)
            .then((data) => {
                if (cancelled) return;
                setAssets(data?.assets ?? []);
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
    }, [gameId]);

    return { assets, loading, error };
}
