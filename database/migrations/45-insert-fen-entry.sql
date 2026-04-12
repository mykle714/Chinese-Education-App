-- Migration 45: Insert undiscoverable entry for 份 (fèn)
-- Measure word for portions of food and copies of documents.
-- discoverable = FALSE: available for GSA/lookup but hidden from vocab discovery.

INSERT INTO dictionaryentries (
  language, script, discoverable,
  word1, word2,
  pronunciation, "numberedPinyin", tone,
  "partsOfSpeech", "hskLevel",
  definitions,
  "matchException"
)
VALUES (
  'zh', 'simplified', FALSE,
  '份', NULL,
  'fèn', 'fen4', '4',
  '["measure word"]'::jsonb, 'HSK3',
  '["(measure word) portion; serving (of food)", "(measure word) copy (of document, newspaper)", "part; share"]'::jsonb,
  '[]'::jsonb
)
ON CONFLICT DO NOTHING;
