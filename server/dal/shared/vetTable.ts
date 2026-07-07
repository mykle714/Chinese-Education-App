// Resolve the per-language `vocabentries` table (vet) name from a language code.
// User vocab is split per language family (mirroring the det split, see CLAUDE.md):
// Chinese saved cards live in `vocabentries_zh`, Spanish in `vocabentries_es`
// (which adds `pos` to the identity so verb vs noun of the same spelling are
// distinct saved cards). The two tables share one id sequence, so ids are globally
// unique across the pair.
//
// WHITELIST: only ever returns one of two fixed, hard-coded table names and never
// interpolates caller-controlled text, so the result is safe to splice into SQL.
// Anything that isn't explicitly Spanish falls back to the Chinese table.
export function vetTableForLanguage(language: string | null | undefined): string {
  return language === 'es' ? 'vocabentries_es' : 'vocabentries_zh';
}

// FROM source (aliased `ve`) for a language-scoped vet read that feeds DICT_JOIN.
// DICT_JOIN references `ve.pos`; the es table has it, but the zh table does not,
// so the zh source is wrapped to expose a NULL `pos`. Pair with vetTableForLanguage
// for plain (non-joined) language-scoped queries.
export function vetReadFrom(language: string | null | undefined): string {
  return language === 'es'
    ? 'vocabentries_es ve'
    : '(SELECT *, NULL::varchar AS pos FROM vocabentries_zh) ve';
}

// Both physical vet tables, for id-only operations that must hit whichever holds
// the row (exactly one matches, since ids are globally unique across the pair).
export const VET_PHYSICAL_TABLES = ['vocabentries_zh', 'vocabentries_es'] as const;

// In-query utcm category (migration 101, docs/MASTERY_REWORK.md). The `category`
// column is no longer stored — it is derived from the card's typedMarkHistory AND
// the account's goal flags, which live on the users row. So any query that needs a
// card's category must JOIN users (UTCM_USERS_JOIN) and splice UTCM_CATEGORY_EXPR
// into its SELECT (aliased `category`) and/or WHERE. Both reference `ve` (the vet
// alias) and `u` (the joined users alias).
export const UTCM_USERS_JOIN = `JOIN users u ON u.id = ve."userId"`;
export const UTCM_CATEGORY_EXPR = `compute_utcm_category(ve."typedMarkHistory", u."readingGoal", u."writingGoal")`;
// Ready-made SELECT-list fragment: the computed category under its column name.
export const UTCM_CATEGORY_SELECT = `${UTCM_CATEGORY_EXPR} AS category`;
