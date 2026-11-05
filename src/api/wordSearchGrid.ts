/**
 * wordSearchGrid.ts — the client's one typed call against GET /api/onDeck/wordSearchGrid.
 *
 * Server: `OnDeckVocabController.getWordSearchGrid` → `OnDeckVocabService.getWordSearchGrid`.
 * The grid is dealt whole, so unlike gamePool there is no `need` / `exclude`.
 *
 * Referenced by: games/word-search/WordSearchStage.tsx, games/flpBreak/wordSearchBreak.ts.
 * Docs: docs/WORD_SEARCH_GAME.md, docs/FLP_GAME_BREAKS.md § 4.
 */
import { apiGet, type QueryParams } from './http';
import type { GamePoolDistribution } from './gamePool';
import type { WordSearchResponse } from '../games/word-search/types';
import type { WordSearchBoardId } from '../../server/contracts/wire';

export interface WordSearchGridRequest {
    /** The board mode. It decides which mastery track buckets and cools the words. */
    mode: string;
    /** The grid to deal on. Omitted or `standard` sends nothing: it is the server's default. */
    board?: WordSearchBoardId;
    /** Band quotas. */
    distribution: GamePoolDistribution;
    /** `useChallengeRound().poolParams`, the `&`-prefixed suffix, passed through verbatim. */
    challengeParams?: string;
    /** An flp game break's working loop (docs/FLP_GAME_BREAKS.md § 4). */
    seedIds?: number[];
    /** This request deals an flp game break (docs/FOCUS_MODE.md § 4a). */
    flpBreak?: boolean;
}

/**
 * Pure: the request → its querystring params. Exported for tests.
 *
 * A challenge round's params go on last so its own `mode` REPLACES the board's: one key,
 * never two. Express parses a repeated `mode` into an array, which fails
 * `resolveChallengeRound`'s check and 400s every challenge launch.
 */
export function wordSearchGridParams(req: WordSearchGridRequest): QueryParams {
    const params: QueryParams = { mode: req.mode };
    for (const [cat, n] of Object.entries(req.distribution)) params[cat] = n;
    if (req.seedIds?.length) params.seedIds = req.seedIds.join(',');
    if (req.flpBreak) params.flpBreak = 1;
    if (req.board && req.board !== 'standard') params.board = req.board;
    if (req.challengeParams) {
        for (const [key, value] of new URLSearchParams(req.challengeParams.replace(/^&/, ''))) {
            params[key] = value;
        }
    }
    return params;
}

/** GET /api/onDeck/wordSearchGrid. Throws `ApiError` on non-2xx (see api/http.ts). */
export function fetchWordSearchGrid(req: WordSearchGridRequest): Promise<WordSearchResponse> {
    return apiGet<WordSearchResponse>('/api/onDeck/wordSearchGrid', { params: wordSearchGridParams(req) });
}
