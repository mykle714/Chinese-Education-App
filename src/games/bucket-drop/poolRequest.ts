import type { GamePoolRequest } from "../../api/gamePool";
import type { CollectionRef } from "../../features/flashcards/collectionRef";
import type { MarkType } from "../../types";
import { GAME_DISTRIBUTION, GAME_ID } from "./constants";

/**
 * The one builder for a Bucket Drop pool request: the Stage's own fetch and the flp game
 * break's prefetch (src/games/flpBreak/bucketDropBreak.ts). Pure, so the two cannot drift
 * on `surface` / `distribution`. A run is one board, so there are no top-ups.
 *
 * Referenced by: BucketDropStage (`fetchPool`), flpBreak/bucketDropBreak.ts.
 * Docs: docs/BUCKET_DROP_GAME.md, docs/FLP_GAME_BREAKS.md § 4.
 */
export function bucketDropPoolRequest(args: {
    /** The run's track: the pool is bucketed and cooled on it. */
    markType: MarkType;
    collection: CollectionRef | null;
    challengeParams?: string;
    /** An flp game break's working loop (docs/FLP_GAME_BREAKS.md § 4). */
    seedIds?: number[];
    /** This run is an flp game break (docs/FOCUS_MODE.md § 4a). */
    flpBreak?: boolean;
}): GamePoolRequest {
    return {
        markType: args.markType,
        surface: GAME_ID,
        distribution: GAME_DISTRIBUTION,
        collection: args.collection,
        challengeParams: args.challengeParams,
        seedIds: args.seedIds,
        flpBreak: args.flpBreak,
    };
}
