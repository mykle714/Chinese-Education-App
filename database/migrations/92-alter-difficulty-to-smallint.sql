-- Migration 92: Convert dictionaryentries_*.difficulty from varchar to smallint
--
-- `difficulty` holds the generalized 1..6 difficulty band (for zh these ARE HSK
-- levels: 1 = HSK1 .. 6 = HSK6; for es it is learner-acquisition difficulty).
-- Migration 79 dropped the stored 'HSK' prefix and standardized on the bare
-- integer scale, but left the COLUMN as `character varying(10)` storing string
-- digits ('1'..'6'). That allowed a stale backfill script to silently reinsert
-- 'HSK1'/'HSK2' tokens (see server/scripts/backfill/chinese/backfill-hsk-level.js,
-- since fixed). Making the column a true `smallint` finishes migration 79's
-- intent: a non-numeric token like 'HSK1' can no longer be stored at all (the
-- cast fails), and CAST(... AS INTEGER) workarounds in callers (e.g.
-- StarterPacksService level sort) become unnecessary.
--
-- No CHECK constraint by design — smallint already rejects the 'HSK' tag; the
-- 1..6 range is enforced by the producing backfill, not the schema.
--
-- Data is already clean (every non-null value matches ^[1-6]$), so the
-- `USING difficulty::smallint` cast is lossless. NULL stays NULL.
--
-- TS side: DifficultyLevel union becomes the numeric 1|2|..|6 and the
-- `difficulty` fields become `number | null` (server/types/index.ts, src/types.ts).
--
-- Idempotent: re-running on an already-smallint column is a no-op cast.

ALTER TABLE dictionaryentries_zh
  ALTER COLUMN difficulty TYPE smallint USING difficulty::smallint;

ALTER TABLE dictionaryentries_es
  ALTER COLUMN difficulty TYPE smallint USING difficulty::smallint;

COMMENT ON COLUMN dictionaryentries_zh.difficulty IS
  'Difficulty band 1..6 (= HSK level for zh). smallint; NULL = not yet assigned. See migration 79/92.';

COMMENT ON COLUMN dictionaryentries_es.difficulty IS
  'Difficulty band 1..6 (learner-acquisition difficulty for es). smallint; NULL = not yet assigned. See migration 79/92.';
