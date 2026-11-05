import { lazy } from "react";
import { dealWritingGrid, type WritingGridCharacter, type WritingGridDealRequest } from "../../api/writingGrid";
import type { FlpBreakContext, FlpBreakGame } from "./types";

/**
 * A break's deal: the working loop as the seed, and `flpBreak` so the server applies the
 * focus rule (docs/FOCUS_MODE.md § 4a). Every flp session is unrestricted (no deck or
 * collection launch any more), so the flag is always sent.
 */
export function writingGridBreakRequest(context: FlpBreakContext): WritingGridDealRequest {
    return { seedIds: context.seedIds, flpBreak: true };
}

/**
 * Writing Grid as an flp game break (docs/FLP_GAME_BREAKS.md § 6), the writing flp's game.
 */
export const WRITING_GRID_BREAK: FlpBreakGame<WritingGridCharacter[]> = {
    gameId: "writing-grid",
    rulesLine: "Sort eight characters by difficulty, then write them all.",
    prefetch: (_candidate, context) => dealWritingGrid(writingGridBreakRequest(context)),
    isPlayable: (cells) => cells.length > 0,
    Stage: lazy(() => import("./WritingGridBreakStage")),
};
