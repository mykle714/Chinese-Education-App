/**
 * Superposition — client API (docs/SUPERPOSITION_GAME.md).
 * Server: GET /api/superposition/deal (SuperpositionController → SuperpositionService).
 * Referenced by: games/superposition/SuperpositionStage.tsx, games/flpBreak/superpositionBreak.ts.
 */
import { apiGet } from "./http";
import type { SuperpositionWord } from "../../server/contracts/superposition";
import type { WritingGridDealRequest } from "./writingGrid";

export type { SuperpositionWord };

/** Deal one board: words that hold four distinct characters between them. */
export async function dealSuperposition(request: WritingGridDealRequest = {}): Promise<SuperpositionWord[]> {
    const params: Record<string, string | number> = {};
    if (request.seedIds?.length) params.seedIds = request.seedIds.join(",");
    if (request.flpBreak) params.flpBreak = 1;
    const data = await apiGet<{ words?: SuperpositionWord[] }>("/api/superposition/deal", { params });
    return Array.isArray(data?.words) ? data.words : [];
}
