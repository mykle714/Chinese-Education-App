-- Migration 180: dictionaryentries_zh."superpositionGroups" — Superposition's tile groups for
-- a single character, stored once instead of computed on every device at every deal
-- (docs/SUPERPOSITION_GAME.md § Stored groups).
--
-- SHAPE. jsonb, an array of stroke-index arrays, one per tile: 照 → [[0,1,2,3],[4,5],[6,7,8],[9,10,11,12]].
-- The indices are positions in the character's hanzi-writer-data `strokes`. Each group is
-- sorted, and groups are in stroke order. Together they partition the strokes exactly; the
-- client checks that (server/contracts/superpositionGroups.ts → isStrokePartition) and
-- computes its own when a stored value does not fit.
--
-- SINGLE-CHARACTER ROWS ONLY. A word's tiles are its characters' tiles, so a multi-character
-- row stays NULL and a deal reads each character's own row. NULL also means "not computed
-- yet", and the client then computes.
--
-- WRITER. server/scripts/backfill/chinese/backfill-superposition-groups.ts, a deterministic
-- re-run of the client's rule (server/contracts/superpositionGroups.ts → groupStrokes). It
-- refuses to write while FEATURE_FLAGS.superpositionStoredGroups is off, which it is, so this
-- column stays empty until the rule is approved.
--
-- READER. server/dal/implementations/WritingGridDAL.ts → findSuperpositionGroups, called only
-- while the flag is on. The shipped code never selects this column with the flag off, so
-- the migration may run before or after the deploy.
--
-- Expand-only and idempotent.

ALTER TABLE dictionaryentries_zh
    ADD COLUMN IF NOT EXISTS "superpositionGroups" JSONB;

COMMENT ON COLUMN dictionaryentries_zh."superpositionGroups" IS
    'Superposition tile groups for a single character: stroke-index arrays (hanzi-writer-data stroke order), one per tile, partitioning the strokes. NULL on multi-character rows and when not yet computed. Written by backfill-superposition-groups.ts while FEATURE_FLAGS.superpositionStoredGroups is on. Migration 180.';
