-- Migration 78: Create the `wins` table (lifetime game-win event log) and retire `weeklies`.
--
-- Shape: an APPEND-ONLY event log — one row per win, mirroring how flashcard
-- "marks" are modelled (markHistory entries). Lifetime stats are derived:
--
--   lifetime wins (a level)  = COUNT(*)            WHERE game/level
--   last win                 = MAX("wonAt")
--   weekly badge ("this week") = EXISTS a row with "wonAt" >= the user's
--                                most-recent-Sunday-04:00-local week boundary
--
-- This SUBSUMES the old `weeklies` table: a "weekly achievement" is no longer a
-- separate flag wiped by a cron, it is just a timestamp filter over this
-- persistent log. So the hourly cron's weekly-reset branch (Branch C in
-- database/cron/expire-stale-streaks.sql) is removed alongside this migration —
-- nothing wipes win data; lifetime history is preserved.
--
-- game/level are opaque strings (e.g. game='bubbleMatch', level='1') so any
-- future game logs wins through the same table with no schema change.
--
-- Idempotent: safe to re-run (guards on table existence).

CREATE TABLE IF NOT EXISTS wins (
  id        uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  "userId"  uuid NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  game      varchar(64) NOT NULL,
  level     varchar(64) NOT NULL,
  "wonAt"   timestamptz NOT NULL DEFAULT now()
);

-- Per-user lookups (lifetime totals, "my wins"), and the week-boundary filter
-- used by the weekly badge / leaderboard counts.
CREATE INDEX IF NOT EXISTS idx_wins_user ON wins("userId");
CREATE INDEX IF NOT EXISTS idx_wins_user_wonat ON wins("userId", "wonAt");
-- Grouping lifetime counts by (game, level).
CREATE INDEX IF NOT EXISTS idx_wins_user_game_level ON wins("userId", game, level);

COMMENT ON TABLE wins IS
  'Append-only lifetime game-win log: one row per win. game/level are opaque keys (e.g. bubbleMatch / 1). Lifetime = COUNT(*), lastWin = MAX("wonAt"), weekly badge = a row since the user''s Sunday-04:00-local week boundary. Replaces the old weeklies flag table.';

-- One-time data migration: fold any existing weekly badges into the wins log,
-- then drop the obsolete weeklies table. Wrapped so a re-run (after weeklies is
-- already gone) is a no-op rather than an error.
DO $$
BEGIN
  IF to_regclass('public.weeklies') IS NOT NULL THEN
    -- Each weeklies row was an opaque activity key like 'bubbleMatch-1'. Split
    -- the trailing '-<digits>' into level; the remainder is the game. A legacy
    -- bare key (no trailing number) becomes level '1'. achievedAt -> wonAt.
    INSERT INTO wins ("userId", game, level, "wonAt")
    SELECT
      w."userId",
      regexp_replace(w.activity, '-(\d+)$', '')                  AS game,
      COALESCE(substring(w.activity from '-(\d+)$'), '1')        AS level,
      w."achievedAt"
    FROM weeklies w;

    DROP TABLE weeklies;
  END IF;
END $$;
