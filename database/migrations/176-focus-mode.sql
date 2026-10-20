-- Migration 176: Focus mode — a per-world daily cap of 40 cards (docs/FOCUS_MODE.md)
--
-- WHY (approved 2026-10-20)
--   A learner whose pile of off-cooldown cards in one world has grown past 100 is
--   offered FOCUS MODE by a lever on that world's Deck Tower platform. While it is on,
--   each streak day (04:00 local) that world serves at most 40 cards — a snapshot taken
--   the first time the day's set is needed — and a card leaves the set for the rest of
--   the day once it is marked correct.
--
-- WHAT IT ADDS
--   user_languages."focusWorlds"        the worlds (core/reading/writing) focus mode is
--                                       ON in, for this (user, language). '{}' = off
--                                       everywhere. Per world AND per language: Reading
--                                       focus does not touch Main or Writing, and zh/es
--                                       are independent.
--   user_languages."focusEndedNotices"  the worlds whose focus mode the server turned OFF
--                                       by itself (the day's snapshot found fewer than 40
--                                       off-cooldown cards) and whose "focus mode is off"
--                                       popup no page has shown yet. Cleared by the
--                                       client's acknowledgement. A column rather than a
--                                       response field because the snapshot can be taken
--                                       by a background request (Home's flp preload) that
--                                       no page is watching.
--   focus_daily_snapshots               ONE row per (user, language, world): the day's
--                                       pinned set of vet ids. Overwritten by the first
--                                       request of each new streak day, so it never grows
--                                       past three rows per (user, language). The set is
--                                       pinned because a live recompute would let a new
--                                       card in every time one was marked out, and the
--                                       40 would never run out.
--
-- "vetIds" has no FK: vet ids span two physical tables (vocabentries_zh/_es share one
-- id sequence), so no single REFERENCES can cover them. A stale id is harmless — every
-- read joins the ids back against vet, and a deleted card simply matches nothing.
--
-- Expand-only: two NOT NULL DEFAULT '{}' columns and a new table. Old code ignores them.
-- NO OWN TRANSACTION: migrate.sh wraps each file in one (the migration-150 lesson).

ALTER TABLE user_languages
  ADD COLUMN IF NOT EXISTS "focusWorlds" text[] NOT NULL DEFAULT '{}';

ALTER TABLE user_languages
  ADD COLUMN IF NOT EXISTS "focusEndedNotices" text[] NOT NULL DEFAULT '{}';

ALTER TABLE user_languages
  DROP CONSTRAINT IF EXISTS chk_user_languages_focus_worlds;
ALTER TABLE user_languages
  ADD CONSTRAINT chk_user_languages_focus_worlds
  CHECK ("focusWorlds" <@ ARRAY['core', 'reading', 'writing']::text[]);

ALTER TABLE user_languages
  DROP CONSTRAINT IF EXISTS chk_user_languages_focus_ended_notices;
ALTER TABLE user_languages
  ADD CONSTRAINT chk_user_languages_focus_ended_notices
  CHECK ("focusEndedNotices" <@ ARRAY['core', 'reading', 'writing']::text[]);

COMMENT ON COLUMN user_languages."focusWorlds" IS
  'Worlds (core/reading/writing) focus mode is on in for this (user, language). See docs/FOCUS_MODE.md.';
COMMENT ON COLUMN user_languages."focusEndedNotices" IS
  'Worlds whose focus mode the server auto-ended and whose popup has not been shown yet. See docs/FOCUS_MODE.md.';

CREATE TABLE IF NOT EXISTS focus_daily_snapshots (
  "userId"     uuid        NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  language     text        NOT NULL,
  world        text        NOT NULL CHECK (world IN ('core', 'reading', 'writing')),
  "streakDate" date        NOT NULL,
  "vetIds"     integer[]   NOT NULL,
  "takenAt"    timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY ("userId", language, world)
);

COMMENT ON TABLE focus_daily_snapshots IS
  'Focus mode: the pinned set of up to 40 vet ids a world serves on one streak day. One row per (user, language, world), overwritten daily. See docs/FOCUS_MODE.md.';
