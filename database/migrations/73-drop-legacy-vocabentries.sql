-- Migration 73: Drop the legacy `vocabentries` table
--
-- WHY
-- Migration 66 split vet into per-language tables (vocabentries_zh / vocabentries_es)
-- and intentionally left the original `vocabentries` table in place as a
-- non-destructive backup "until the code cutover is verified; a later migration
-- drops it." This is that migration.
--
-- SAFETY
-- The cutover is verified: all live runtime access (VocabEntryDAL, setup.ts,
-- services, controllers) routes through the split tables via
-- server/dal/shared/vetTable.ts. The split tables are now the source of truth and
-- have diverged from the legacy snapshot (they hold more rows, because every write
-- since migration 66 went only to them). No code reads or writes the bare table.
--
-- The shared sequence `vocabentries_id_seq` must SURVIVE — it is still the default
-- for both vocabentries_zh.id and vocabentries_es.id (see migration 66). Postgres
-- created the sequence as OWNED BY vocabentries.id, so a plain DROP TABLE would
-- cascade-drop the sequence and break both split tables. Detach the ownership first
-- (OWNED BY NONE) so the sequence is decoupled from the legacy table and persists.
--
-- Idempotent: safe to re-run.

ALTER SEQUENCE IF EXISTS vocabentries_id_seq OWNED BY NONE;

DROP TABLE IF EXISTS vocabentries;
