-- Migration 177: Derive sort_packs level from its cards; drop the authored column
--
-- A pack's level used to be hand-authored in `sort_packs.level` (migration 93). It is
-- now DERIVED at read time as MAX(det.difficulty) over the pack's "entryIds" — the
-- level of its hardest card — by server/dal/implementations/SortPacksDAL.ts
-- (`_packsWithLevelSql`). Authors only pick cards and a "packOrder"; they never
-- choose a level, and a pack follows its cards when a word's difficulty is
-- re-assessed (backfill-hsk-level, validator Difficulty chip) with no drift to repair.
--
-- "packOrder" is now a language-wide curation key: packs are served in packOrder
-- WITHIN whichever level they derive to (docs/SORT_PACKS_IMPLEMENTATION.md § 2).
--
-- Deploy-safe in the standard /deploy order (containers rebuilt, THEN migrations run):
-- the code that stops reading `level` is already live when this drops it.
--
-- Idempotent: IF EXISTS / IF NOT EXISTS guards make a re-run a no-op.

DROP INDEX IF EXISTS sort_packs_lang_level_order;

ALTER TABLE sort_packs DROP COLUMN IF EXISTS level;

CREATE INDEX IF NOT EXISTS sort_packs_lang_order ON sort_packs(language, "packOrder");

COMMENT ON COLUMN sort_packs."packOrder"
  IS 'Language-wide curation key (sparse: 10, 20, 30…). Packs are served in packOrder within their DERIVED level = MAX(det.difficulty) over entryIds (migration 177).';
