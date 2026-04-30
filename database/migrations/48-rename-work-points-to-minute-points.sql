-- Migration 48: Rename "work points" → "minute points" + restructure streak tracking.
--
-- Changes:
--   1. users."totalWorkPoints"        → users."totalMinutePoints"
--   2. users."lastWorkPointIncrement" → users."lastMinutePointIncrement"
--   3. users."lastStreakIncrement" (TIMESTAMP) replaced by users."lastStreakDate" (DATE)
--      — backfilled by casting the timestamp to a date.
--   4. userworkpoints                 → userminutepoints
--      • column "workPoints"          → "minutesEarned"
--      • column date                  → "streakDate"
--      • new column "penaltyMinutes"  (INTEGER NOT NULL DEFAULT 0)
--      • drops "deviceFingerprint" — multi-device rows are aggregated by SUM
--        and the new primary key is ("userId", "streakDate").
--
-- All existing per-day rows are preserved by SUM-aggregating across devices.
-- "streakDate" is initially set to the legacy calendar date — new writes will
-- use the 4 AM-local-time-bounded streak day going forward.

BEGIN;

-- ─────────────────────────────────────────────────────────────
-- 1. Rename users columns
-- ─────────────────────────────────────────────────────────────
ALTER TABLE users RENAME COLUMN "totalWorkPoints"        TO "totalMinutePoints";
ALTER TABLE users RENAME COLUMN "lastWorkPointIncrement" TO "lastMinutePointIncrement";

-- Replace lastStreakIncrement (TIMESTAMP) with lastStreakDate (DATE).
ALTER TABLE users ADD COLUMN "lastStreakDate" DATE;
UPDATE users SET "lastStreakDate" = "lastStreakIncrement"::date
WHERE "lastStreakIncrement" IS NOT NULL;
ALTER TABLE users DROP COLUMN "lastStreakIncrement";

-- Drop the old index on the renamed lastWorkPointIncrement column and recreate it.
DROP INDEX IF EXISTS idx_users_last_work_point_increment;
CREATE INDEX IF NOT EXISTS idx_users_last_minute_point_increment
    ON users("lastMinutePointIncrement");

-- ─────────────────────────────────────────────────────────────
-- 2. Rename + restructure userworkpoints → userminutepoints
-- ─────────────────────────────────────────────────────────────

-- Build the new shape in a fresh table, aggregating across deviceFingerprint.
CREATE TABLE userminutepoints (
    "userId"            UUID    NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    "streakDate"        DATE    NOT NULL,
    "minutesEarned"     INTEGER NOT NULL DEFAULT 0,
    "penaltyMinutes"    INTEGER NOT NULL DEFAULT 0,
    "lastSyncTimestamp" TIMESTAMP DEFAULT NOW(),
    "updatedAt"         TIMESTAMP DEFAULT NOW(),
    PRIMARY KEY ("userId", "streakDate")
);

INSERT INTO userminutepoints ("userId", "streakDate", "minutesEarned", "lastSyncTimestamp", "updatedAt")
SELECT
    "userId",
    date AS "streakDate",
    SUM("workPoints")::INTEGER AS "minutesEarned",
    MAX("lastSyncTimestamp")    AS "lastSyncTimestamp",
    MAX("updatedAt")            AS "updatedAt"
FROM userworkpoints
GROUP BY "userId", date;

DROP TABLE userworkpoints;

COMMIT;
