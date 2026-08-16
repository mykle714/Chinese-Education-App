-- Migration 145: rename `user_language_points` → `user_languages`.
--
-- WHY
--   The table was created by migration 130 to hold one language's minute-point
--   wallet, and was named after that. It stopped being a points table almost
--   immediately:
--
--     130  totalMinutePoints, currentStreak, lastStreakDate, lastPenaltyDate
--     134  lifetimeMinutesEarned
--     146+ division, arenaOptInWeek        (docs/ARENA_FEATURE.md)
--
--   Only two of those seven columns are points. The name describes the table's
--   CONTENTS, and contents keep changing — so the name keeps going stale.
--
--   `user_languages` names the table's KEY instead: one row per (userId,
--   language). That is the one thing about this table that cannot change,
--   because it IS the primary key. Adding a column can never make the name
--   wrong again. It also reads honestly as "the languages this user studies",
--   which is a second true thing about the row set.
--
--   Mental model going forward: user_languages IS the users table — it is the
--   half of it that varies by language. Anything per-(user, language) belongs
--   here rather than as a new column-per-language on `users`.
--
-- SCOPE
--   Pure rename. No column is added, dropped or retyped, and no row is touched.
--
--   ALTER TABLE ... RENAME TO does NOT rename the table's indexes, primary key
--   or foreign-key constraints — they keep their old auto-generated or
--   hand-given names and would be the only place `..._language_points` survived.
--   Renaming them here keeps `\d user_languages` self-consistent, which is what
--   the next person reading the schema will rely on.
--
-- DEPLOY ORDER
--   Runs AFTER 130 (creates the table) and 134 (adds lifetimeMinutesEarned).
--   Neither 130 nor 134 has reached prod yet, so on prod this rename applies to
--   a table created minutes earlier in the same `migrate.sh` run. That is
--   harmless and deliberate: 130 is already applied on dev, and an applied
--   migration is immutable, so the rename is a new file rather than an edit to
--   130. See docs/PER_LANGUAGE_MINUTES_DEPLOY_RUNBOOK.md.
--
--   ⚠️ The pg_cron job in database/cron/expire-stale-streaks.sql references this
--   table by name and MUST be redeployed as part of the same deploy, or the
--   hourly penalty tick starts erroring on a missing relation. The runbook above
--   carries the step.

BEGIN;

-- ─────────────────────────────────────────────────────────────────────────────
-- 1. The table
-- ─────────────────────────────────────────────────────────────────────────────
ALTER TABLE user_language_points RENAME TO user_languages;

-- ─────────────────────────────────────────────────────────────────────────────
-- 2. Indexes (migration 130 lines 57-67). Named `ulp_*` after the old table;
--    renamed to `ul_*` so nothing in the schema still says "points".
-- ─────────────────────────────────────────────────────────────────────────────
ALTER INDEX IF EXISTS idx_ulp_penalty_candidates RENAME TO idx_ul_penalty_candidates;
ALTER INDEX IF EXISTS idx_ulp_streak             RENAME TO idx_ul_streak;
ALTER INDEX IF EXISTS idx_ulp_user_points        RENAME TO idx_ul_user_points;

-- ─────────────────────────────────────────────────────────────────────────────
-- 3. Auto-generated constraint names. Postgres derived these from the old table
--    name when 130 ran, so they do not follow the rename.
--    The PK is the implicit index behind PRIMARY KEY ("userId", language);
--    the FK is the implicit constraint behind REFERENCES users(id).
-- ─────────────────────────────────────────────────────────────────────────────
ALTER INDEX IF EXISTS user_language_points_pkey RENAME TO user_languages_pkey;

DO $$
BEGIN
  IF EXISTS (
    SELECT 1 FROM pg_constraint
     WHERE conrelid = 'user_languages'::regclass
       AND conname  = 'user_language_points_userId_fkey'
  ) THEN
    ALTER TABLE user_languages
      RENAME CONSTRAINT "user_language_points_userId_fkey" TO "user_languages_userId_fkey";
  END IF;
END $$;

-- ─────────────────────────────────────────────────────────────────────────────
-- 4. Documentation on the table itself, so the rationale is discoverable from
--    psql and not only from this file.
-- ─────────────────────────────────────────────────────────────────────────────
COMMENT ON TABLE user_languages IS
  'One row per (userId, language): everything about a learner that varies by '
  'language — minute-point wallet, streak, penalty bookkeeping, arena division. '
  'Renamed from user_language_points (migration 145) because the old name '
  'described its contents, which keep growing. See docs/PER_LANGUAGE_STREAKS.md.';

-- ─────────────────────────────────────────────────────────────────────────────
-- 5. Verification — fail loudly rather than leaving a half-renamed schema.
-- ─────────────────────────────────────────────────────────────────────────────
DO $$
BEGIN
  IF to_regclass('user_languages') IS NULL THEN
    RAISE EXCEPTION 'migration 145: user_languages does not exist after rename';
  END IF;
  IF to_regclass('user_language_points') IS NOT NULL THEN
    RAISE EXCEPTION 'migration 145: user_language_points still exists after rename';
  END IF;
END $$;

COMMIT;
