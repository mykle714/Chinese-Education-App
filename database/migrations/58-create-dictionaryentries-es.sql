-- Migration 58: Create the Spanish det table `dictionaryentries_es`
--
-- WHY THIS MIGRATION EXISTS
-- Until now `dictionaryentries_es` was created only as a side effect of the
-- Spanish importer (server/scripts/import-esdict-temp.ts), which merges its
-- staging table into `dictionaryentries_es`. That importer runs against the large
-- local Spanish source data and is NOT part of a deployment, so on any database
-- where the import has not been run (e.g. prod) the table does not exist. The
-- following migrations (59 etymology, 64 alternateGender/alternateMeaning,
-- 65 hasMultiplePos) and 66 (vocabentries split, which reads dictionaryentries_es)
-- all assume the table exists and would fail with "relation does not exist".
-- This migration codifies the table so the chain applies cleanly everywhere, even
-- where Spanish is not yet user-selectable and the table stays empty.
--
-- SHAPE (mirrors what the importer produces; see CLAUDE.md "Dictionary Tables")
--   - Clone of dictionaryentries_zh (LIKE … INCLUDING DEFAULTS) so it carries the
--     same rich column set. The CJK-only columns (numberedPinyin, tone, hskLevel,
--     breakdown, classifier, …) exist but stay NULL for Spanish.
--   - Its OWN id sequence (dictionaryentries_es_id_seq), NOT the zh sequence the
--     LIKE clone inherits — es and zh ids must not be drawn from the same counter.
--   - es-specific columns: `pos` (scalar part of speech, part of the identity) and
--     `raw` (jsonb source blocks preserved by the importer).
--   - Logical identity (word1, pos, gender) enforced by a UNIQUE NULLS NOT DISTINCT
--     constraint so gender-homographs are separate rows but NULL pos/gender can't
--     duplicate. (`gender` comes from the zh clone — added to zh by migration 55.)
--
-- Columns added by LATER migrations are intentionally NOT created here, so each
-- migration owns its own column: 59 adds `etymology`; 64 adds `alternateGender` +
-- `alternateMeaning`; 65 adds `hasMultiplePos`.
--
-- Idempotent: CREATE TABLE / SEQUENCE / INDEX use IF NOT EXISTS, the ADD COLUMNs
-- use IF NOT EXISTS, and the constraint is added only if absent. Safe to re-run,
-- and a no-op on databases where the importer already created the table.

-- Base table: clone the Chinese det structure (columns + defaults).
CREATE TABLE IF NOT EXISTS dictionaryentries_es (LIKE dictionaryentries_zh INCLUDING DEFAULTS);

-- The LIKE clone copied zh's id DEFAULT (nextval on the zh sequence). Replace it
-- with a dedicated es sequence so the two tables never share an id counter.
ALTER TABLE dictionaryentries_es ALTER COLUMN id DROP DEFAULT;
CREATE SEQUENCE IF NOT EXISTS dictionaryentries_es_id_seq OWNED BY dictionaryentries_es.id;
ALTER TABLE dictionaryentries_es ALTER COLUMN id SET DEFAULT nextval('dictionaryentries_es_id_seq');

-- es-specific columns.
ALTER TABLE dictionaryentries_es ADD COLUMN IF NOT EXISTS pos VARCHAR(50);
ALTER TABLE dictionaryentries_es ADD COLUMN IF NOT EXISTS raw JSONB;

-- Logical identity: (word1, pos, gender), NULLS NOT DISTINCT so a NULL pos/gender
-- cannot create duplicate rows. Added conditionally for re-run safety.
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'uq_es_word1_pos_gender'
  ) THEN
    ALTER TABLE dictionaryentries_es
      ADD CONSTRAINT uq_es_word1_pos_gender
      UNIQUE NULLS NOT DISTINCT (word1, pos, gender);
  END IF;
END $$;

CREATE INDEX IF NOT EXISTS idx_es_word1 ON dictionaryentries_es (word1);

COMMENT ON TABLE dictionaryentries_es IS 'Spanish dictionary entries (sdet). Clone of dictionaryentries_zh + scalar pos + raw (jsonb source). Logical key (word1, pos, gender) via uq_es_word1_pos_gender. Created by migration 58; populated by server/scripts/import-esdict-temp.ts.';
COMMENT ON COLUMN dictionaryentries_es.pos IS 'Scalar part of speech; part of the logical identity (a word1 can have one discoverable row per POS).';
COMMENT ON COLUMN dictionaryentries_es.raw IS 'Full per-POS parsed source blocks (gender, etymology, glosses, syn/q/usage) preserved by the importer.';
