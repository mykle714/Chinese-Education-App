import { lazy } from "react";
import { fetchWordSearchGrid } from "../../api/wordSearchGrid";
import { wordSearchGridRequest } from "../word-search/gridRequest";
import type { WordSearchResponse } from "../word-search/types";
import { WORD_SEARCH_BOARDS, type WordSearchBoardId } from "../../../server/contracts/wire";
import type { FlpBreakGame } from "./types";

/**
 * A break always deals the compact board: the flp runs only inside the Deck Tower, whose
 * card-sized break layer fits five columns. The game's `standard` board stays for the
 * /games hub and Study Challenge (WORD_SEARCH_BOARDS in server/contracts/wire.ts).
 */
export const WORD_SEARCH_BREAK_BOARD: WordSearchBoardId = "compact";

/**
 * Word Search as an flp game break (docs/FLP_GAME_BREAKS.md § 6).
 *
 * The candidate's mode IS the board: Pinyin on the core flp (production), No Pinyin on the
 * reading flp (reading).
 */
export const WORD_SEARCH_BREAK: FlpBreakGame<WordSearchResponse> = {
    gameId: "word-search",
    rulesLine: "Trace every hidden word in the grid as fast as you can.",
    prefetch: (candidate, context) =>
        fetchWordSearchGrid(wordSearchGridRequest({
            mode: candidate.mode ?? "pinyin",
            seedIds: context.seedIds,
            flpBreak: true,
            board: WORD_SEARCH_BREAK_BOARD,
        })),
    // A grid can fail where a card count passes: it needs short words, none inside another.
    isPlayable: (board) => board.sufficient && board.grid !== null,
    focusMinimum: () => WORD_SEARCH_BOARDS[WORD_SEARCH_BREAK_BOARD].words,
    Stage: lazy(() => import("./WordSearchBreakStage")),
};
