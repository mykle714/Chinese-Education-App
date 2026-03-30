-- Migration 26: Add toneless column to dictionaryentries
-- Stores the pronunciation in roman characters with tone diacritics stripped.
-- Example: "pīn yīn" -> "pin yin", "lǘ" -> "lü"
-- Useful for fuzzy search, input matching, and display without tone marks.

ALTER TABLE dictionaryentries
  ADD COLUMN IF NOT EXISTS toneless VARCHAR(500);

COMMENT ON COLUMN dictionaryentries.toneless IS
  'Pronunciation in roman characters with tone diacritics stripped (e.g. "pin yin" from "pīn yīn")';
