-- Migration 68: Add `enrichmentLog` per-entry provenance to both dictionary tables
--
-- Records, per entry, the last time each backfill/enrichment script ran on that row
-- and which version of the script it was. Shape (jsonb object keyed by script id):
--
--   {
--     "chinese/backfill-long-definitions": { "ranAt": "2026-06-07T01:53:16.907Z", "version": 10 },
--     "chinese/backfill-parts-of-speech":  { "ranAt": "2026-06-07T01:52:21.886Z", "version": 2 }
--   }
--
-- Why: the run-log (server/logs/backfill-runs.jsonl) is run-granular and only records
-- the --words a run TARGETED, not which rows were actually updated, and full runs log
-- nothing per entry. This column gives true per-entry provenance so we can query e.g.
-- "discoverable zh entries whose longDefinition predates v10" and re-enrich exactly those.
--
-- Written by stampEntryRun() in server/scripts/backfill/run-log.js: every backfill
-- script stamps this column for each row it updates, merging its own key (so other
-- scripts' entries are preserved). The script id matches the run-log `script` field.
--
-- Idempotent: safe to re-run.

ALTER TABLE dictionaryentries_zh
  ADD COLUMN IF NOT EXISTS "enrichmentLog" jsonb NOT NULL DEFAULT '{}'::jsonb;

ALTER TABLE dictionaryentries_es
  ADD COLUMN IF NOT EXISTS "enrichmentLog" jsonb NOT NULL DEFAULT '{}'::jsonb;

COMMENT ON COLUMN dictionaryentries_zh."enrichmentLog" IS
  'Per-entry provenance: {script_id: {ranAt, version}} recording the last run time and SCRIPT_VERSION of each backfill script that touched this row. Maintained by stampEntryRun() in server/scripts/backfill/run-log.js.';

COMMENT ON COLUMN dictionaryentries_es."enrichmentLog" IS
  'Per-entry provenance: {script_id: {ranAt, version}} recording the last run time and SCRIPT_VERSION of each backfill script that touched this row. Maintained by stampEntryRun() in server/scripts/backfill/run-log.js.';
