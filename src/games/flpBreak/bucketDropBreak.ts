import { lazy } from "react";
import { fetchGamePool, type GamePoolResponse } from "../../api/gamePool";
import { bucketDropPoolRequest } from "../bucket-drop/poolRequest";
import type { FlpBreakGame } from "./types";

/**
 * Bucket Drop as an flp game break (docs/FLP_GAME_BREAKS.md § 6).
 *
 * The candidate's mode IS the board: Pinyin on the core flp (production), No Pinyin on the
 * reading flp (reading). Bucket Drop has no review / challenge modes, so the flp's study
 * mode does not reach the pool (§ 4).
 */
export const BUCKET_DROP_BREAK: FlpBreakGame<GamePoolResponse> = {
    gameId: "bucket-drop",
    rulesLine: "Drag each word into the bucket holding its meaning, as fast as you can.",
    prefetch: (candidate, context) =>
        fetchGamePool(bucketDropPoolRequest({
            markType: candidate.markType,
            collection: context.collection,
            seedIds: context.seedIds,
            flpBreak: true,
        })),
    // Lending cannot run under a collection filter, so a pool can come back empty.
    isPlayable: (pool) => pool.cards.length > 0,
    Stage: lazy(() => import("./BucketDropBreakStage")),
};
