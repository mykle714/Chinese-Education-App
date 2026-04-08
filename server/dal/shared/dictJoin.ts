export const DICT_COLS =
  `de.script, de.pronunciation, de.tone, de."hskLevel", ` +
  `de.breakdown, de.synonyms, de."exampleSentences", ` +
  `de.expansion, de."expansionLiteralTranslation", de."longDefinition"`;

export const DICT_JOIN =
  `LEFT JOIN LATERAL (` +
  `  SELECT script, pronunciation, tone, "hskLevel", breakdown, synonyms,` +
  `         "exampleSentences", expansion, "expansionLiteralTranslation", "longDefinition"` +
  `  FROM dictionaryentries WHERE word1 = ve."entryKey" AND language = ve.language LIMIT 1` +
  `) de ON true`;
