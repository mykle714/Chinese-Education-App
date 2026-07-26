-- Migration 122: Rename "vernacularScore" → "frequencyScore" (both det tables + zh cluster jsonb)
--
-- WHY: the column was introduced (migration 41) as a REGISTER score — how
-- spoken/colloquial a word feels vs. how written/literary. But every consumer
-- that reads it actually wants FREQUENCY — how often a learner will meet the
-- word in everyday conversation:
--
--   - server/dal/shared/segmentString.ts            gsa tie-break: prefer the commoner candidate
--   - server/dal/implementations/DictionaryDAL.ts   search relevance ordering
--   - server/services/StarterPacksService.ts        card order within a pack + pack ranking
--   - server/dal/implementations/VocabEntryDAL.ts   quick-mark universe gate (3–5)
--   - server/utils/definitions.ts                   dd picks the top-scoring sense cluster
--
-- Under register semantics a colloquial-but-rare word outranked a very common
-- register-neutral one (自由 "freedom" scored 3 — neutral register — and lost to
-- rarer slang at 5). Renaming the column and re-pointing the rubric at
-- everyday-conversation frequency makes the name match what the data is used for.
--
-- SCOPE: this migration is a pure RENAME. Existing values are register scores and
-- are deliberately KEPT in place (per product decision) so nothing goes blank; they
-- are re-scored under the new rubric by re-running the backfills with --stale
-- (SCRIPT_VERSION was bumped, so staleClause() picks up every already-stamped row):
--   docker exec cow-backend-local npx tsx scripts/backfill/chinese/backfill-frequency-score.js --stale
--   docker exec cow-backend-local npx tsx scripts/backfill/spanish/backfill-frequency-score.js --stale
--   docker exec cow-backend-local npx tsx scripts/backfill/chinese/backfill-cluster-definitions.js --stale
-- Until those runs complete, the stored numbers still mean "register".

-- Wrapped in one transaction: migrate.sh applies each file with a plain `psql -f`
-- (no --single-transaction) and only records schema_migrations AFTER the file exits
-- 0. Without BEGIN/COMMIT a mid-file failure would leave the rename half-applied and
-- untracked, and the retry would then fail on the already-renamed column.
BEGIN;

-- 1. Chinese det (cdet)
ALTER TABLE dictionaryentries_zh
  RENAME COLUMN "vernacularScore" TO "frequencyScore";

COMMENT ON COLUMN dictionaryentries_zh."frequencyScore" IS
  'AI-generated everyday-conversation frequency (1-5): 5=heard constantly in daily casual speech, 4=common, 3=moderately common, 2=uncommon in speech, 1=almost never spoken (literary/technical/archaic). NULL = not yet scored. See scripts/backfill/chinese/backfill-frequency-score.js';

-- 2. Spanish det (sdet)
ALTER TABLE dictionaryentries_es
  RENAME COLUMN "vernacularScore" TO "frequencyScore";

COMMENT ON COLUMN dictionaryentries_es."frequencyScore" IS
  'AI-generated everyday-conversation frequency (1-5): 5=heard constantly in daily casual speech, 4=common, 3=moderately common, 2=uncommon in speech, 1=almost never spoken (literary/technical/archaic). NULL = not yet scored. See scripts/backfill/spanish/backfill-frequency-score.js';

-- 3. The same-named key INSIDE each zh definitionClusters element (migration 90).
--    Per-cluster scores are written by backfill-cluster-definitions.js on the
--    identical scale, so the key renames with the column. Rebuilt element-wise:
--    for every cluster object that carries the old key, add the new key with the
--    old value and drop the old key; objects without it pass through untouched.
--    WITH ORDINALITY + ORDER BY ord preserves cluster order (index 0 is the
--    starred default sense that vocabentries."selectedSense" indexes into).
UPDATE dictionaryentries_zh
SET "definitionClusters" = (
  SELECT jsonb_agg(
    CASE
      WHEN cluster ? 'vernacularScore'
        THEN (cluster - 'vernacularScore') || jsonb_build_object('frequencyScore', cluster -> 'vernacularScore')
      ELSE cluster
    END
    ORDER BY ord
  )
  FROM jsonb_array_elements("definitionClusters") WITH ORDINALITY AS t(cluster, ord)
)
WHERE "definitionClusters" IS NOT NULL
  AND jsonb_typeof("definitionClusters") = 'array'
  AND jsonb_array_length("definitionClusters") > 0;

COMMENT ON COLUMN dictionaryentries_zh."definitionClusters" IS
  'Sense clusters (migration 90): [{sense, reading, pos, frequencyScore, glosses}]. frequencyScore is the same 1-5 everyday-conversation frequency scale as the word-level column, scored per cluster.';

-- 4. The run-log stamp key in "enrichmentLog" (run-log.js keys stamps by script id,
--    and the scripts were renamed alongside the column). Renaming the key rather
--    than dropping it preserves each row's run history; the scripts' SCRIPT_VERSION
--    was bumped to 2, so staleClause() still sees every row as stale and --stale
--    re-scores it under the new frequency rubric.
UPDATE dictionaryentries_zh
SET "enrichmentLog" = ("enrichmentLog" - 'chinese/backfill-vernacular-score')
  || jsonb_build_object('chinese/backfill-frequency-score', "enrichmentLog" -> 'chinese/backfill-vernacular-score')
WHERE "enrichmentLog" ? 'chinese/backfill-vernacular-score';

UPDATE dictionaryentries_es
SET "enrichmentLog" = ("enrichmentLog" - 'spanish/backfill-vernacular-score')
  || jsonb_build_object('spanish/backfill-frequency-score', "enrichmentLog" -> 'spanish/backfill-vernacular-score')
WHERE "enrichmentLog" ? 'spanish/backfill-vernacular-score';

COMMIT;
