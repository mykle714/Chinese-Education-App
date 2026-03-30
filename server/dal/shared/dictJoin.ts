export const DICT_COLS =
  `de.script, de.pronunciation, de.tone, de."hskLevelTag", ` +
  `de.breakdown, de.synonyms, de."exampleSentences", ` +
  `de.expansion, de."expansionLiteralTranslation"`;

export const DICT_JOIN =
  `LEFT JOIN LATERAL (` +
  `  SELECT script, pronunciation, tone, "hskLevelTag", breakdown, synonyms,` +
  `         "exampleSentences", expansion, "expansionLiteralTranslation"` +
  `  FROM dictionaryentries WHERE word1 = ve."entryKey" AND language = ve.language LIMIT 1` +
  `) de ON true`;
