// Columns from dictionaryentries (det) that we want to surface alongside each
// vocabentries (vet) row. `de.definition` is the first element of det's
// `definitions` JSONB array — the value rendered as the entry's English
// meaning on flashcards / detail / sort UIs.
export const DICT_COLS =
  `de.script, de.pronunciation, de.tone, de."hskLevel", de."partsOfSpeech", ` +
  `de."vernacularScore", ` +
  `de.breakdown, de.synonyms, de."exampleSentences", ` +
  `de.expansion, de."expansionLiteralTranslation", de."longDefinition", ` +
  `de.definition`;

// The LATERAL subquery also exposes `definitions` (the full JSONB array) so
// callers can reference `de.definitions` in WHERE clauses (e.g. for unnested
// definition search) without it being returned in the SELECT list.
export const DICT_JOIN =
  `LEFT JOIN LATERAL (` +
  `  SELECT script, pronunciation, tone, "hskLevel", "partsOfSpeech", "vernacularScore",` +
  `         breakdown, synonyms,` +
  `         "exampleSentences", expansion, "expansionLiteralTranslation", "longDefinition",` +
  `         definitions, definitions->>0 AS definition` +
  `  FROM dictionaryentries WHERE word1 = ve."entryKey" AND language = ve.language LIMIT 1` +
  `) de ON true`;
