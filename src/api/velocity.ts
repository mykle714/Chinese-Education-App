/**
 * velocity.ts — the client's typed call against `GET /api/users/me/velocity`.
 *
 * VELOCITY is the number of utcm band-steps the learner climbed in the last 7 days
 * (a sliding window), scoped to one language. A card that moved
 * Unfamiliar → Comfortable counts 2; two cards that each moved up one count 2 as
 * well. See docs/VELOCITY.md.
 *
 * Per docs/FRONTEND_LAYERING.md §3.2 this takes NO `token`: it goes through
 * src/api/http.ts, which resolves the Authorization header at call time.
 */
import { apiGet } from './http';

/** Response shape of GET /api/users/me/velocity (mirrors server/types/velocity.ts). */
export interface VelocityResponse {
    /** Band-steps climbed in the window for `language`. */
    velocity: number;
    /** The language `velocity` refers to (the request's, else the account's selected one). */
    language: string;
    /** Per-language breakdown; languages with zero are absent. */
    byLanguage: Record<string, number>;
    /** All languages summed. */
    total: number;
    /** Window length in days (7). Sent so the UI never hard-codes the copy. */
    windowDays: number;
}

/**
 * Fetch the caller's velocity. Pass `language` to ask for a specific one; omit it to
 * get the account's currently-selected language.
 */
export function fetchVelocity(language?: string): Promise<VelocityResponse> {
    return apiGet<VelocityResponse>('/api/users/me/velocity', {
        params: language ? { language } : undefined,
    });
}
