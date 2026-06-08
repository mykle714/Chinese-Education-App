-- Migration 72: Add `iconId` to both dictionary-entry (det) tables
--
-- Gives each dictionary entry an optional pointer to a downloaded icons8 icon, so
-- the discover flow can ship a representative icon image alongside each card being
-- offered. The value references the icons8 natural key `icons8Id` (see migration 71).
--
-- ON DELETE SET NULL: if an icon row is ever removed from the icons8 table, the
-- referencing det rows simply lose their icon (iconId -> NULL) rather than blocking
-- the delete or leaving a dangling id.
--
-- Applied to BOTH per-language det tables (dictionaryentries_zh / cdet and
-- dictionaryentries_es / sdet) to keep their schemas consistent and let the discover
-- flow work for either language.
--
-- Idempotent: safe to re-run.

ALTER TABLE dictionaryentries_zh
  ADD COLUMN IF NOT EXISTS "iconId" TEXT;

ALTER TABLE dictionaryentries_es
  ADD COLUMN IF NOT EXISTS "iconId" TEXT;

-- Foreign keys are added separately so the migration stays idempotent (ADD COLUMN
-- IF NOT EXISTS can't carry a named constraint that survives a re-run cleanly).
DO $$
BEGIN
    IF NOT EXISTS (
        SELECT 1 FROM pg_constraint WHERE conname = 'fk_dictionaryentries_zh_icon'
    ) THEN
        ALTER TABLE dictionaryentries_zh
          ADD CONSTRAINT fk_dictionaryentries_zh_icon
          FOREIGN KEY ("iconId") REFERENCES icons8("icons8Id") ON DELETE SET NULL;
    END IF;

    IF NOT EXISTS (
        SELECT 1 FROM pg_constraint WHERE conname = 'fk_dictionaryentries_es_icon'
    ) THEN
        ALTER TABLE dictionaryentries_es
          ADD CONSTRAINT fk_dictionaryentries_es_icon
          FOREIGN KEY ("iconId") REFERENCES icons8("icons8Id") ON DELETE SET NULL;
    END IF;
END $$;

-- Index the FK column: the discover flow joins det -> icons8 on iconId, and an
-- unindexed FK also makes the ON DELETE SET NULL scan slow.
CREATE INDEX IF NOT EXISTS idx_dictionaryentries_zh_icon_id ON dictionaryentries_zh("iconId");
CREATE INDEX IF NOT EXISTS idx_dictionaryentries_es_icon_id ON dictionaryentries_es("iconId");

COMMENT ON COLUMN dictionaryentries_zh."iconId" IS
  'Optional FK to icons8("icons8Id"): representative downloaded icon for this entry, surfaced in the discover flow. ON DELETE SET NULL.';
COMMENT ON COLUMN dictionaryentries_es."iconId" IS
  'Optional FK to icons8("icons8Id"): representative downloaded icon for this entry, surfaced in the discover flow. ON DELETE SET NULL.';
