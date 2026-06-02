// Resolve the per-language `dictionaryentries` table (det) name from a language
// code. Dictionary data is split per language family (see CLAUDE.md): Chinese
// lives in `dictionaryentries_zh`, Spanish in `dictionaryentries_es`. Surrogate
// `id`s collide across these tables, so every id/word lookup must be scoped to
// the right table.
//
// This is a WHITELIST: it only ever returns one of two fixed, hard-coded table
// names and never interpolates caller-controlled text, so the result is safe to
// splice directly into SQL. Anything that isn't an explicitly supported language
// falls back to the Chinese table (the original/default det).
export function dictTableForLanguage(language: string | null | undefined): string {
  return language === 'es' ? 'dictionaryentries_es' : 'dictionaryentries_zh';
}
