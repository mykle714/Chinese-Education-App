/**
 * wordOfTheDay.ts — the client's typed call against
 * `GET /api/dictionary/word-of-the-day`, the global Word of the Day shown at the top of
 * both Mastery Centers (docs/READING_WRITING_CENTERS.md § Phase 3).
 *
 * Per docs/FRONTEND_LAYERING.md §3.2 this takes NO `token`: it goes through
 * src/api/http.ts, which resolves the Authorization header at call time.
 */
import { apiGet } from './http';
import type { WordOfTheDay } from '../../server/contracts/wordOfTheDay';

export type { WordOfTheDay, WordOfTheDayPart, WordOfTheDayContent } from '../../server/contracts/wordOfTheDay';

/** The learner's LOCAL calendar date as YYYY-MM-DD — the key the word is pinned under. */
export function localDayKey(now: Date = new Date()): string {
    const pad = (n: number) => String(n).padStart(2, "0");
    return `${now.getFullYear()}-${pad(now.getMonth() + 1)}-${pad(now.getDate())}`;
}

/** Fetch the word for the learner's local date. */
export function fetchWordOfTheDay(day: string = localDayKey()): Promise<WordOfTheDay> {
    return apiGet<WordOfTheDay>("/api/dictionary/word-of-the-day", { params: { day } });
}
