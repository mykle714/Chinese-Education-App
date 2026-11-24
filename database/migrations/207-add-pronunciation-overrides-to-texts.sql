-- Migration 207: Add `pronunciationOverrides` to the `texts` table (Reader reading choices)
--
-- A Chinese word with several readings (了 le/liǎo, 得 de/dé/děi, 还 hái/huán, …) shows
-- its DEFAULT reading everywhere in the Reader. Tapping the headword of the Reader's
-- dictionary keycap (the rdb) cycles the SELECTED OCCURRENCE through the word's distinct
-- `definitionClusters[].reading` values; the choice changes that occurrence's pinyin in the
-- Pinyin view, the keycap headword and every clip spoken for it (tap-to-hear, the speaker,
-- read-aloud). Cycling back to the default removes the entry.
--
-- Shape: a JSON array of { start, end, text, reading }
--   start / end — the occurrence's [start, end) character offsets in `content`
--   text        — content.slice(start, end) when the choice was made; an entry whose text
--                 no longer matches the content is dropped (TextService)
--   reading     — numbered pinyin, one syllable per character, space-separated ("de2")
--
-- Offsets are kept in step with edits on the client ("shift only": a choice before the
-- edited stretch stays, one after it moves by the length difference, one inside it is
-- dropped — src/reading/pronunciationOverrides.ts → shiftPronunciationOverrides) and the
-- server re-checks every entry against the stored content on each update.
--
-- jsonb on the row rather than a side table (owner's call 2026-11-23): it is only ever read
-- and written whole, together with the document.
--
-- Docs: docs/USER_DOCUMENT_FEATURE_SUMMARY.md § "Reading choices".
-- Additive with a default: safe for a standard /deploy. Idempotent: safe to re-run.

ALTER TABLE texts
  ADD COLUMN IF NOT EXISTS "pronunciationOverrides" JSONB NOT NULL DEFAULT '[]'::jsonb;

COMMENT ON COLUMN texts."pronunciationOverrides" IS
  'Reader reading choices: [{start, end, text, reading}] — per-occurrence numbered-pinyin overrides for multi-reading words, chosen by tapping the rdb headword. Migration 207.';
