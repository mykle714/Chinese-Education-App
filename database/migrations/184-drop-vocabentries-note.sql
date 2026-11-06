-- Migration 184: drop `note` from the per-language vocabentries (vet) tables.
--
-- Owner's decision, 2026-11-05: the card-note feature is removed entirely. `note` was a
-- learner's free-text note on one card (migration 155), shown on the card's answer face
-- and edited from the card's `•••` rail. With note gone that rail held only `customize`,
-- so the rail was deleted too and Customize moved to the word-tools rail above the card
-- (src/components/WordToolsRail.tsx). Existing notes are discarded on purpose.
--
-- DEPLOY ORDER: safe under the standard /deploy, which brings the new code up BEFORE
-- running migrations. The new code neither reads nor writes `note` (vet reads select
-- `ve.*` / `SELECT *`, which simply return one column fewer). Running this BEFORE the new
-- code is live would break the old code's PATCH /api/vocabEntries/:id/note, which names
-- the column — a rare write, and the only reader of it.
--
-- Verification (expect 0 rows):
--   SELECT table_name, column_name FROM information_schema.columns
--    WHERE table_name IN ('vocabentries_zh', 'vocabentries_es') AND column_name = 'note';
--
-- Idempotent: safe to re-run.

ALTER TABLE vocabentries_zh DROP COLUMN IF EXISTS "note";
ALTER TABLE vocabentries_es DROP COLUMN IF EXISTS "note";
