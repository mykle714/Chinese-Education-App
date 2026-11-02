import { lazy } from "react";
import { fetchWordSearchGrid } from "../../api/wordSearchGrid";
import { wordSearchGridRequest } from "../word-search/gridRequest";
import type { WordSearchResponse } from "../word-search/types";
import { WORD_SEARCH_BOARDS, type WordSearchBoardId } from "../../../server/contracts/wire";
import type { FlpBreakContext, FlpBreakGame } from "./types";

/** A Deck Tower session plays the compact board; a routed flp plays the game's own. */
export function wordSearchBreakBoard(context: FlpBreakContext): WordSearchBoardId {
    return context.towerSession ? "compact" : "standard";
}

/**
 * Word Search as an flp game break (docs/FLP_GAME_BREAKS.md § 6).
 *
 * The candidate's mode IS the board: Pinyin on the core flp (production), No Pinyin on the
 * reading flp (reading). Word Search has no review / challenge modes, so the flp's study
 * mode does not reach the grid (§ 4).
 */
export const WORD_SEARCH_BREAK: FlpBreakGame<WordSearchResponse> = {
    gameId: "word-search",
    rulesLine: "Trace every hidden word in the grid as fast as you can.",
    prefetch: (candidate, context) =>
        fetchWordSearchGrid(wordSearchGridRequest({
            mode: candidate.mode ?? "pinyin",
            collection: context.collection,
            seedIds: context.seedIds,
            flpBreak: true,
            board: wordSearchBreakBoard(context),
        })),
    // A grid can fail where a card count passes: it needs short words, none inside another.
    isPlayable: (board) => board.sufficient && board.grid !== null,
    focusMinimum: (context) => WORD_SEARCH_BOARDS[wordSearchBreakBoard(context)].words,
    Stage: lazy(() => import("./WordSearchBreakStage")),
};
