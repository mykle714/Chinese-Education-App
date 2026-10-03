import Anthropic from '@anthropic-ai/sdk';

/**
 * The shared Anthropic client for the server's ENRICHMENT-style AI helpers — the
 * dictionary long definition (DictionaryService) and the Word of the Day card body
 * (WordOfTheDayService). Keyed on ANTHROPIC_API_KEY.
 *
 * Constructed lazily so a missing key only disables the AI paths (every caller
 * null-checks the return) instead of throwing at import time.
 *
 * NOT for the dictionary AI synthetic-entry fallback / Compare, which deliberately use
 * their own DICT_AI_API_KEY client in DictionaryService so that feature's usage and
 * billing stay isolated.
 */
let anthropicClient: Anthropic | null = null;

export function getAnthropicClient(): Anthropic | null {
  if (anthropicClient) return anthropicClient;
  const apiKey = process.env.ANTHROPIC_API_KEY;
  if (!apiKey) return null;
  anthropicClient = new Anthropic({ apiKey });
  return anthropicClient;
}
