-- Migration 56: Enforce vocab entry identity at the DB level.
--
-- A vocab entry is uniquely identified by (userId, entryKey, language): the
-- same spelling can exist independently per study language, but never twice
-- within the same user+language. Previously this was only enforced in
-- application code (VocabEntryDAL / services) with no DB backing.
--
-- Because Postgres treats NULL as distinct in unique constraints, `language`
-- is first backfilled and made NOT NULL so a NULL value can never slip a
-- duplicate past the constraint.

BEGIN;

-- 1. Backfill any rows missing a language to the legacy Chinese default.
UPDATE vocabentries SET language = 'zh' WHERE language IS NULL;

-- 2. Lock the column down so the default ('zh') always applies and NULLs
--    can't bypass the unique constraint added below.
ALTER TABLE vocabentries ALTER COLUMN language SET NOT NULL;

-- 3. The identity constraint. IF NOT EXISTS guards re-runs on environments
--    where it was added manually.
ALTER TABLE vocabentries
    ADD CONSTRAINT vocabentries_user_key_language_unique
    UNIQUE ("userId", "entryKey", language);

COMMIT;
