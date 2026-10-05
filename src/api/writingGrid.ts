/**
 * Writing Grid — client API (docs/WRITING_PRACTICE_REWORK.md § 2).
 * Server: GET /api/writingGrid/deal (WritingGridController → WritingGridService).
 */
import { apiGet } from "./http";
import type { WritingGridCharacter } from "../../server/contracts/writingGrid";

export type { WritingGridCharacter };

/** Deal one board: up to 8 characters, each with the single-character card a check marks. */
export async function dealWritingGrid(): Promise<WritingGridCharacter[]> {
    const data = await apiGet<{ characters?: WritingGridCharacter[] }>("/api/writingGrid/deal");
    return Array.isArray(data?.characters) ? data.characters : [];
}
