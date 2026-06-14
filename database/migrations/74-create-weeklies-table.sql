-- Migration 74: Create the `weeklies` table
--
-- Tracks per-user "weekly achievement" flags — things the user accomplished
-- during the current week. The first use is Bubble Match: clearing the final
-- level records a `bubbleMatch` achievement so the client can show "you beat
-- Level 5 this week".
--
-- Identity is (userId, activity): one row per achievement per user. Re-earning
-- the same achievement in the same week upserts in place (bumping `achievedAt`)
-- rather than duplicating. `activity` is a short opaque key chosen by the client
-- (e.g. 'bubbleMatch'); the table stays generic so future weekly achievements
-- need no schema change — only a new key.
--
-- Lifecycle: this table is meant to be WIPED at the start of each week by a
-- prod-only cron (UPDATE/DELETE), so a row's presence means "earned this week".
-- The reset cron is NOT part of this migration and is not installed on dev.
--
-- Idempotent: safe to re-run.

CREATE TABLE IF NOT EXISTS weeklies (
    id           UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    "userId"     UUID        NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    activity     VARCHAR(64) NOT NULL,                          -- client-chosen key, e.g. 'bubbleMatch'
    "achievedAt" TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT NOW() -- when it was (re)earned this week
);

-- One row per (user, activity): enables the upsert and the "did I earn X this
-- week?" lookup.
CREATE UNIQUE INDEX IF NOT EXISTS idx_weeklies_user_activity
    ON weeklies ("userId", activity);

-- Supports the per-user list query (GET all of a user's weekly achievements).
CREATE INDEX IF NOT EXISTS idx_weeklies_user
    ON weeklies ("userId");

COMMENT ON TABLE weeklies
  IS 'Per-user weekly achievement flags. One row per (userId, activity); wiped weekly by a prod cron so presence means "earned this week".';
