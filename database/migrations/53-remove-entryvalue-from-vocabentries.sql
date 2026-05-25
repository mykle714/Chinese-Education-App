-- Migration 53: Remove entryValue column from vocabentries.
--
-- Definitions are now read on demand from dictionaryentries via the existing
-- DICT_JOIN. Search expands det.definitions with jsonb_array_elements_text so
-- users can match on any definition phrase rather than only the first one.
--
-- Orphan vet rows (no matching det row) are deleted first so post-migration
-- reads never render a blank definition.

BEGIN;

DELETE FROM vocabentries ve
WHERE NOT EXISTS (
    SELECT 1 FROM dictionaryentries de
    WHERE de.word1 = ve."entryKey" AND de.language = ve.language
);

DROP INDEX IF EXISTS idx_vocabentries_value_trgm;

ALTER TABLE vocabentries DROP COLUMN "entryValue";

COMMIT;
