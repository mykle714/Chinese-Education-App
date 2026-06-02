-- Migration 59: Add `etymology` column to dictionaryentries_es (Spanish det)
--
-- The Spanish importer (server/scripts/import-esdict-temp.ts) originally parked
-- Wiktionary etymology text in `longDefinition`. That conflicts with the meaning
-- of `longDefinition` elsewhere in the app (a definition *elaboration*, generated
-- by the long-definitions backfill). To keep semantics clean:
--   1. Add a dedicated `etymology` text column.
--   2. Move the imported etymology text out of `longDefinition` into `etymology`.
--   3. Leave `longDefinition` NULL so the Spanish long-definitions backfill
--      (server/scripts/backfill/spanish/backfill-long-definitions.js) can fill it
--      with a real elaboration later.
--
-- Chinese (dictionaryentries_zh) has no etymology concept and is untouched.
--
-- Idempotent: safe to re-run.

ALTER TABLE dictionaryentries_es ADD COLUMN IF NOT EXISTS etymology TEXT;

-- Move imported etymology text from longDefinition -> etymology, then clear
-- longDefinition. Only touch rows that still carry the imported etymology
-- (etymology not yet populated) to avoid clobbering on re-run.
UPDATE dictionaryentries_es
SET etymology = "longDefinition",
    "longDefinition" = NULL
WHERE "longDefinition" IS NOT NULL
  AND etymology IS NULL;

COMMENT ON COLUMN dictionaryentries_es.etymology IS 'Wiktionary-derived etymology text for the headword. Populated by import-esdict-temp.ts. Distinct from longDefinition (a definition elaboration).';
