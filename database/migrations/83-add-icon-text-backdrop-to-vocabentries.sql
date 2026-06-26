-- Migration 83: Add `iconTextBackdrop` to the per-language vocabentries (vet) tables
--
-- Part of the "Custom Card Icon Layout" feature (docs/CARD_ICON_LAYOUT.md). When a
-- card has icons placed behind its text, the text can be hard to read against busy
-- icons. This per-card boolean toggles a solid white backdrop behind the card's word
-- text so it stays legible over any arrangement.
--
-- Lives next to `iconLayout` (migration 82) on the vet row because it is part of the
-- same per-user-per-word custom presentation. Saved/cleared together with the layout
-- via PATCH /api/vocabEntries/:id/icon-layout.
--
-- Default false (no backdrop). Idempotent: safe to re-run.

ALTER TABLE vocabentries_zh
  ADD COLUMN IF NOT EXISTS "iconTextBackdrop" boolean NOT NULL DEFAULT false;

ALTER TABLE vocabentries_es
  ADD COLUMN IF NOT EXISTS "iconTextBackdrop" boolean NOT NULL DEFAULT false;

COMMENT ON COLUMN vocabentries_zh."iconTextBackdrop" IS
  'When true, the card draws a solid white backdrop behind its word text so it stays legible over a custom icon arrangement. See docs/CARD_ICON_LAYOUT.md.';

COMMENT ON COLUMN vocabentries_es."iconTextBackdrop" IS
  'When true, the card draws a solid white backdrop behind its word text so it stays legible over a custom icon arrangement. See docs/CARD_ICON_LAYOUT.md.';
