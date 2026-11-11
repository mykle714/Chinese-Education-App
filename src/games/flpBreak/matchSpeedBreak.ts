import { lazyWithPreload } from "../runtime/lazyWithPreload";
import { fetchGamePool, type GamePoolResponse } from "../../api/gamePool";
import { POOL_DISTRIBUTION } from "../match-speed/constants";
import { matchSpeedPoolRequest } from "../match-speed/poolRequest";
import type { FlpBreakGame } from "./types";

/**
 * Match Speed as an flp game break (docs/FLP_GAME_BREAKS.md § 6). The first game
 * extracted into a Stage; the template for the rest.
 *
 * The break deals the game's one (Study Mix) distribution, `POOL_DISTRIBUTION`.
 *
 * Offered on the core flp (pinyin shown, marks `recognition`) and on the reading flp
 * (pinyin hidden, marks `reading` via the registry's `noPinyinMarkType`). The candidate's
 * `markType` rides both the prefetch and the Stage, so pool and marks agree.
 */
export const MATCH_SPEED_BREAK: FlpBreakGame<GamePoolResponse> = {
    gameId: "match-speed",
    rulesLine: "Match each word to its meaning — finish all 30 pairs as fast as you can.",
    prefetch: (candidate, context) =>
        fetchGamePool(matchSpeedPoolRequest({
            // recognition on the core flp, reading on the reading flp (`noPinyinMarkType`).
            markType: candidate.markType,
            distribution: POOL_DISTRIBUTION,
            seedIds: context.seedIds,
            flpBreak: true,
        })),
    Stage: lazyWithPreload(() => import("./MatchSpeedBreakStage")),
};
