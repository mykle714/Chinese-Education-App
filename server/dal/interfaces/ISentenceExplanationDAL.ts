import type { LongDefinitionCitation } from '../../contracts/wire.js';

/** One cached sentence explanation (migration 195). */
export interface SentenceExplanationRow {
  explanation: string;
  /** Translations of the Chinese runs cited in `explanation`; null when the model gave none. */
  citations: LongDefinitionCitation[] | null;
  model: string | null;
  createdAt: string;
}

/**
 * Data-access contract for `sentence_explanation_cache` (migration 195): one row per
 * (userId, sentence, language, promptVersion). Pure storage — WHEN to read, generate or
 * write is SentenceExplanationService's call.
 *
 * Docs: docs/USER_DOCUMENT_FEATURE_SUMMARY.md § "Sentence Explain".
 */
export interface ISentenceExplanationDAL {
  /** The learner's cached explanation of `sentence` under `promptVersion`, or null. */
  find(userId: string, sentence: string, language: string, promptVersion: number): Promise<SentenceExplanationRow | null>;

  /**
   * Store an explanation. On a key collision (two Explain taps racing) the newer one
   * overwrites — both were generated for the same learner, sentence and prompt.
   */
  upsert(
    userId: string,
    sentence: string,
    language: string,
    promptVersion: number,
    explanation: string,
    citations: LongDefinitionCitation[] | null,
    model: string
  ): Promise<void>;
}
