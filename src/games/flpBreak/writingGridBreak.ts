import { lazy } from "react";
import { dealWritingGrid, type WritingGridCharacter, type WritingGridDealRequest } from "../../api/writingGrid";
import type { FlpBreakContext, FlpBreakGame } from "./types";

/**
 * A break's deal. The focus rule applies to an unrestricted session only, because a
 * hand-picked set ignores focus (docs/FOCUS_MODE.md § 4), so a deck session omits `flpBreak`.
 * A deck session's seed is its own words, but the rest of the board is not narrowed to the
 * deck: the deal has no collection (docs/FLP_GAME_BREAKS.md § 4).
 */
export function writingGridBreakRequest(context: FlpBreakContext): WritingGridDealRequest {
    return { seedIds: context.seedIds, flpBreak: context.collection === null };
}

/**
 * Writing Grid as an flp game break (docs/FLP_GAME_BREAKS.md § 6), the writing flp's game.
 * The grid has no modes, so the flp's study mode does not reach it (§ 4).
 */
export const WRITING_GRID_BREAK: FlpBreakGame<WritingGridCharacter[]> = {
    gameId: "writing-grid",
    rulesLine: "Sort eight characters by difficulty, then write them all.",
    prefetch: (_candidate, context) => dealWritingGrid(writingGridBreakRequest(context)),
    isPlayable: (cells) => cells.length > 0,
    Stage: lazy(() => import("./WritingGridBreakStage")),
};
