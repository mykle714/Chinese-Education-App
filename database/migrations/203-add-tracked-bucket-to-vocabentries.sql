-- Migration 203: add the 'tracked' starterPackBucket value to the vet tables.
--
-- WHY
-- Since migration 140, 'provisional' has meant "a card the server LENT so a game/flp
-- could reach its baseline". The lend path re-lends held provisional rows before it
-- mints new ones (ProvisionalCardDAL.findHeldProvisional), and the post-round "sort
-- these cards" offer lists them (listProvisionalKeys), so membership of that bucket is
-- what the lending system reads.
--
-- But four other paths also wrote 'provisional', just to get a hidden row that marks
-- can land on:
--   1. character rows created when a word's writing is marked
--      (VocabEntryDAL.ensureCharacterMarkStates);
--   2. character rows created to be studied — Writing Grid, Superposition and the
--      writing flp's deck (server/dal/shared/writingDeck.ts → ensureCharacterRows);
--   3. a sort that was undone after the card earned marks (VocabEntryDAL.undoSortedRow);
--   4. "Remove from Learning" (VocabEntryDAL.demoteLibraryRowToProvisional).
-- None of those was lent, so they leaked into lending: a learner could be handed a
-- word they had just removed, or a bare character, as a "lent" card. Lending targets
-- new users, so that surface has to stay clean.
--
-- HOW IT'S ADDRESSED
-- A fourth value, 'tracked': a row that exists ONLY to hold progress. It is not in the
-- learner's deck (like 'provisional', every sorted read excludes it) and it is never
-- lent (unlike 'provisional', the lend path never reads it). Sorting a tracked row
-- promotes it in place exactly like a lent one, so its marks survive.
--
-- NO BACKFILL (decided 2026-11-22). Nothing on an existing row records which path
-- created it, so existing 'provisional' rows stay as they are; only rows written from
-- now on land in 'tracked'.
--
-- Docs: docs/PROVISIONAL_CARDS.md § "Tracked rows"
-- Reversible: yes (see the DOWN block at the bottom).

BEGIN;

ALTER TABLE vocabentries_zh
  DROP CONSTRAINT IF EXISTS chk_zh_starter_pack_bucket;

ALTER TABLE vocabentries_zh
  ADD CONSTRAINT chk_zh_starter_pack_bucket
  CHECK ("starterPackBucket" IN ('library', 'skip', 'provisional', 'tracked'));

ALTER TABLE vocabentries_es
  DROP CONSTRAINT IF EXISTS chk_es_starter_pack_bucket;

ALTER TABLE vocabentries_es
  ADD CONSTRAINT chk_es_starter_pack_bucket
  CHECK ("starterPackBucket" IN ('library', 'skip', 'provisional', 'tracked'));

COMMENT ON COLUMN vocabentries_zh."starterPackBucket" IS
  'Sorting bucket. library = the user deliberately sorted this card into Learning. provisional = a card the server LENT so a game/flp could meet its baseline; hidden from sorted reads, re-lendable (docs/PROVISIONAL_CARDS.md). tracked = a hidden row that only holds progress (character rows, removed or un-sorted cards); hidden from sorted reads and never lent (migration 203). skip is vestigial — skips live in discover_skips since migration 80.';

COMMENT ON COLUMN vocabentries_es."starterPackBucket" IS
  'Sorting bucket. library = the user deliberately sorted this card into Learning. provisional = a card the server LENT so a game/flp could meet its baseline; hidden from sorted reads, re-lendable (docs/PROVISIONAL_CARDS.md). tracked = a hidden row that only holds progress (character rows, removed or un-sorted cards); hidden from sorted reads and never lent (migration 203). skip is vestigial — skips live in discover_skips since migration 80.';

COMMIT;

-- ── DOWN (manual) ────────────────────────────────────────────────────────────
-- Folds tracked rows back into 'provisional' (their pre-203 home), keeping marks.
--
-- BEGIN;
-- UPDATE vocabentries_zh SET "starterPackBucket" = 'provisional' WHERE "starterPackBucket" = 'tracked';
-- UPDATE vocabentries_es SET "starterPackBucket" = 'provisional' WHERE "starterPackBucket" = 'tracked';
-- ALTER TABLE vocabentries_zh DROP CONSTRAINT chk_zh_starter_pack_bucket;
-- ALTER TABLE vocabentries_zh ADD CONSTRAINT chk_zh_starter_pack_bucket
--   CHECK ("starterPackBucket" IN ('library','skip','provisional'));
-- ALTER TABLE vocabentries_es DROP CONSTRAINT chk_es_starter_pack_bucket;
-- ALTER TABLE vocabentries_es ADD CONSTRAINT chk_es_starter_pack_bucket
--   CHECK ("starterPackBucket" IN ('library','skip','provisional'));
-- COMMIT;
