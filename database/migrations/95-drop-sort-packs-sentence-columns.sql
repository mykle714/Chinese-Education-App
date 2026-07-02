-- Migration 95: Drop authored-sentence columns from `sort_packs`
--
-- The sort-cards flow never displayed the authored sentence (docs/SORT_CARDS_REQUIREMENTS.md
-- §4.5) — `sentenceForeign`/`sentenceEnglish` existed only to constrain authoring (every
-- entryId's word had to occur in the sentence, enforced by validate-sort-packs.ts). That
-- constraint is no longer part of the sort-pack story: authoring is just picking up to 3
-- entryIds directly, no sentence required. Drop the now-unused columns.
--
-- Idempotent: guarded with IF EXISTS so re-running is a no-op.

ALTER TABLE sort_packs
    DROP COLUMN IF EXISTS "sentenceForeign",
    DROP COLUMN IF EXISTS "sentenceEnglish";

COMMENT ON TABLE sort_packs
  IS 'Authored discover sort packs: up to 3 det cards (entryIds). Served nearest-level-first by packOrder; fallback packs-of-1 are built on the fly and NOT stored here.';
