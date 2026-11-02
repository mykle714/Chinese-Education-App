/**
 * Writing Grid — client API (docs/WRITING_PRACTICE_REWORK.md § 2).
 * Server: GET /api/writingGrid/deal (WritingGridController → WritingGridService).
 * Referenced by: games/writing-grid/WritingGridStage.tsx, games/flpBreak/writingGridBreak.ts.
 */
import { apiGet } from "./http";
import type { WritingGridCharacter } from "../../server/contracts/writingGrid";

export type { WritingGridCharacter };

/** An flp game break's additions to a deal (docs/FLP_GAME_BREAKS.md § 4). */
export interface WritingGridDealRequest {
    /** The working loop's vet ids: their characters go on the board first. */
    seedIds?: number[];
    /** An unrestricted break: a focused world deals from outside today's set. */
    flpBreak?: boolean;
}

/** Deal one board: up to 8 characters, each with the single-character card a check marks. */
export async function dealWritingGrid(request: WritingGridDealRequest = {}): Promise<WritingGridCharacter[]> {
    const params: Record<string, string | number> = {};
    if (request.seedIds?.length) params.seedIds = request.seedIds.join(",");
    if (request.flpBreak) params.flpBreak = 1;
    const data = await apiGet<{ characters?: WritingGridCharacter[] }>("/api/writingGrid/deal", { params });
    return Array.isArray(data?.characters) ? data.characters : [];
}
