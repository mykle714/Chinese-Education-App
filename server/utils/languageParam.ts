import { Language } from '../types/index.js';

/**
 * Request-language coercion, shared by every controller that scopes a response to one
 * language. Extracted from UserMinutePointsController when migration 130 made the night-market
 * layout per-language too and a second copy would have appeared.
 *
 * LAYER: controller util (HTTP edge). Services below this line always receive an
 * already-validated language and never re-parse request input.
 */

/**
 * Languages whose progress we track. Mirrors the server `Language` union — only zh/es are
 * user-selectable today; ja/ko/vi have no dictionary tables yet (see CLAUDE.md § Dictionary Tables).
 */
export const SUPPORTED_LANGUAGES: Language[] = ['zh', 'es'];

/**
 * Coerce a query param to a supported language, falling back to 'zh'.
 * Use where the response MUST be scoped to some language (calendar, summary, market layout).
 */
export function resolveLanguage(raw: unknown): Language {
  return SUPPORTED_LANGUAGES.includes(raw as Language) ? (raw as Language) : 'zh';
}

/**
 * Coerce a language to a supported one, or `undefined` when absent/unrecognized. Unlike
 * {@link resolveLanguage} this does NOT default to 'zh' — for writes, a missing language should
 * fall through to the user's selectedLanguage in the service rather than silently crediting
 * Chinese, which would corrupt a Spanish learner's streak and wallet.
 */
export function resolveWriteLanguage(raw: unknown): Language | undefined {
  return SUPPORTED_LANGUAGES.includes(raw as Language) ? (raw as Language) : undefined;
}
