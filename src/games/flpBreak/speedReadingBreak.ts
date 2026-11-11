import { lazyWithPreload } from "../runtime/lazyWithPreload";
import { fetchGamePool } from "../../api/gamePool";
import { fetchSpeedReadingDistractors } from "../../api/speedReading";
import { speedReadingPoolRequest } from "../speed-reading/poolRequest";
import type { SpeedReadingOpening } from "../speed-reading/useSpeedReadingQueue";
import type { FlpBreakGame } from "./types";

/**
 * Speed Reading as an flp game break (docs/FLP_GAME_BREAKS.md § 6), on the reading flp
 * (zh only, via the registry's `languages`).
 *
 * The prefetch is the run's whole opening supply: the seeded pool AND the distractor
 * characters, so Play has no spinner. The game deals its own distribution (§ 4).
 *
 * The break plays the game's full 20 rounds (the last one a sentence), so the speed tier
 * and the personal best grade the same course on every run.
 *
 * `sideways`: the game is played landscape, so the break's card and its results card
 * turn with it (§ 5, § 5b).
 */
export const SPEED_READING_BREAK: FlpBreakGame<SpeedReadingOpening> = {
    gameId: "speed-reading",
    rulesLine: "Tap the side with the real word — all 20 as fast as you can.",
    sideways: true,
    prefetch: async (_candidate, context) => {
        const [pool, distractors] = await Promise.all([
            fetchGamePool(speedReadingPoolRequest({
                seedIds: context.seedIds,
                flpBreak: true,
            })),
            fetchSpeedReadingDistractors(),
        ]);
        return { pool, distractors };
    },
    // An empty pool would open straight onto the blocked screen; pick another game instead.
    isPlayable: (opening) => opening.pool.cards.length > 0 && opening.distractors.length > 0,
    Stage: lazyWithPreload(() => import("./SpeedReadingBreakStage")),
};
