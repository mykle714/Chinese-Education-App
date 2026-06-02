-- Migration 62: Add `language` to userminutepoints so each earned minute is
--               attributed to the language the user was studying.
--
-- Context: the app now supports multiple languages (zh/ja/ko/vi/es). Minutes
-- earned should be partitionable by language so the home screen and the
-- minute-points fire badge can show the count for the user's *selected*
-- language. The streak itself stays GLOBAL (studying any language keeps it
-- alive), so the streak/penalty columns on `users` are untouched.
--
-- Changes:
--   1. Add column "language" VARCHAR(10) NOT NULL DEFAULT 'zh'.
--      All pre-existing rows were Chinese-only, so 'zh' is the correct backfill.
--   2. Repoint the primary key from ("userId", "streakDate") to
--      ("userId", "streakDate", "language"). Existing rows stay unique because
--      they all backfill to the same language.
--
-- After this, a user can have one row per (streakDate, language) pair.

BEGIN;

ALTER TABLE userminutepoints
    ADD COLUMN IF NOT EXISTS "language" VARCHAR(10) NOT NULL DEFAULT 'zh';

-- Swap the primary key to include language.
ALTER TABLE userminutepoints DROP CONSTRAINT IF EXISTS userminutepoints_pkey;
ALTER TABLE userminutepoints
    ADD CONSTRAINT userminutepoints_pkey
    PRIMARY KEY ("userId", "streakDate", "language");

COMMIT;
