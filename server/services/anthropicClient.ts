import Anthropic from '@anthropic-ai/sdk';

/**
 * The shared Anthropic client for the server's ENRICHMENT-style AI helpers — today
 * only the dictionary long definition (DictionaryService); the Word of the Day card
 * body (WordOfTheDayService) was its other caller until that feature was removed
 * 2026-11-04. Keyed on ANTHROPIC_API_KEY.
 *
 * Constructed lazily so a missing key only disables the AI paths (every caller
 * null-checks the return) instead of throwing at import time.
 *
 * NOT for the learner-facing AI features (dictionary AI fallback, Compare, the Reader's
 * sentence Explain), which use `getDictAiClient` below so their usage and billing stay
 * isolated.
 */
let anthropicClient: Anthropic | null = null;

export function getAnthropicClient(): Anthropic | null {
  if (anthropicClient) return anthropicClient;
  const apiKey = process.env.ANTHROPIC_API_KEY;
  if (!apiKey) return null;
  anthropicClient = new Anthropic({ apiKey });
  return anthropicClient;
}

/**
 * The LEARNER-FACING AI client, keyed on its OWN `DICT_AI_API_KEY` so on-demand learner
 * requests are billed apart from the enrichment helpers above. Missing key ⇒ those features
 * are silently disabled (each caller null-checks and returns no result).
 *
 * Callers — all share the per-user daily budget `dictionary_ai_usage`
 * (constants.ts → DICTIONARY_AI_DAILY_LIMIT):
 *   - DictionaryService.generateAiEntry (docs/DICTIONARY_AI_FALLBACK_SEARCH.md)
 *   - DictionaryService.compareWords (docs/WORD_COMPARE_FEATURE.md)
 *   - SentenceExplanationService.explainSentence (docs/USER_DOCUMENT_FEATURE_SUMMARY.md § "Sentence Explain")
 */
let dictAiClient: Anthropic | null = null;

export function getDictAiClient(): Anthropic | null {
  if (dictAiClient) return dictAiClient;
  const apiKey = process.env.DICT_AI_API_KEY;
  if (!apiKey) return null;
  dictAiClient = new Anthropic({ apiKey });
  return dictAiClient;
}
