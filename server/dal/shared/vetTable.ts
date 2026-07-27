// Resolve the per-language `vocabentries` table (vet) name from a language code.
// User vocab is split per language family (mirroring the det split, see CLAUDE.md):
// Chinese saved cards live in `vocabentries_zh`, Spanish in `vocabentries_es`. Both
// now share ONE identity — (userId, entryKey, language); es dropped `pos` from its key
// in migration 123, when a Spanish word stopped spanning multiple det rows. The two
// tables share one id sequence, so ids are globally unique across the pair.
//
// WHITELIST: only ever returns one of two fixed, hard-coded table names and never
// interpolates caller-controlled text, so the result is safe to splice into SQL.
// Anything that isn't explicitly Spanish falls back to the Chinese table.
export function vetTableForLanguage(language: string | null | undefined): string {
  return language === 'es' ? 'vocabentries_es' : 'vocabentries_zh';
}

// FROM source (aliased `ve`) for a language-scoped vet read that feeds DICT_JOIN.
//
// This used to wrap the zh table in a subquery that synthesized a NULL `pos` column,
// because DICT_JOIN's Spanish branch referenced `ve.pos` to pick between a word's
// several det rows. Migration 121 removed that need (one det row per word1, sense
// chosen via `selectedSense`), so both languages are now a plain aliased table and the
// zh read no longer pays for a wrapping subquery.
//
// Kept as its own function rather than inlined at the ~19 call sites: it marks which
// queries are DICT_JOIN reads, and gives any future per-language FROM divergence one
// place to live.
export function vetReadFrom(language: string | null | undefined): string {
  return `${vetTableForLanguage(language)} ve`;
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

/**
 * In-query utcm category for ONE mark type (migration 128, docs/MASTERY_REWORK.md
 * § "Games select by their own mark type"). Banded off that single track's 0..8
 * positive count instead of the goal-blended pbh, so a game buckets cards by the
 * history of the track it actually exercises.
 *
 * Unlike UTCM_CATEGORY_EXPR this needs NO users join — a per-type band is
 * goal-independent. References `ve` (the vet alias) only.
 *
 * The mark type is passed as a BIND PARAMETER, never interpolated: callers hand in
 * the placeholder (e.g. `'$5'`) and bind the MarkType value alongside it.
 */
export function typeCategoryExpr(markTypeParam: string): string {
  return `compute_type_category(ve."typedMarkHistory", ${markTypeParam})`;
}
