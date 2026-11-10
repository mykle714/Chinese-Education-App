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

/**
 * The discover supply gate — the ONE predicate that decides whether a det row may be
 * offered to a learner: sorted in acp / Quick Mark, counted in the progress bar,
 * accepted by `POST /api/starterPacks/sort`, or lent as a provisional card.
 *
 * One flag, every language: `discoverable` (the zh-only `sortable` bar was retired by
 * migration 144). Shared by `StarterPacksDAL` and `ProvisionalCardDAL` so the two can
 * never drift apart: a word we lend must also be a word discover will later offer for
 * sorting, or the end-of-round "sort these cards" hand-off would show an empty flow.
 *
 * @param alias table alias INCLUDING the trailing dot (`'de.'`), or `''` for an
 *   unaliased query. Always a fixed literal at the call site — never caller input.
 *
 * Referenced by: docs/DISCOVER_FLOW.md § "Card supply gate".
 */
export function discoverSupplyGate(alias = 'de.'): string {
  return `${alias}discoverable = TRUE`;
}
