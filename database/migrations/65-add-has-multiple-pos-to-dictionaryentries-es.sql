-- Migration 65: Add `hasMultiplePos` flag to dictionaryentries_es
--
-- Now that the Spanish det is keyed by (word1, pos) and a word1 can have several
-- discoverable rows (one per part of speech — e.g. `vivir` as verb AND noun,
-- `perro` as noun AND adjective), the client needs to know whether to disambiguate
-- an entry with a POS badge like "(v)" / "(n)".
--
-- `hasMultiplePos` is a per-row denormalization of a per-word1 fact: it is TRUE on
-- every row of a word1 that has more than one discoverable POS row, FALSE otherwise.
-- The client shows the POS badge only when this is TRUE (a single-POS word needs no
-- disambiguation). It is maintained by
-- server/scripts/backfill/spanish/backfill-parts-of-speech.js as it materializes
-- the per-POS rows.
--
-- Chinese (dictionaryentries_zh) is single-row-per-word1 and is untouched.
-- Idempotent: safe to re-run.

ALTER TABLE dictionaryentries_es ADD COLUMN IF NOT EXISTS "hasMultiplePos" BOOLEAN NOT NULL DEFAULT FALSE;

COMMENT ON COLUMN dictionaryentries_es."hasMultiplePos" IS
  'TRUE when this word1 has more than one discoverable POS row, so the client should show a POS badge (e.g. "(v)") to disambiguate. Maintained by backfill-parts-of-speech.js.';
