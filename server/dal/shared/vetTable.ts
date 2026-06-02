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
