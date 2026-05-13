-- Adds a per-user timezone column used by the streak-expiration cron to compute
-- "today" against the 4 AM local-day boundary. Populated from the client on
-- every minute-points increment / new-day call (see UserMinutePointsService).
-- Default 'UTC' keeps existing rows safe until the client backfills them.
ALTER TABLE users ADD COLUMN IF NOT EXISTS timezone TEXT NOT NULL DEFAULT 'UTC';

-- Partial index keeps the hourly cron sweep cheap as the user table grows:
-- the sweep only ever scans rows with an active streak.
CREATE INDEX IF NOT EXISTS idx_users_laststreakdate_currentstreak
  ON users ("lastStreakDate")
  WHERE "currentStreak" > 0;
