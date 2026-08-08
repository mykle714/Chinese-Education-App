-- Migration 140: add the 'provisional' starterPackBucket value to the vet tables.
--
-- WHY
-- Until now every game and the flashcards learn page (flp) enforced a MINIMUM card
-- count and refused to start below it ("You need 20 Learn Now cards to play Bubble
-- Match — you have 3"). That gate is gone. Those minimums are now BASELINES: when a
-- user enters a surface without enough sorted cards, the server auto-fills the gap
-- with words drawn from the level closest to the user's, ordered by commonality
-- (`frequencyScore`), and hands them to the player as TEMPORARY cards.
--
-- Those temporary cards have to live in vet, because that is the only place a mark
-- can be recorded against — a game must be able to fire marks at them and have the
-- progress stick. But they are NOT part of the user's Learn Now deck: the user never
-- chose them, so they must stay invisible to every "my cards" surface (search,
-- library lists, the community feed, reading-highlight ownership) until the user
-- sorts them for real.
--
-- HOW IT'S ADDRESSED
-- A third bucket value, 'provisional'. A vet row in this bucket is a real row with a
-- real id and a real typedMarkHistory — marks work exactly as they do for a sorted
-- card — but it is excluded from every sorted-only read.
--
-- The two predicates are centralized in server/dal/shared/vetTable.ts:
--   vetSortedClause()   → "starterPackBucket" = 'library'                (deck / search reads)
--   vetPlayableClause() → "starterPackBucket" IN ('library','provisional') (game / flp reads)
--
-- WHY A NEW VALUE RATHER THAN NULL
-- NULL would have made the existing `= 'library'` filters exclude these rows for
-- free, but it also drops the NOT NULL guarantee and makes the state invisible in
-- psql. An explicit value keeps the column NOT NULL and is self-documenting; the
-- cost is that every vet reader had to be audited, which migration 140's companion
-- commit does.
--
-- A provisional row is promoted in place by the sort flow
-- (StarterPacksService.sortCard): the bucket is UPDATEd to 'library' and nothing
-- else on the row is touched, so marks earned while the card was temporary survive
-- being sorted.
--
-- Docs: docs/PROVISIONAL_CARDS.md
-- Reversible: yes (see the DOWN block at the bottom).

BEGIN;

-- ── Chinese vet ──────────────────────────────────────────────────────────────
ALTER TABLE vocabentries_zh
  DROP CONSTRAINT IF EXISTS chk_zh_starter_pack_bucket;

ALTER TABLE vocabentries_zh
  ADD CONSTRAINT chk_zh_starter_pack_bucket
  CHECK ("starterPackBucket" IN ('library', 'skip', 'provisional'));

-- ── Spanish vet ──────────────────────────────────────────────────────────────
ALTER TABLE vocabentries_es
  DROP CONSTRAINT IF EXISTS chk_es_starter_pack_bucket;

ALTER TABLE vocabentries_es
  ADD CONSTRAINT chk_es_starter_pack_bucket
  CHECK ("starterPackBucket" IN ('library', 'skip', 'provisional'));

COMMENT ON COLUMN vocabentries_zh."starterPackBucket" IS
  'Sorting bucket. library = the user deliberately sorted this card into Learn Now. provisional = a temporary card the server auto-granted so a game/flp could meet its baseline; it accepts marks but is hidden from every sorted-only read until the user sorts it (docs/PROVISIONAL_CARDS.md). skip is vestigial — skips live in discover_skips since migration 80.';

COMMENT ON COLUMN vocabentries_es."starterPackBucket" IS
  'Sorting bucket. library = the user deliberately sorted this card into Learn Now. provisional = a temporary card the server auto-granted so a game/flp could meet its baseline; it accepts marks but is hidden from every sorted-only read until the user sorts it (docs/PROVISIONAL_CARDS.md). skip is vestigial — skips live in discover_skips since migration 80.';

-- Provisioning asks "how many playable rows does this user hold for this language?"
-- and "which of these det words does the user already hold?" on every game/flp entry.
-- The existing (userId, entryKey, language) unique index answers the second; this
-- partial index keeps the bucket-filtered count off a full per-user scan.
CREATE INDEX IF NOT EXISTS idx_vocabentries_zh_provisional
  ON vocabentries_zh ("userId", language)
  WHERE "starterPackBucket" = 'provisional';

CREATE INDEX IF NOT EXISTS idx_vocabentries_es_provisional
  ON vocabentries_es ("userId", language)
  WHERE "starterPackBucket" = 'provisional';

COMMIT;

-- ── DOWN (manual) ────────────────────────────────────────────────────────────
-- Provisional rows are not user-chosen data, so the rollback DELETES them rather
-- than promoting them into anyone's deck. Any marks earned on them are discarded.
--
-- BEGIN;
-- DELETE FROM vocabentries_zh WHERE "starterPackBucket" = 'provisional';
-- DELETE FROM vocabentries_es WHERE "starterPackBucket" = 'provisional';
-- DROP INDEX IF EXISTS idx_vocabentries_zh_provisional;
-- DROP INDEX IF EXISTS idx_vocabentries_es_provisional;
-- ALTER TABLE vocabentries_zh DROP CONSTRAINT chk_zh_starter_pack_bucket;
-- ALTER TABLE vocabentries_zh ADD CONSTRAINT chk_zh_starter_pack_bucket
--   CHECK ("starterPackBucket" IN ('library','skip'));
-- ALTER TABLE vocabentries_es DROP CONSTRAINT chk_es_starter_pack_bucket;
-- ALTER TABLE vocabentries_es ADD CONSTRAINT chk_es_starter_pack_bucket
--   CHECK ("starterPackBucket" IN ('library','skip'));
-- COMMIT;
