/**
 * sentenceExplanation.ts — the Reader's sentence Explain call
 * (docs/USER_DOCUMENT_FEATURE_SUMMARY.md § "Sentence Explain").
 *
 * Per docs/FRONTEND_LAYERING.md §3.2 nothing here takes a `token`: it goes through
 * src/api/http.ts, which resolves the Authorization header at call time.
 *
 * Caller: reading/useSentenceExplanation.ts.
 * Server: POST /api/texts/explainSentence → SentenceExplanationController.explain.
 */
import { apiPost } from './http';
import { getBrowserTimezone } from '../utils/browserTimezone';
import type { SentenceExplanationResult } from '../../server/contracts/wire';

/**
 * Explain one highlighted sentence for the signed-in learner — served from their cache when
 * they have explained it before, otherwise one AI call against the shared daily budget.
 * `tz` lets the server bound that budget to the learner's local streak-day.
 *
 * Resolves with both fields null when the feature is unavailable or the model produced
 * nothing usable. Throws ApiError on a non-2xx — 429 when the daily AI budget is spent
 * (its `response.data.error` is the user-facing message).
 */
export function explainSentence(sentence: string, language: string, signal?: AbortSignal): Promise<SentenceExplanationResult> {
    return apiPost<SentenceExplanationResult>(
        '/api/texts/explainSentence',
        { sentence, language, tz: getBrowserTimezone() },
        { signal },
    );
}
