-- Migration 185: drop the Night Market and Immersive World tables, the
-- `users."isTemplateAuthor"` grant, and the cron-installed NM schedule function.
--
-- Owner's decision, 2026-11-09: both features are fully deprecated (they were already
-- behind flags that were OFF). The code was removed from main and archived on the
-- `archive/night-market-immersive-world` branch / tag
-- `archive/night-market-immersive-world-2026-11-09`, whose archive/schema.sql holds a
-- schema-only dump of every table dropped here. Data was deliberately NOT kept.
-- See docs/ARCHIVED_FEATURES.md and docs/NM_IW_REMOVAL_DEPLOY_RUNBOOK.md.
--
-- What each object was:
--   nightmarketunlocks             NM occupants             (migrations 47, 113, 114, 130)
--   nightmarkettemplatelocations   NM placements            (112, 130)
--   nightmarkettemplatedefinitions NM authored template catalog (107–109)
--   nightmarkettemplatesandbox     NM author scratch layout (116–118)
--   iw_scenes / iw_scene_runs / iw_scene_ratings / iw_npc_memories
--                                  Immersive World          (158–163, 167)
--   users."isTemplateAuthor"       the NM/IW author grant   (115). Its last other use, the
--                                  Beginner Keyboard debug dump, moved to isFeatureTester.
--   nightmarket_unlocks_for_minutes(int)
--                                  created by database/cron/expire-stale-streaks.sql on PPE
--                                  (never by a migration); the cron no longer installs it.
--
-- KEPT: users.gender / users."birthDate" (migration 164). They were added for IW NPCs
-- but are collected in Settings and Register and read by the profile.
--
-- DEPLOY ORDER: safe under the standard /deploy, which brings the new code up BEFORE
-- running migrations — the new code reads none of these objects (UserDAL.findById no
-- longer selects "isTemplateAuthor"). Running this BEFORE the new code is live would
-- 500 every authenticated request (the old findById names the column).
--
-- CASCADE: the only foreign keys involved run between these tables themselves
-- (unlocks → locations, runs/ratings/memories → scenes), plus outward FKs to users.
-- No other table references them.
--
-- Verification (expect 0 rows, then 0 rows, then 0 rows):
--   SELECT table_name FROM information_schema.tables
--    WHERE table_schema = 'public' AND (table_name LIKE 'nightmarket%' OR table_name LIKE 'iw\_%');
--   SELECT column_name FROM information_schema.columns
--    WHERE table_name = 'users' AND column_name = 'isTemplateAuthor';
--   SELECT proname FROM pg_proc WHERE proname = 'nightmarket_unlocks_for_minutes';
--
-- Idempotent: safe to re-run.

BEGIN;

DROP TABLE IF EXISTS nightmarketunlocks CASCADE;
DROP TABLE IF EXISTS nightmarkettemplatelocations CASCADE;
DROP TABLE IF EXISTS nightmarkettemplatesandbox CASCADE;
DROP TABLE IF EXISTS nightmarkettemplatedefinitions CASCADE;

DROP TABLE IF EXISTS iw_npc_memories CASCADE;
DROP TABLE IF EXISTS iw_scene_ratings CASCADE;
DROP TABLE IF EXISTS iw_scene_runs CASCADE;
DROP TABLE IF EXISTS iw_scenes CASCADE;

ALTER TABLE users DROP COLUMN IF EXISTS "isTemplateAuthor";

DROP FUNCTION IF EXISTS nightmarket_unlocks_for_minutes(int);

COMMIT;
