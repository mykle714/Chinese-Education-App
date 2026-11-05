import type { WordSearchGridRequest } from "../../api/wordSearchGrid";
import { WORD_SEARCH_BOARDS, type WordSearchBoardId } from "../../../server/contracts/wire";

/**
 * The one builder for every Word Search grid request — a Stage's own deal and the flp
 * game break's prefetch (src/games/flpBreak/wordSearchBreak.ts). Pure, so the two cannot
 * drift on `distribution`. The board decides the band quotas.
 *
 * Referenced by: WordSearchStage (`fetchGrid`), flpBreak/wordSearchBreak.ts.
 * Docs: docs/WORD_SEARCH_GAME.md, docs/FLP_GAME_BREAKS.md § 4.
 */
export function wordSearchGridRequest(args: {
    mode: string;
    challengeParams?: string;
    /** An flp game break's working loop. */
    seedIds?: number[];
    /** This run is an flp game break. */
    flpBreak?: boolean;
    /** Which grid to deal on. Default `standard`. */
    board?: WordSearchBoardId;
}): WordSearchGridRequest {
    const board = args.board ?? "standard";
    return {
        mode: args.mode,
        board,
        distribution: WORD_SEARCH_BOARDS[board].distribution,
        challengeParams: args.challengeParams,
        seedIds: args.seedIds,
        flpBreak: args.flpBreak,
    };
}
