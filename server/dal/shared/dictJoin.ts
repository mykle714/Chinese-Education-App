// Columns from the per-language dictionaryentries table (det) that we want to
// surface alongside each vocabentries (vet) row. `de.definition` is the first
// element of det's `definitions` JSONB array — the value rendered as the entry's
// English meaning on flashcards / detail / sort UIs.
//
// `iconId` is the optional FK to icons8 (migration 72), present on both det tables.
// The client renders the icon via <img src="/api/icons8/<iconId>/image">.
//
// `definitionClusters` is the orthogonal sense-cluster column — zh since migration 90,
// es since migration 123 (docs/DEFINITION_CLUSTERS.md). NULL for entries not yet
// clustered. Drives the flp sense-picker dropdown (EnglishBlock).
export const DICT_COLS =
  `de.script, de.pronunciation, de.tone, de."difficulty", de."partsOfSpeech", ` +
  `de."frequencyScore", ` +
  `de.breakdown, de.synonyms, de."exampleSentences", ` +
  `de."longDefinition", de."longDefinitionCitations", ` +
  `de."iconId", ` +
  `de."definitionClusters", ` +
  `de.definition`;

// The columns selected inside each branch of the lateral join. Kept identical
// (same names + order) across both per-language tables so the UNION ALL below
// type-checks at the SQL level.
//
// The two branches are now the SAME string, differing only in the table they read.
// They used to diverge: Spanish carried pos / hasMultiplePos / alternateGender /
// alternateMeaning columns (the zh branch substituted typed NULL literals), and a
// `match_rank` expression let the es branch prefer the det row whose pos equalled the
// saved vet pos. All of that existed for one reason — a Spanish word1 spanned SEVERAL
// det rows, one per (pos, gender). Migration 121 merged those rows into one and moved
// the POS/gender split into `definitionClusters`, so "which sense did the learner
// mean?" is now answered ONE LAYER UP by their `selectedSense` label, exactly as it
// already was for Chinese heteronyms.
//
// ONE column diverges again as of migration 126: `longDefinitionCitations` (translations for
// the Chinese runs cited inside a long definition) is a zh-only enrichment — Spanish long
// definitions contain no Han runs, so the es branch substitutes a typed NULL to keep the two
// SELECT lists union-compatible. Same pattern `dictionaryColumns()` uses for definitionClusters.
const dictLateralSelect = (language: 'zh' | 'es'): string =>
  `SELECT script, pronunciation, tone, "difficulty", "partsOfSpeech", "frequencyScore",` +
  `       breakdown, synonyms,` +
  `       "exampleSentences", "longDefinition",` +
  (language === 'zh'
    ? `       "longDefinitionCitations",`
    : `       NULL::jsonb AS "longDefinitionCitations",`) +
  `       "iconId",` +
  `       "definitionClusters",` +
  `       definitions, definitions->>0 AS definition`;

// Per-language dictionary join. Dictionary data is split into one table per
// language family (dictionaryentries_zh, dictionaryentries_es) because their
// enrichment columns differ (see CLAUDE.md). The vet row's `language` column
// selects which table to read from: the two UNION ALL branches are mutually
// exclusive on `ve.language`, so at most one yields rows and `de` resolves to
// the correct table. Both branches join on word1 = entryKey.
//
// `word1` is UNIQUE per language in BOTH tables now (zh always was; es since migration
// 121's uq_es_word1_language), so each branch matches at most one row and the join no
// longer needs an ORDER BY to make its pick deterministic. The LIMIT 1 is retained as a
// cheap guard so a future data-integrity slip degrades to one row rather than fanning
// the caller's result set out.
//
// The lateral also exposes `definitions` (the full JSONB array) so callers can
// reference `de.definitions` in WHERE clauses (e.g. unnested definition search)
// without it being returned in the SELECT list.
export const DICT_JOIN =
  `LEFT JOIN LATERAL (` +
  `  ${dictLateralSelect('zh')} FROM dictionaryentries_zh` +
  `    WHERE ve.language <> 'es' AND word1 = ve."entryKey" AND language = ve.language` +
  `  UNION ALL` +
  `  ${dictLateralSelect('es')} FROM dictionaryentries_es` +
  `    WHERE ve.language = 'es' AND word1 = ve."entryKey" AND language = ve.language` +
  `  LIMIT 1` +
  `) de ON true`;
