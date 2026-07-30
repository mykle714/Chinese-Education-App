-- Migration 135: CONTRACT — drop the global minute-points counters from `users`
--
-- Pairs with migration 134, which created user_language_minute_totals and copied
-- these values into per-(user,language) rows. This is the second half of an
-- expand/contract rollout:
--
--   134 (expand)  → create + backfill the new table. Old columns still present, so
--                   code from before the change keeps working.
--   deploy        → ship the code that reads/writes the new table.
--   135 (contract)→ THIS FILE. Drop the now-unread columns.
--
-- ⚠️ RUN ORDER MATTERS. Do not run this until the server deploy that reads
-- user_language_minute_totals is live and verified. Running it early takes down
-- every minute-points read: the old code selects these columns by name.
--
-- Dropping is safe only because nothing reads them any more. Verified at authoring
-- time — the former readers and their replacements:
--   users."totalMinutePoints"     → UserLanguageTotalsDAL (net, per language);
--                                   leaderboard rollup SUMs the new table
--                                   (UserDAL.getPublicUsersWithTotalPoints)
--   users."lifetimeMinutesEarned" → UserLanguageTotalsDAL (gross, per language)
--   users."currentStreak"         → per-language streak on the new table; the
--                                   leaderboard reports MAX() across languages
--   users."lastStreakDate"        → per-language, drives each language's penalty tier
--   users."lastPenaltyDate"       → per-language idempotency guard in the hourly cron
--
-- users."lastMinutePointIncrement" and users.timezone STAY: the rate limit is per
-- user (not per language) and the 4 AM local-day boundary is a user-level attribute
-- that all of a user's languages share.
--
-- NOT REVERSIBLE by re-running 134: the backfill reads these columns. If you need to
-- roll back after this runs, restore from a dump.
--
-- Idempotent: safe to re-run.

ALTER TABLE users DROP COLUMN IF EXISTS "totalMinutePoints";
ALTER TABLE users DROP COLUMN IF EXISTS "lifetimeMinutesEarned";
ALTER TABLE users DROP COLUMN IF EXISTS "currentStreak";
ALTER TABLE users DROP COLUMN IF EXISTS "lastStreakDate";
ALTER TABLE users DROP COLUMN IF EXISTS "lastPenaltyDate";

-- The old global-streak index went with lastStreakDate/currentStreak (migration 50).
DROP INDEX IF EXISTS idx_users_laststreakdate_currentstreak;
