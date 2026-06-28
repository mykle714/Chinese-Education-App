-- Migration 88: Add `snapConfig` to the per-language vocabentries (vet) tables
--
-- Persists the flashcard icon-editor's SNAP toggles per card (docs/CARD_ICON_LAYOUT.md).
-- The advanced editor has three independent snap toggles (move / rotate / resize) that
-- quantize each gesture to a discrete increment. Previously these were editor-only and
-- reset on every exit; they now persist per saved word so re-opening the editor on a card
-- restores the snap setup the learner last used there.
--
-- Like `iconLayout` (migration 82), this is per-user-per-word, so it lives on the vet row
-- (identity (userId, entryKey, language)) — NOT on the shared det icon.
--
-- Shape (jsonb object; NULL = no snap, i.e. all three off):
--   { "move": true, "rotate": false, "resize": true }
--
-- Written together with `iconLayout` by the same PATCH /api/vocabEntries/:id/icon-layout
-- (folded into the editor's Save), so Cancel discards snap changes too. Reset-to-default
-- clears it to NULL alongside the layout.
--
-- The column flows into reads automatically: vocab reads select `ve.*` and the zh read
-- wrapper (vetReadFrom) uses `SELECT *`, so no select-list changes are needed.
--
-- Idempotent: safe to re-run.

ALTER TABLE vocabentries_zh
  ADD COLUMN IF NOT EXISTS "snapConfig" jsonb;

ALTER TABLE vocabentries_es
  ADD COLUMN IF NOT EXISTS "snapConfig" jsonb;

COMMENT ON COLUMN vocabentries_zh."snapConfig" IS
  'Per-card snap toggles for the flashcard icon editor (jsonb {move,rotate,resize} booleans). NULL = all off. See docs/CARD_ICON_LAYOUT.md.';

COMMENT ON COLUMN vocabentries_es."snapConfig" IS
  'Per-card snap toggles for the flashcard icon editor (jsonb {move,rotate,resize} booleans). NULL = all off. See docs/CARD_ICON_LAYOUT.md.';
