import type { GamePoolDistribution, GamePoolRequest } from "../../api/gamePool";
import type { MarkType } from "../../types";
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
    /** The run's track — `MARK_TYPE` (recognition) unless an flp break on the reading
        flp passes `reading` (docs/FLP_GAME_BREAKS.md § 3). Omitted ⇒ `MARK_TYPE`. */
    markType?: MarkType;
    distribution: GamePoolDistribution;
    /** On board + buffered ids — a duplicate-on-screen guard, not a repeat gate. */
    exclude?: number[];
    challengeParams?: string;
    /** Mid-run challenge top-ups are filler only (docs/STUDY_CHALLENGE.md § 5.3). */
    excludeContested?: boolean;
    /** An flp game break's working loop; opening board only (docs/FLP_GAME_BREAKS.md § 4). */
    seedIds?: number[];
    /** This run is an flp game break, on every request (docs/FOCUS_MODE.md § 4a). */
    flpBreak?: boolean;
}): GamePoolRequest {
    // NOTE: no `need`, even on a top-up — so the server treats every top-up as a full
    // board and re-runs the baseline check (`ensureBaseline`) each tick. Preserved as-is
    // from the hand-built query; see docs/MATCH_SPEED_GAME.md.
    return {
        markType: args.markType ?? MARK_TYPE,
        surface: "match-speed",
        distribution: args.distribution,
        exclude: args.exclude,
        challengeParams: args.challengeParams,
        excludeContested: args.excludeContested,
        seedIds: args.seedIds,
        flpBreak: args.flpBreak,
    };
}
