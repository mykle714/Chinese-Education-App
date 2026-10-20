import type { GamePoolDistribution, GamePoolRequest } from "../../api/gamePool";
import type { CollectionRef } from "../../features/flashcards/collectionRef";
import { MARK_TYPE } from "./constants";

/**
 * The one builder for every Match Speed pool request — the opening board, each buffer
 * top-up, and the flp game break's prefetch (src/games/flpBreak/matchSpeedBreak.ts).
 * Pure, so the stage and the prefetch cannot drift on `markType` / `surface`.
 *
 * Referenced by: MatchSpeedStage (`fetchPool`), flpBreak/matchSpeedBreak.ts.
 * Docs: docs/MATCH_SPEED_GAME.md, docs/FLP_GAME_BREAKS.md § 4.
 */
export function matchSpeedPoolRequest(args: {
    distribution: GamePoolDistribution;
    /** On board + buffered ids — a duplicate-on-screen guard, not a repeat gate. */
    exclude?: number[];
    collection: CollectionRef | null;
    challengeParams?: string;
    /** Mid-run challenge top-ups are filler only (docs/STUDY_CHALLENGE.md § 5.3). */
    excludeContested?: boolean;
    /** An flp game break's working loop; opening board only (docs/FLP_GAME_BREAKS.md § 4). */
    seedIds?: number[];
}): GamePoolRequest {
    // NOTE: no `need`, even on a top-up — so the server treats every top-up as a full
    // board and re-runs the baseline check (`ensureBaseline`) each tick. Preserved as-is
    // from the hand-built query; see docs/MATCH_SPEED_GAME.md.
    return {
        markType: MARK_TYPE,
        surface: "match-speed",
        distribution: args.distribution,
        exclude: args.exclude,
        collection: args.collection,
        challengeParams: args.challengeParams,
        excludeContested: args.excludeContested,
        seedIds: args.seedIds,
    };
}
