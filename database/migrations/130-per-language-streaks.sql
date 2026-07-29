-- Migration 130 — Per-language streaks, wallets and penalties.
--
-- Splits the four GLOBAL progress columns on `users` (totalMinutePoints,
-- currentStreak, lastStreakDate, lastPenaltyDate) into a per-(user, language)
-- table, and gives the Night Market a language dimension so each language grows
-- its own market.
--
-- Design + rationale: docs/PER_LANGUAGE_STREAKS.md
--
-- Backfill rule (§ 1.4 of that doc): each user's PRIMARY language is the one with
-- the greatest SUM(minutesEarned) in userminutepoints (ties alphabetical), falling
-- back to users."selectedLanguage" for users with no minute rows at all. The
-- primary language inherits the entire global wallet + streak state; every other
-- studied language starts at 0 points / 0 streak / NULL lastStreakDate, which
-- makes it CRON-EXEMPT until it first crosses the threshold. Existing night-market
-- placements and unlocks are all attributed to the primary language, preserving
-- each user's current market intact.
--
-- The four now-redundant columns on `users` are DROPPED at the end of this
-- migration (step 6) rather than in a phased follow-up: every account is a test
-- account, so there is no production state worth a two-step retreat, and leaving
-- them would create a second, silently-stale source of truth.
--
-- Step 3c also RE-ATTRIBUTES historical penaltyMinutes. Before this migration the
-- cron guessed a language from users."selectedLanguage" at tick time, so debits
-- landed on whatever language happened to be selected -- e.g. michael's 15-minute
-- penalty for 2026-07-25 sits on `es` though every one of those minutes was earned
-- in `zh`. Left alone, the now per-language calendars would show phantom penalties
-- on languages that were never really studied.

BEGIN;

-- ─────────────────────────────────────────────────────────────────────────────
-- 1. The new per-language progress table
-- ─────────────────────────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS user_language_points (
  "userId"            uuid        NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  language            varchar(10) NOT NULL,
  -- NET wallet for this language: penalty-debited, floored at 0. Funds this
  -- language's night market via unlocksForMinutes().
  "totalMinutePoints" integer     NOT NULL DEFAULT 0,
  -- Consecutive qualifying days IN THIS LANGUAGE.
  "currentStreak"     integer     NOT NULL DEFAULT 0,
  -- Last local day this language crossed RETENTION_MINUTES. Advanced ONLY by the
  -- increment path; the penalty cron never writes it (that is what makes the tier
  -- gap grow by exactly one per continued missed day).
  "lastStreakDate"    date,
  -- Cron idempotency guard: at most one penalty per (user, language) per local day.
  "lastPenaltyDate"   date,
  "createdAt"         timestamptz NOT NULL DEFAULT now(),
  "updatedAt"         timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY ("userId", language)
);

-- Mirrors the two partial indexes the old global columns had on `users`, so the
-- hourly cron's candidate scan stays cheap as the table grows.
CREATE INDEX IF NOT EXISTS idx_ulp_penalty_candidates
  ON user_language_points ("lastPenaltyDate")
  WHERE "totalMinutePoints" > 0;

CREATE INDEX IF NOT EXISTS idx_ulp_streak
  ON user_language_points ("lastStreakDate")
  WHERE "currentStreak" > 0;

-- Leaderboard ranks on SUM(totalMinutePoints) per user — support the grouped scan.
CREATE INDEX IF NOT EXISTS idx_ulp_user_points
  ON user_language_points ("userId", "totalMinutePoints");

-- ─────────────────────────────────────────────────────────────────────────────
-- 2. Resolve each user's primary language (reused by steps 3 and 4)
-- ─────────────────────────────────────────────────────────────────────────────
CREATE TEMP TABLE _primary_language ON COMMIT DROP AS
WITH per_language AS (
  SELECT "userId",
         language,
         SUM("minutesEarned") AS earned
  FROM userminutepoints
  GROUP BY "userId", language
),
ranked AS (
  SELECT "userId",
         language,
         row_number() OVER (
           PARTITION BY "userId"
           ORDER BY earned DESC, language ASC   -- ties broken alphabetically
         ) AS rn
  FROM per_language
)
SELECT u.id AS "userId",
       -- Users with no minute rows at all fall back to their selected language.
       COALESCE(r.language, u."selectedLanguage", 'zh') AS language
FROM users u
LEFT JOIN ranked r ON r."userId" = u.id AND r.rn = 1;

-- ─────────────────────────────────────────────────────────────────────────────
-- 3. Backfill user_language_points
-- ─────────────────────────────────────────────────────────────────────────────

-- 3a. The primary language inherits the whole global wallet + streak state.
INSERT INTO user_language_points
  ("userId", language, "totalMinutePoints", "currentStreak", "lastStreakDate", "lastPenaltyDate")
SELECT u.id,
       p.language,
       COALESCE(u."totalMinutePoints", 0),
       COALESCE(u."currentStreak", 0),
       u."lastStreakDate",
       u."lastPenaltyDate"
FROM users u
JOIN _primary_language p ON p."userId" = u.id
ON CONFLICT ("userId", language) DO NOTHING;

-- 3b. Every OTHER language the user has ever earned a minute in starts clean:
--     0 points, 0 streak, NULL lastStreakDate => exempt from the penalty cron
--     until it first crosses the threshold under the new per-language rules.
INSERT INTO user_language_points ("userId", language)
SELECT DISTINCT m."userId", m.language
FROM userminutepoints m
ON CONFLICT ("userId", language) DO NOTHING;

-- 3c. Re-attribute historical penalties to the primary language.
--     The pre-130 cron stamped each debit onto COALESCE(users."selectedLanguage",
--     'zh') at tick time, which is unrelated to where the minutes were actually
--     earned. Move every penalty sitting on a non-primary language onto the
--     primary one (summing into an existing row for that day if there is one), and
--     zero it at the source. minutesEarned is untouched -- those attributions were
--     always correct, since the increment path has always known its language.
WITH misattributed AS (
  SELECT m."userId",
         m."streakDate",
         m.language      AS wrong_language,
         p.language      AS right_language,
         m."penaltyMinutes"
  FROM userminutepoints m
  JOIN _primary_language p ON p."userId" = m."userId"
  WHERE m."penaltyMinutes" > 0
    AND m.language <> p.language
),
-- Data-modifying CTEs always run to completion even when the primary query does
-- not read them, and every sub-statement sees the SAME snapshot -- so this INSERT
-- reads the pre-zeroing values regardless of the UPDATE below.
reattributed AS (
  INSERT INTO userminutepoints
    ("userId", "streakDate", "language", "minutesEarned", "penaltyMinutes", "updatedAt")
  SELECT "userId", "streakDate", right_language, 0, "penaltyMinutes", now()
  FROM misattributed
  ON CONFLICT ("userId", "streakDate", "language")
  DO UPDATE SET "penaltyMinutes" = userminutepoints."penaltyMinutes" + EXCLUDED."penaltyMinutes",
                "updatedAt"      = now()
  RETURNING 1
)
UPDATE userminutepoints m
SET "penaltyMinutes" = 0,
    "updatedAt"      = now()
FROM misattributed x
WHERE m."userId"     = x."userId"
  AND m."streakDate" = x."streakDate"
  AND m.language     = x.wrong_language;

-- ─────────────────────────────────────────────────────────────────────────────
-- 4. Night Market gains a language dimension (one market per language)
-- ─────────────────────────────────────────────────────────────────────────────

-- Added nullable so existing rows survive; backfilled, then set NOT NULL.
ALTER TABLE nightmarkettemplatelocations ADD COLUMN IF NOT EXISTS language varchar(10);
ALTER TABLE nightmarketunlocks           ADD COLUMN IF NOT EXISTS language varchar(10);

UPDATE nightmarkettemplatelocations l
SET language = p.language
FROM _primary_language p
WHERE p."userId" = l."userId" AND l.language IS NULL;

UPDATE nightmarketunlocks u
SET language = l.language
FROM nightmarkettemplatelocations l
WHERE l.id = u."placedTemplateId" AND u.language IS NULL;

-- Any orphan left over (defensive; the FK makes this impossible for unlocks).
UPDATE nightmarkettemplatelocations SET language = 'zh' WHERE language IS NULL;
UPDATE nightmarketunlocks           SET language = 'zh' WHERE language IS NULL;

ALTER TABLE nightmarkettemplatelocations ALTER COLUMN language SET NOT NULL;
ALTER TABLE nightmarketunlocks           ALTER COLUMN language SET NOT NULL;

-- The corner-uniqueness constraint is now per market, not per user: the same grid
-- corner may host a stall in each language's market.
DROP INDEX IF EXISTS idx_nightmarkettemplatelocations_user_corner;
CREATE UNIQUE INDEX idx_nightmarkettemplatelocations_user_lang_corner
  ON nightmarkettemplatelocations ("userId", language, "offsetCol", "offsetRow");

-- Layout reads are always scoped to one market.
DROP INDEX IF EXISTS idx_nightmarkettemplatelocations_user_created;
CREATE INDEX idx_nightmarkettemplatelocations_user_lang_created
  ON nightmarkettemplatelocations ("userId", language, "createdAt");

CREATE INDEX IF NOT EXISTS idx_nightmarketunlocks_user_lang
  ON nightmarketunlocks ("userId", language);

-- ─────────────────────────────────────────────────────────────────────────────
-- 5. Verification — fails the migration loudly rather than shipping bad data
-- ─────────────────────────────────────────────────────────────────────────────
DO $$
DECLARE
  global_sum  bigint;
  per_lang_sum bigint;
  missing     bigint;
BEGIN
  -- Every language with earned minutes must now have a progress row.
  SELECT COUNT(*) INTO missing
  FROM (SELECT DISTINCT "userId", language FROM userminutepoints) m
  LEFT JOIN user_language_points p
    ON p."userId" = m."userId" AND p.language = m.language
  WHERE p."userId" IS NULL;

  IF missing > 0 THEN
    RAISE EXCEPTION 'migration 130: % (user,language) pairs have minute rows but no user_language_points row', missing;
  END IF;

  -- The wallet total must be conserved: all points landed on primary languages.
  SELECT COALESCE(SUM("totalMinutePoints"), 0) INTO global_sum   FROM users;
  SELECT COALESCE(SUM("totalMinutePoints"), 0) INTO per_lang_sum FROM user_language_points;

  IF global_sum <> per_lang_sum THEN
    RAISE EXCEPTION 'migration 130: wallet not conserved (users=%, user_language_points=%)', global_sum, per_lang_sum;
  END IF;

  -- No penalty may remain on a non-primary language after step 3c.
  SELECT COUNT(*) INTO missing
  FROM userminutepoints m
  JOIN _primary_language p ON p."userId" = m."userId"
  WHERE m."penaltyMinutes" > 0 AND m.language <> p.language;

  IF missing > 0 THEN
    RAISE EXCEPTION 'migration 130: % penalty rows still sit on a non-primary language', missing;
  END IF;

  RAISE NOTICE 'migration 130 OK: % progress rows, % points conserved',
               (SELECT COUNT(*) FROM user_language_points), per_lang_sum;
END
$$;

-- ─────────────────────────────────────────────────────────────────────────────
-- 6. Drop the superseded global columns
-- ─────────────────────────────────────────────────────────────────────────────
-- Runs AFTER the verification block above, which reads users."totalMinutePoints"
-- to prove the wallet was conserved. Every read/write of these four moved to
-- user_language_points; keeping them would leave a silently-stale mirror.
DROP INDEX IF EXISTS idx_users_lastpenaltydate_totalpoints;
DROP INDEX IF EXISTS idx_users_laststreakdate_currentstreak;

ALTER TABLE users
  DROP COLUMN IF EXISTS "totalMinutePoints",
  DROP COLUMN IF EXISTS "currentStreak",
  DROP COLUMN IF EXISTS "lastStreakDate",
  DROP COLUMN IF EXISTS "lastPenaltyDate";

COMMIT;
