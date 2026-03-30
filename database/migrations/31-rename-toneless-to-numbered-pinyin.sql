-- Migration 31: Rename toneless → numberedPinyin and change format
-- The column previously stored pronunciation with diacritics stripped (e.g. "gan huo").
-- It now stores numbered pinyin notation (e.g. "gan1 huo4") where each syllable
-- has its tone number appended (1-4). Neutral tone syllables have no number.
-- The ü character is represented as "v".

BEGIN;

ALTER TABLE dictionaryentries RENAME COLUMN toneless TO "numberedPinyin";

COMMENT ON COLUMN dictionaryentries."numberedPinyin" IS 'Numbered pinyin notation (e.g. "gan1 huo4" from "gān huò"). ü is represented as v. Neutral tone syllables have no number. Computed by backfill-numbered-pinyin.js';

-- Set all existing values to NULL so the backfill script recomputes them in the new format
UPDATE dictionaryentries SET "numberedPinyin" = NULL WHERE "numberedPinyin" IS NOT NULL;

COMMIT;
