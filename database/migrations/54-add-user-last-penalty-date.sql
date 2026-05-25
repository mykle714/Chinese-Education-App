-- Tracks the most recent local day (in the user's timezone, 4 AM-bounded)
-- on which the inactivity-penalty cron debited the user. Used as the
-- idempotency key for the daily penalty branch in
-- database/cron/expire-stale-streaks.sql so each local day deducts at
-- most once. NULL means "never penalized" — the cron treats that as
-- eligible on its next tick if the user is otherwise inactive.

ALTER TABLE users
  ADD COLUMN IF NOT EXISTS "lastPenaltyDate" date;

-- Partial index over the daily-penalty candidate set: anyone who still
-- has points to lose. Keeps the hourly sweep cheap as the user table grows.
CREATE INDEX IF NOT EXISTS idx_users_lastpenaltydate_totalpoints
  ON users ("lastPenaltyDate")
  WHERE "totalMinutePoints" > 0;
