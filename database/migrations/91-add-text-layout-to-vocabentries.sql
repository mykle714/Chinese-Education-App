-- Migration 91: Add `textLayout` to the per-language vocabentries (vet) tables
--
-- Persists the flashcard icon-editor's MOVABLE TEXT placement per card
-- (docs/CARD_ICON_LAYOUT.md "Movable text"). The advanced editor now lets a learner
-- drag / resize / rotate the two back-face text blocks — the FOREIGN word (the
-- Chinese/Spanish characters) and the ENGLISH definition — independently, just like
-- icons. Each block stores its own normalized placement.
--
-- Like `iconLayout` (migration 82), `snapConfig` (migration 88), and `textColors`
-- (migration 89), this is per-user-per-word, so it lives on the vet row
-- (identity (userId, entryKey, language)) — NOT on the shared det row.
--
-- Shape (jsonb object; NULL = both blocks at their default lower-third placement). Each
-- block is optional; an absent block renders at its default spot:
--   {
--     "foreign": { "x": 0.5, "y": 0.60, "scale": 1, "rotation": 0, "locked": false },
--     "english": { "x": 0.5, "y": 0.73, "scale": 1, "rotation": 0 }
--   }
-- x/y = block CENTER as a fraction of card width/height; scale multiplies the block's
-- base font size; rotation in degrees. No flipX (mirrored text is unreadable) and no z
-- (text always paints ABOVE the icon layer; the two blocks keep a fixed order).
--
-- Written together with `iconLayout` by the same PATCH /api/vocabEntries/:id/icon-layout
-- (folded into the editor's Save), so Cancel discards text-move changes too.
-- Reset-to-default clears it to NULL alongside the layout. The community copy path leaves
-- the column untouched (text placement is not shared for now).
--
-- The column flows into reads automatically: vocab reads select `ve.*` and the zh read
-- wrapper (vetReadFrom) uses `SELECT *`, so no select-list changes are needed.
--
-- Idempotent: safe to re-run.

ALTER TABLE vocabentries_zh
  ADD COLUMN IF NOT EXISTS "textLayout" jsonb;

ALTER TABLE vocabentries_es
  ADD COLUMN IF NOT EXISTS "textLayout" jsonb;

COMMENT ON COLUMN vocabentries_zh."textLayout" IS
  'Per-card movable-text placement (jsonb {foreign?,english?}, each {x,y,scale,rotation,locked?}). NULL = default lower-third layout. See docs/CARD_ICON_LAYOUT.md.';

COMMENT ON COLUMN vocabentries_es."textLayout" IS
  'Per-card movable-text placement (jsonb {foreign?,english?}, each {x,y,scale,rotation,locked?}). NULL = default lower-third layout. See docs/CARD_ICON_LAYOUT.md.';
