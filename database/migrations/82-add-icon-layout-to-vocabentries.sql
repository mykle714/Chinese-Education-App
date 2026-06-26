-- Migration 82: Add `iconLayout` to the per-language vocabentries (vet) tables
--
-- Backs the "Custom Card Icon Layout" feature (docs/CARD_ICON_LAYOUT.md): a learner
-- can compose a custom arrangement of up to 12 icons8 icons on a flashcard's back
-- face. The arrangement is per-user-per-word, so it lives on the vet row (identity
-- (userId, entryKey, language)) rather than on the shared det icon.
--
-- Shape (jsonb array, max 12 items; NULL = no custom layout -> render the default
-- single det icon centered):
--   [{ "iconId": "16017",   -- icons8 natural key (icons8."icons8Id")
--      "x": 0.5, "y": 0.45,  -- icon CENTER as a fraction of card width/height [0..1]
--      "scale": 1.0,         -- multiplier on the base icon box (~0.28 * cardWidth)
--      "rotation": 0,        -- degrees
--      "z": 0 }, ...]        -- paint order (higher = front)
--
-- Coordinates are normalized so a saved layout survives the card being rendered at
-- different pixel sizes across viewports.
--
-- No FK on the ids inside the jsonb (Postgres can't FK into a jsonb array). If an
-- icons8 row is ever deleted, that icon's image endpoint simply 404s and renders
-- nothing — the same risk class as users."avatarIconId" (migration 77).
--
-- The column flows into reads automatically: vocab reads select `ve.*` and the zh
-- read wrapper (vetReadFrom) uses `SELECT *`, so no select-list changes are needed.
--
-- Idempotent: safe to re-run.

ALTER TABLE vocabentries_zh
  ADD COLUMN IF NOT EXISTS "iconLayout" jsonb;

ALTER TABLE vocabentries_es
  ADD COLUMN IF NOT EXISTS "iconLayout" jsonb;

COMMENT ON COLUMN vocabentries_zh."iconLayout" IS
  'Custom flashcard icon arrangement (jsonb array, max 12 of {iconId,x,y,scale,rotation,z}; normalized coords). NULL = use the default centered det icon. See docs/CARD_ICON_LAYOUT.md.';

COMMENT ON COLUMN vocabentries_es."iconLayout" IS
  'Custom flashcard icon arrangement (jsonb array, max 12 of {iconId,x,y,scale,rotation,z}; normalized coords). NULL = use the default centered det icon. See docs/CARD_ICON_LAYOUT.md.';
