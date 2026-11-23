-- Migration 205: Adventures (cyoa) — drop stories.difficulty (CONTRACT half of 200/205).
--
-- Renumbered from 201 on 2026-11-23: a held-back contract migration must carry the HIGHEST
-- number in its deploy batch (202–204 landed after it), so the post-rebuild step is a plain
-- in-order `migrate.sh` (CLAUDE.md § "Migration number collisions"). Dev's schema_migrations
-- row was renamed to match.
--
-- ⚠️ HELD BACK: run only AFTER the code that reads `stories.commonality` is live on the
-- server. The code before migration 200 selects `difficulty` (StoryDAL STORY_COLUMNS,
-- listForViewer, publish), so dropping it while that code still serves breaks every
-- /api/stories read. Steps and checks: docs/STORY_COMMONALITY_DEPLOY_RUNBOOK.md.
--
-- The column (migration 196) held a story's HSK 1–6 level; it was replaced by
-- stories.commonality (migration 200) on 2026-11-21. Nothing reads it any more. Its index
-- was already replaced by migration 200.

ALTER TABLE stories DROP COLUMN IF EXISTS difficulty;
