-- Rename dictionaryentries.hskLevelTag to hskLevel for consistency with API/types.
-- Safe to re-run: no-op if already renamed.

DO $$
BEGIN
  IF EXISTS (
    SELECT 1
    FROM information_schema.columns
    WHERE table_schema = 'public'
      AND table_name = 'dictionaryentries'
      AND column_name = 'hskLevelTag'
  ) THEN
    ALTER TABLE dictionaryentries RENAME COLUMN "hskLevelTag" TO "hskLevel";
  END IF;
END
$$;

COMMENT ON COLUMN dictionaryentries."hskLevel" IS 'HSK proficiency level tag (HSK1-HSK6). Set during data import or AI backfill';
