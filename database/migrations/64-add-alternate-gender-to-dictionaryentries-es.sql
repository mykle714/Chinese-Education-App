-- Migration 64: Collapse gender out of the Spanish det logical key
--
-- BACKGROUND
-- `dictionaryentries_es` was keyed by (word1, pos, gender) because Spanish has
-- gender-homographs: the same spelling can carry two genders with *different*
-- meanings (e.g. `cura`/f = "cure" vs `cura`/m = "priest"). The importer split
-- those into separate rows. Analysis of the live data:
--   - 74,590 (word1,pos) groups have a single gender,
--   -    486 have exactly two genders,
--   -      6 have three (always with a redundant meta-token: mfbysense/mfequiv).
-- The two-gender groups are themselves a mix:
--   - ~327 are common-gender nouns where the meta-token row repeats the SAME
--     meaning ("agente" m = "agent", mfbysense = "agent") — no distinct sense.
--   - ~140 are true homographs with a distinct meaning per gender.
--
-- NEW MODEL
-- Key the table by (word1, pos). For a true gender-homograph, the *most common*
-- sense becomes the row's primary meaning; the secondary gender's gloss is parked
-- in two new scalar columns so the card can note "also m.: priest":
--   - alternateGender  — the secondary gender token (m / f / mf / …)
--   - alternateMeaning  — a short human-readable gloss of that secondary sense
-- Same-meaning meta-token rows are folded into the primary (no alternate written).
-- The collapse itself (choosing primary, writing alternates, removing the folded
-- rows) is performed by the AI agent in
-- server/scripts/backfill/spanish/backfill-parts-of-speech.js.
--
-- This migration only adds the (nullable) columns. The unique-constraint swap from
-- uq_es_word1_pos_gender → a (word1, pos) key is a SEPARATE follow-up migration
-- that can only run once every (word1,pos) group has been collapsed to one row
-- (otherwise the new constraint would be violated by the ~492 not-yet-collapsed
-- groups). Until then both shapes coexist: collapsed words have one row per pos;
-- uncollapsed words still have their original per-gender rows.
--
-- Chinese (dictionaryentries_zh) has no gender concept and is untouched.
-- Idempotent: safe to re-run.

ALTER TABLE dictionaryentries_es ADD COLUMN IF NOT EXISTS "alternateGender" VARCHAR(50);
ALTER TABLE dictionaryentries_es ADD COLUMN IF NOT EXISTS "alternateMeaning" TEXT;

COMMENT ON COLUMN dictionaryentries_es."alternateGender" IS
  'Secondary grammatical gender for a gender-homograph whose primary sense lives in this row''s gender/definitions. NULL when the word has a single gender or is common-gender. Set by backfill-parts-of-speech.js.';
COMMENT ON COLUMN dictionaryentries_es."alternateMeaning" IS
  'Short gloss of the secondary-gender sense named by alternateGender (e.g. "priest" when the primary cura sense is "cure"). NULL when alternateGender is NULL.';
