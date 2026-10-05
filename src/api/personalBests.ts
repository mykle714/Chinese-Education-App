/**
 * Personal bests — client API (docs/WRITING_PRACTICE_REWORK.md § 2a).
 * Server: GET/POST /api/users/me/personal-bests (PersonalBestController).
 * Which games keep one, and which way is better: server/contracts/personalBests.ts.
 */
import { apiGet, apiPost } from "./http";
import type {
    PersonalBestGame,
    PersonalBestRecord,
    SubmitPersonalBestResponse,
} from "../../server/contracts/personalBests";

export type { PersonalBestGame, PersonalBestRecord, SubmitPersonalBestResponse };

/** Every best this learner holds for `game` in `language`. */
export async function fetchPersonalBests(language: string, game: PersonalBestGame): Promise<PersonalBestRecord[]> {
    const data = await apiGet<{ bests?: PersonalBestRecord[] }>("/api/users/me/personal-bests", {
        params: { language, game },
    });
    return Array.isArray(data?.bests) ? data.bests : [];
}

/** Submit one finished run; the server keeps it only if it beats the stored best. */
export function submitPersonalBest(
    language: string,
    game: PersonalBestGame,
    mode: string,
    value: number
): Promise<SubmitPersonalBestResponse> {
    return apiPost<SubmitPersonalBestResponse>("/api/users/me/personal-bests", { language, game, mode, value });
}
