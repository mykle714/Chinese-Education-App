-- Migration 175: user_languages."lastBankingShownDate" — the daily banking animation's
--                seen-today marker, per (user, language)
--
-- WHY (docs/DAILY_MINUTE_BANKING.md § 5, approved 2026-10-10)
--   The hp plays a "banking" animation once per streak day, re-enacting yesterday's
--   minutes flowing into the running total. "Once" is per ACCOUNT across devices
--   (Q1), so the marker must live on the server, and per LANGUAGE (Q3, Q10), because
--   each language has its own yesterday and its own wallet.
--
-- WHAT IT HOLDS
--   The 04:00-local streak date (as server/shared/streakDay.ts → streakDateOf computes
--   it) on which this (user, language)'s banking run last STARTED. NULL = never.
--   The run is owed today iff yesterday's minutes > 0 AND this value is not today.
--
-- PRESENTATIONAL ONLY
--   Minutes are banked the moment they are earned (UserLanguagesDAL.incrementPoints);
--   this column records that a re-enactment was shown, never that a balance moved.
--   Nothing reads it except UserMinutePointsService.getLanguageSummary.
--
-- Expand-only: nullable, no default, no backfill. Old code ignores it.

ALTER TABLE user_languages
  ADD COLUMN IF NOT EXISTS "lastBankingShownDate" DATE NULL;

COMMENT ON COLUMN user_languages."lastBankingShownDate" IS
  'Streak date (04:00-local) on which the hp daily banking animation last started for this (user, language). NULL = never. Presentational only — see docs/DAILY_MINUTE_BANKING.md.';
