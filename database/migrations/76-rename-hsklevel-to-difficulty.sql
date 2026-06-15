-- Migration 75: Rename the `hskLevel` column to `difficulty` on both det tables
--
-- The discover/sort-cards flow now treats this column as a generic, per-language
-- DIFFICULTY signal that drives the adaptive band for every supported language,
-- not just Chinese HSK. The column is renamed to reflect that unified concept.
--
-- The stored VALUES are unchanged and remain per-language encoded:
--   - dictionaryentries_zh: 'HSK1'..'HSK6' (the real HSK proficiency label, still
--     surfaced to users as an "HSK 3" badge — see EntryDetailPage / InfoCardPanelBody).
--   - dictionaryentries_es: '1'..'5' (learner-acquisition difficulty, 1=easiest..5=hardest).
--
-- Only the column NAME changes; no data is rewritten.
--
-- Idempotent: each rename is guarded so re-running is safe.

DO $$
BEGIN
    IF EXISTS (
        SELECT 1 FROM information_schema.columns
        WHERE table_name = 'dictionaryentries_zh' AND column_name = 'hskLevel'
    ) THEN
        ALTER TABLE dictionaryentries_zh RENAME COLUMN "hskLevel" TO "difficulty";
    END IF;

    IF EXISTS (
        SELECT 1 FROM information_schema.columns
        WHERE table_name = 'dictionaryentries_es' AND column_name = 'hskLevel'
    ) THEN
        ALTER TABLE dictionaryentries_es RENAME COLUMN "hskLevel" TO "difficulty";
    END IF;
END $$;

COMMENT ON COLUMN dictionaryentries_zh."difficulty"
  IS 'Per-language difficulty signal driving the discover band. zh encoding: HSK label ''HSK1''..''HSK6'' (also shown as an HSK badge).';
COMMENT ON COLUMN dictionaryentries_es."difficulty"
  IS 'Per-language difficulty signal driving the discover band. es encoding: learner-acquisition difficulty ''1''..''5'' (1=easiest).';
