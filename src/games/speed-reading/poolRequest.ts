import type { GamePoolRequest } from "../../api/gamePool";
import { GAME_DISTRIBUTION, MARK_TYPE } from "./constants";

/**
 * The one builder for every Speed Reading pool request: the opening batch, each mid-run
 * top-up, and the flp game break's prefetch (src/games/flpBreak/speedReadingBreak.ts).
 * Pure, so the Stage and the prefetch cannot drift on `markType` / `surface` /
 * `distribution`.
 *
 * `markType` is always `reading`: Speed Reading has no pinyin mode, so the reading flp's
 * track and the game's own are the same.
 *
 * Referenced by: `useSpeedReadingQueue` (`fetchPool`), flpBreak/speedReadingBreak.ts.
 * Docs: docs/SPEED_READING_GAME.md § Card selection, docs/FLP_GAME_BREAKS.md § 4.
 */
export function speedReadingPoolRequest(args: {
    /** Partial refill size. Present = top-up semantics (no baseline lending). */
    need?: number;
    /** Ids still queued or reserved for the finale, so a refill can't repeat one. */
    exclude?: number[];
    /** An flp game break's working loop; opening batch only (docs/FLP_GAME_BREAKS.md § 4). */
    seedIds?: number[];
    /** This run is an flp game break, on every request (docs/FOCUS_MODE.md § 4a). */
    flpBreak?: boolean;
}): GamePoolRequest {
    return {
        markType: MARK_TYPE,
        // Names the baseline the server tops the player up to before building the pool,
        // so a small deck is filled with temporary cards instead of blocking
        // (docs/PROVISIONAL_CARDS.md). Sent on top-ups too: `need` alone already stops a
        // refill from lending (src/api/gamePool.ts).
        surface: "speed-reading",
        distribution: GAME_DISTRIBUTION,
        need: args.need,
        exclude: args.exclude,
        seedIds: args.seedIds,
        flpBreak: args.flpBreak,
    };
}
