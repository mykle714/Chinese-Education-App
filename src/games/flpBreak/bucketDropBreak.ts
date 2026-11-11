import { lazyWithPreload } from "../runtime/lazyWithPreload";
import { fetchGamePool, type GamePoolResponse } from "../../api/gamePool";
import { bucketDropPoolRequest } from "../bucket-drop/poolRequest";
import type { FlpBreakGame } from "./types";

/**
 * Bucket Drop as an flp game break (docs/FLP_GAME_BREAKS.md § 6).
 *
 * The candidate's mode IS the board: Pinyin on the core flp (production), No Pinyin on the
 * reading flp (reading).
 */
export const BUCKET_DROP_BREAK: FlpBreakGame<GamePoolResponse> = {
    gameId: "bucket-drop",
    rulesLine: "Drag each word into the bucket holding its meaning, as fast as you can.",
    prefetch: (candidate, context) =>
        fetchGamePool(bucketDropPoolRequest({
            markType: candidate.markType,
            seedIds: context.seedIds,
            flpBreak: true,
        })),
    // Defensive: a pool with no cards would open onto a dead board; pick another game.
    isPlayable: (pool) => pool.cards.length > 0,
    // A reading run tests the pronunciation, which narration would hand over — the rule
    // Bubble Match's and Bucket Drop's own header chips follow (docs/AUDIO_PLAYBACK.md).
    hidesAudioChip: (candidate) => candidate.markType === "reading",
    Stage: lazyWithPreload(() => import("./BucketDropBreakStage")),
};
