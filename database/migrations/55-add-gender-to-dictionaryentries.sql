-- Migration 55: Add gender column to DictionaryEntries (det)
--
-- Grammatical gender for gendered languages (initially Spanish: 'm', 'f',
-- 'mf', 'm-p', 'f-p', 'mfbysense', etc.). Nullable — genderless languages
-- (zh/ja/ko/vi) leave it NULL. The authoritative per-part-of-speech gender
-- lives in the source data; this column is a denormalized primary gender for
-- the headword (typically the noun's gender) for quick display/filtering.

ALTER TABLE dictionaryentries
    ADD COLUMN IF NOT EXISTS gender VARCHAR(50);
