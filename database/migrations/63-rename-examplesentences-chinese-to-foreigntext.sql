-- Migration 63: Rename exampleSentences JSON key `chinese` -> `foreignText`
--
-- exampleSentences is a jsonb array of sentence objects. The sentence-text field
-- was historically named `chinese`; it is now the language-agnostic `foreignText`
-- (so Spanish/other languages share one shape). This rewrites each array element,
-- moving the value from `chinese` to `foreignText` and dropping the old key.
--
-- Scope: dictionaryentries_zh (the only table with populated exampleSentences).
-- dictionaryentries_es is included defensively (currently 0 rows) so any data
-- written before its backfill script was updated is also normalized.
--
-- Idempotent: the EXISTS guard means only rows still carrying a `chinese` key are
-- touched, so a re-run is a no-op. The guard also skips empty arrays so jsonb_agg
-- never nulls the column.

UPDATE dictionaryentries_zh
SET "exampleSentences" = (
  SELECT jsonb_agg(
    CASE
      WHEN elem ? 'chinese'
        THEN (elem - 'chinese') || jsonb_build_object('foreignText', elem -> 'chinese')
      ELSE elem
    END
    ORDER BY ord
  )
  FROM jsonb_array_elements("exampleSentences") WITH ORDINALITY AS t(elem, ord)
)
WHERE "exampleSentences" IS NOT NULL
  AND jsonb_typeof("exampleSentences") = 'array'
  AND EXISTS (
    SELECT 1 FROM jsonb_array_elements("exampleSentences") e WHERE e ? 'chinese'
  );

UPDATE dictionaryentries_es
SET "exampleSentences" = (
  SELECT jsonb_agg(
    CASE
      WHEN elem ? 'chinese'
        THEN (elem - 'chinese') || jsonb_build_object('foreignText', elem -> 'chinese')
      ELSE elem
    END
    ORDER BY ord
  )
  FROM jsonb_array_elements("exampleSentences") WITH ORDINALITY AS t(elem, ord)
)
WHERE "exampleSentences" IS NOT NULL
  AND jsonb_typeof("exampleSentences") = 'array'
  AND EXISTS (
    SELECT 1 FROM jsonb_array_elements("exampleSentences") e WHERE e ? 'chinese'
  );
