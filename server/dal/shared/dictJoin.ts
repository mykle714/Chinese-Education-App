// Columns from the per-language dictionaryentries table (det) that we want to
// surface alongside each vocabentries (vet) row. `de.definition` is the first
// element of det's `definitions` JSONB array — the value rendered as the entry's
// English meaning on flashcards / detail / sort UIs.
//
// `pos`, `hasMultiplePos`, `alternateGender`, `alternateMeaning` are Spanish-only
// (NULL/FALSE for Chinese): the client shows a POS badge like "(v)" when
// hasMultiplePos is true, and the alternate-gender gloss for gender-homographs.
//
// `iconId` is the optional FK to icons8 (migration 72), present on both det tables.
// The client renders the icon via <img src="/api/icons8/<iconId>/image">.
//
// `definitionClusters` is the zh-only orthogonal sense-cluster column (migration
// 90, docs/DEFINITION_CLUSTERS.md) — NULL for Spanish and for zh entries not yet
// backfilled. Drives the flp sense-picker dropdown (EnglishBlock).
//
// `characterRationale` is the zh-only per-character rationale column (migration 102,
// docs/CHARACTER_RATIONALE.md): jsonb array of {char, reason} explaining why each
// character is used in a multi-char word. NULL for Spanish (the es branch substitutes
// a typed NULL) and for zh entries not yet backfilled. Replaces the old expansion cols.
export const DICT_COLS =
  `de.script, de.pronunciation, de.tone, de."difficulty", de."partsOfSpeech", ` +
  `de."vernacularScore", ` +
  `de.breakdown, de.synonyms, de."exampleSentences", ` +
  `de."characterRationale", de."longDefinition", ` +
  `de.pos, de."hasMultiplePos", de."alternateGender", de."alternateMeaning", ` +
  `de."iconId", ` +
  `de."definitionClusters", ` +
  `de.definition`;

// The columns selected inside each branch of the lateral join. Kept identical
// (same names + order) across both per-language tables so the UNION ALL below
// type-checks at the SQL level. The Spanish det carries pos / hasMultiplePos /
// alternateGender / alternateMeaning; the Chinese det does NOT (those columns were
// added to dictionaryentries_es only), so the zh branch substitutes literals.
// `match_rank` (0 = this row's pos equals the saved vet pos, 1 = otherwise) lets
// the es branch PREFER the saved POS but still FALL BACK to the best available row
// when the exact pos isn't present (e.g. data drift), so a card is never blank.
// It is consumed only by the ORDER BY below, not returned in DICT_COLS.
const DICT_LATERAL_SELECT_ZH =
  `SELECT script, pronunciation, tone, "difficulty", "partsOfSpeech", "vernacularScore",` +
  `       breakdown, synonyms,` +
  `       "exampleSentences", "characterRationale", "longDefinition",` +
  `       NULL::varchar AS pos, FALSE AS "hasMultiplePos",` +
  `       NULL::varchar AS "alternateGender", NULL::text AS "alternateMeaning",` +
  `       "iconId",` +
  `       "definitionClusters",` +
  `       1 AS match_rank,` +
  `       definitions, definitions->>0 AS definition`;

// Spanish det has no definitionClusters column (zh-only, migration 90) — substitute
// a typed NULL so the UNION ALL below still type-checks at the SQL level.
const DICT_LATERAL_SELECT_ES =
  `SELECT script, pronunciation, tone, "difficulty", "partsOfSpeech", "vernacularScore",` +
  `       breakdown, synonyms,` +
  `       "exampleSentences", NULL::jsonb AS "characterRationale", "longDefinition",` +
  `       pos, "hasMultiplePos", "alternateGender", "alternateMeaning",` +
  `       "iconId",` +
  `       NULL::jsonb AS "definitionClusters",` +
  `       (CASE WHEN ve.pos IS NOT NULL AND pos = ve.pos THEN 0 ELSE 1 END) AS match_rank,` +
  `       definitions, definitions->>0 AS definition`;

// Per-language dictionary join. Dictionary data is split into one table per
// language family (dictionaryentries_zh, dictionaryentries_es) because their
// natural identity differs (see CLAUDE.md). The vet row's `language` column
// selects which table to read from: the two UNION ALL branches are mutually
// exclusive on `ve.language`, so at most one yields rows and `de` resolves to
// the correct table. Both branches join on word1 = entryKey.
//
// IMPORTANT: this join references `ve.pos`, so the vet source aliased `ve` must
// expose a `pos` column. Read queries therefore build their FROM via
// `vetReadFrom(language)` (server/dal/shared/vetTable.ts): vocabentries_es already
// has `pos`, and vocabentries_zh is wrapped to expose a NULL `pos`.
// For Spanish the same spelling can have several POS rows in det; the saved vet
// row's `pos` disambiguates which det row (hence which definition + badge) to
// surface. When `ve.pos` is NULL (Chinese, or a legacy es row without a saved
// pos) the es branch falls back to the first det row by definition.
//
// The lateral also exposes `definitions` (the full JSONB array) so callers can
// reference `de.definitions` in WHERE clauses (e.g. unnested definition search)
// without it being returned in the SELECT list.
export const DICT_JOIN =
  `LEFT JOIN LATERAL (` +
  `  ${DICT_LATERAL_SELECT_ZH} FROM dictionaryentries_zh` +
  `    WHERE ve.language <> 'es' AND word1 = ve."entryKey" AND language = ve.language` +
  `  UNION ALL` +
  `  ${DICT_LATERAL_SELECT_ES} FROM dictionaryentries_es` +
  `    WHERE ve.language = 'es' AND word1 = ve."entryKey" AND language = ve.language` +
  `  ORDER BY match_rank, definition NULLS LAST` +
  `  LIMIT 1` +
  `) de ON true`;
