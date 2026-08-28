-- Migration 155: Add `note` to the per-language vocabentries (vet) tables
--
-- A learner's own free-text note about ONE of their cards — the thing the dictionary
-- can't tell them ("my landlord says this one", "don't confuse with 借"). Shown at the
-- BOTTOM of the card's SIDE 2 only (the answer face), and edited in place there via the
-- card-operations rail's `note` cell, which replaced that rail's `delete` cell.
--
-- Per-user-per-word, so it lives on the vet row (identity (userId, entryKey, language))
-- exactly like `iconLayout` (82), `snapConfig` (88), `textColors` (89), `textLayout` (91),
-- `cardColor` (94) and `selectedSense` (99) — NOT on the shared det entry. Two learners
-- studying the same word keep separate notes.
--
-- Stored as plain text, NULL = no note. The 200-character cap is enforced in the service
-- (VocabEntryService.updateNote) rather than as a `varchar(200)`: a length change is then a
-- code deploy instead of a table rewrite, and the server normalizes (trim, collapse a
-- blank note to NULL) in the same place. The column is deliberately unconstrained so a
-- future cap raise needs no migration.
--
-- Written by PATCH /api/vocabEntries/:id/note. The column flows into reads automatically —
-- vocab reads select `ve.*` and the zh read wrapper (vetReadFrom) uses `SELECT *` — so no
-- select-list changes are needed.
--
-- Idempotent: safe to re-run.

ALTER TABLE vocabentries_zh
  ADD COLUMN IF NOT EXISTS "note" text;

ALTER TABLE vocabentries_es
  ADD COLUMN IF NOT EXISTS "note" text;

COMMENT ON COLUMN vocabentries_zh."note" IS
  'Learner''s own note about this card (<=200 chars, enforced in VocabEntryService.updateNote). NULL = no note. Shown on card side 2. See docs/CARD_NOTES.md.';

COMMENT ON COLUMN vocabentries_es."note" IS
  'Learner''s own note about this card (<=200 chars, enforced in VocabEntryService.updateNote). NULL = no note. Shown on card side 2. See docs/CARD_NOTES.md.';
