-- Migration 89: Add `textColors` to the per-language vocabentries (vet) tables
--
-- Persists the flashcard icon-editor's CONTRAST setting per card (docs/CARD_ICON_LAYOUT.md).
-- The advanced editor's "Contrast" menu lets a learner force the card's text color
-- independently for the FOREIGN characters (the Chinese/Spanish word glyphs) and the
-- ENGLISH definition. Each is one of: 'theme' (follow the device/app theme — the default),
-- 'dark' (force black), or 'light' (force white). The pinyin overlay is never affected.
--
-- Like `iconLayout` (migration 82) and `snapConfig` (migration 88), this is
-- per-user-per-word, so it lives on the vet row (identity (userId, entryKey, language)) —
-- NOT on the shared det icon.
--
-- Shape (jsonb object; NULL = both 'theme'):
--   { "foreign": "dark", "english": "theme" }
--
-- Written together with `iconLayout` by the same PATCH /api/vocabEntries/:id/icon-layout
-- (folded into the editor's Save), so Cancel discards contrast changes too. Reset-to-default
-- clears it to NULL alongside the layout.
--
-- The column flows into reads automatically: vocab reads select `ve.*` and the zh read
-- wrapper (vetReadFrom) uses `SELECT *`, so no select-list changes are needed.
--
-- Idempotent: safe to re-run.

ALTER TABLE vocabentries_zh
  ADD COLUMN IF NOT EXISTS "textColors" jsonb;

ALTER TABLE vocabentries_es
  ADD COLUMN IF NOT EXISTS "textColors" jsonb;

COMMENT ON COLUMN vocabentries_zh."textColors" IS
  'Per-card flashcard text-color overrides (jsonb {foreign,english}, each theme|dark|light). NULL = both theme. See docs/CARD_ICON_LAYOUT.md.';

COMMENT ON COLUMN vocabentries_es."textColors" IS
  'Per-card flashcard text-color overrides (jsonb {foreign,english}, each theme|dark|light). NULL = both theme. See docs/CARD_ICON_LAYOUT.md.';
