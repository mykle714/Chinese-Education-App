-- Migration 103: Drop the vestigial `gender` column from `dictionaryentries_zh` (cdet)
--
-- `gender` was added to the then-unified `dictionaryentries` table by migration 55 as a
-- denormalized primary grammatical gender for gendered languages (Spanish). After the
-- per-language split (migration 57 renamed the table to `dictionaryentries_zh`, migration
-- 58 created `dictionaryentries_es`), Spanish gender lives on `dictionaryentries_es` —
-- where it is part of the logical identity `(word1, pos, gender)` and populated. Chinese
-- has no grammatical gender, so the column on the zh table has always been 100% NULL and
-- is read by nothing (the shared dict join substitutes a NULL literal for the zh branch —
-- server/dal/shared/dictJoin.ts). Drop it.
--
-- Idempotent: guarded with IF EXISTS so re-running is a no-op.

ALTER TABLE dictionaryentries_zh
    DROP COLUMN IF EXISTS gender;
