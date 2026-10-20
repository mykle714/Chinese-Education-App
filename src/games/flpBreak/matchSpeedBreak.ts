import { lazy } from "react";
import { fetchGamePool, type GamePoolResponse } from "../../api/gamePool";
import { MEDAL_THRESHOLDS, modeConfigFor } from "../match-speed/constants";
import { matchSpeedPoolRequest } from "../match-speed/poolRequest";
import type { FlpBreakGame } from "./types";

/**
 * Match Speed as an flp game break (docs/FLP_GAME_BREAKS.md § 6). The first game
 * extracted into a Stage; the template for the rest.
 *
 * The flp's study mode maps straight onto Match Speed's modes — both use the slugs
 * `review` / `challenge`, and anything else is Mix (`modeConfigFor`) — so the top-up
 * honours the session's distribution (§ 4) with no translation table.
 */
export const MATCH_SPEED_BREAK: FlpBreakGame<GamePoolResponse> = {
    gameId: "match-speed",
    rulesLine: "Match each word to its meaning — as many pairs as you can in 30 seconds.",
    medalLine: () => `${MEDAL_THRESHOLDS.map((t) => `${t.emoji} ${t.minPairs}`).join(" · ")} pairs`,
    // Same key the standalone game uses, so a break run and a hub run compete for one
    // best per mode (docs/MATCH_SPEED_GAME.md § Personal best).
    personalBest: (_candidate, context) => ({
        game: "match-speed",
        mode: modeConfigFor(context.studyMode).mode,
        unitLabel: "pairs",
    }),
    prefetch: (_candidate, context) =>
        fetchGamePool(matchSpeedPoolRequest({
            distribution: modeConfigFor(context.studyMode).poolDistribution,
            collection: context.collection,
            seedIds: context.seedIds,
        })),
    Stage: lazy(() => import("./MatchSpeedBreakStage")),
};
