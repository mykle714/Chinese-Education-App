import { Language } from '../types/index.js';

/**
 * The languages a user may actually select. `dictionaryentries_ja/_ko/_vi` do not exist yet
 * and their import scripts are intentionally broken, so ja/ko/vi are NOT selectable — see
 * CLAUDE.md § Dictionary Tables. Add a language here only once its det table exists.
 */
export const SUPPORTED_LANGUAGES: Language[] = ['zh', 'es'];

/**
 * Coerce an untrusted request value to a supported language, falling back to `'zh'`.
 *
 * Used wherever a language arrives from the wire (query string, body) and a concrete value is
 * required — notably the per-language minute-points reads and the per-language Night Market
 * layout (migration 136), where the language selects WHICH market is read or written. Falling
 * back rather than rejecting keeps an old client that omits the param working against the
 * historical default.
 */
export function resolveLanguage(raw: unknown): Language {
  return SUPPORTED_LANGUAGES.includes(raw as Language) ? (raw as Language) : 'zh';
}

/**
 * Same coercion, but returns `undefined` for an absent/unsupported value instead of defaulting.
 * For callers that want to distinguish "client said nothing" (fall through to the user's stored
 * `selectedLanguage`) from "client explicitly chose a language".
 */
export function resolveOptionalLanguage(raw: unknown): Language | undefined {
  return SUPPORTED_LANGUAGES.includes(raw as Language) ? (raw as Language) : undefined;
}
