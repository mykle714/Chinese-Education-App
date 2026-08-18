-- Migration 150: study_challenges."weekStart" (timestamptz) -> "weekIndex" (integer)
--
-- ⚠️ RUNS BEFORE THE NEW CODE IS FINE, AND AFTER IT IS NOT. The shipped service reads
-- and writes "weekIndex"; the previous one read and wrote "weekStart". They cannot
-- both run against the same schema, so this migration and the app restart must land
-- together. The standard /deploy order (compose up --build, then migrate) leaves a
-- few seconds where the NEW code sees the OLD column and every challenge read 500s.
-- With the feature not yet live on prod that window is harmless — see
-- docs/STUDY_CHALLENGE_DEPLOY_RUNBOOK.md, which sequences 148 + 150 together.
--
-- ── THE BUG THIS FIXES ───────────────────────────────────────────────────────
-- 148 stored the week as the CHALLENGER'S Monday 04:00 local, as a UTC instant.
-- That value is different in every timezone for the SAME calendar week -- measured
-- on 2026-08-19:
--
--     Asia/Shanghai    -> 2026-08-16 20:00Z
--     America/New_York -> 2026-08-17 08:00Z
--     Europe/London    -> 2026-08-17 03:00Z
--
-- so `study_challenges_pair_week_uniq` -- the index that IS the "one challenge per
-- pair per week" rule, and with it the decline cooldown -- never fired for a pair in
-- two zones. Alice and Bob challenging each other at the same moment produced TWO
-- live challenges for one pair in one week: two generated decks, two cap slots, and
-- a crown that could change hands twice.
--
-- ── THE FIX: A GLOBAL COUNTER ────────────────────────────────────────────────
-- The week becomes an INTEGER -- whole weeks since Monday 2026-01-05 00:00 UTC (the
-- epoch is a Monday, which is what makes the counter's weeks line up with the app's
-- Monday->Monday week). Every instant on earth maps to exactly ONE index, so the
-- second of two crossing inserts always collides and the loser gets a 409.
--
-- The accepted cost is that the ISSUE window rolls at Monday 00:00 UTC rather than
-- each player's local Monday 04:00 (up to 4h late in Shanghai, 11h early in Los
-- Angeles). DEADLINES ARE UNAFFECTED and stay per-player local: they are derived
-- from the index's Monday DATE plus each player's own timezone, in
-- server/shared/challengeWeek.ts (`weekBoundary`) and in
-- database/cron/expire-study-challenges.sql. Only the question "which week is this"
-- became global -- which is the only way two players can agree on the answer.
--
-- ⚠️ THE EPOCH IS DUPLICATED IN THREE PLACES: here, the cron SQL, and
-- `CHALLENGE_WEEK_EPOCH_UTC` in server/shared/challengeWeek.ts. Changing one alone
-- renumbers every stored week and silently moves every deadline.

BEGIN;

-- 1. The new column, nullable for the backfill.
ALTER TABLE study_challenges ADD COLUMN IF NOT EXISTS "weekIndex" integer;

-- 2. Backfill from the instant we are replacing.
--
-- The old value is a UTC instant, so the arithmetic is a plain epoch-second divide.
-- It reproduces the CHALLENGER's week, which is the best available answer: it is the
-- week the challenge was actually issued in, and any crossing duplicate pair that
-- already exists on dev keeps both rows (step 4 would reject them otherwise -- see
-- the note there).
UPDATE study_challenges
   SET "weekIndex" = floor(
         extract(epoch FROM ("weekStart" - TIMESTAMPTZ '2026-01-05 00:00:00+00'))
         / 604800                              -- 7 * 24 * 3600
       )::integer
 WHERE "weekIndex" IS NULL;

ALTER TABLE study_challenges ALTER COLUMN "weekIndex" SET NOT NULL;

-- 3. Drop the old index BEFORE the column it keys on.
DROP INDEX IF EXISTS study_challenges_pair_week_uniq;
ALTER TABLE study_challenges DROP COLUMN IF EXISTS "weekStart";

-- 4. Rebuild the pair-week rule on the counter.
--
-- Identical in shape to 148's -- LEAST/GREATEST keeps it direction-blind, and it is
-- deliberately NOT partial so `expired` and `no_contest` rows hold their slot too.
-- The only change is that its third column is now a value both players compute the
-- same way.
--
-- ⚠️ If this CREATE fails with a uniqueness violation, the table already holds the
-- duplicate crossing challenges this migration exists to prevent (possible on dev,
-- impossible on a prod that has never run the feature). Resolve by deleting the
-- later row of each colliding pair:
--
--   SELECT LEAST("challengerId","challengeeId") a, GREATEST("challengerId","challengeeId") b,
--          "weekIndex", count(*), array_agg(id ORDER BY "issuedAt")
--     FROM study_challenges GROUP BY 1,2,3 HAVING count(*) > 1;
--
CREATE UNIQUE INDEX IF NOT EXISTS study_challenges_pair_week_uniq
  ON study_challenges (
    LEAST("challengerId", "challengeeId"),
    GREATEST("challengerId", "challengeeId"),
    "weekIndex"
  );

COMMIT;
