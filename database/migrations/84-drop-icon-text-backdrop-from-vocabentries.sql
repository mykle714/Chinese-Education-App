-- Migration 84: Drop `iconTextBackdrop` from the per-language vocabentries (vet) tables
--
-- Reverses migration 83. The white text-backdrop affordance (a solid white box behind
-- the card's word text, for legibility over a busy icon arrangement) has been removed
-- from the Custom Card Icon Layout feature (docs/CARD_ICON_LAYOUT.md) — the editor no
-- longer exposes the toggle and the card never draws the backdrop. The column is now
-- dead, so drop it from both vet tables.
--
-- Idempotent: safe to re-run.

ALTER TABLE vocabentries_zh
  DROP COLUMN IF EXISTS "iconTextBackdrop";

ALTER TABLE vocabentries_es
  DROP COLUMN IF EXISTS "iconTextBackdrop";
