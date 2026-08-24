-- Dev-only build artifacts for the gloss confusability pipeline
-- (docs/GLOSS_CONFUSABILITY.md § 5). Run on the box that runs the job:
--
--   docker exec -i cow-postgres-local psql -U cow_user -d cow_db < dev-tables.sql
--
-- ⚠️ DELIBERATELY NOT A MIGRATION. These tables must never reach prod: they are large
-- (~71 MB of vectors, ~1.25M verdict rows at full det) and are pure build cache. Prod
-- receives only gloss_meaning_groups (migration 154). Putting them in database/migrations/
-- would ship them to prod on the next deploy, which is exactly the split § 5 exists to
-- prevent. Losing them costs a rebuild and nothing else.

-- Step 2 output: one embedding per distinct dd key.
CREATE TABLE IF NOT EXISTS gloss_vectors (
  "glossKey"      text PRIMARY KEY,
  embedding       bytea       NOT NULL,   -- int8-quantized; dims implied by modelRevision
  "modelRevision" text        NOT NULL,
  "updatedAt"     timestamptz NOT NULL DEFAULT NOW()
);

-- Step 4/5 output: the cached cross-encoder verdict for one candidate pair.
--
-- RAW PROBABILITIES, NEVER BOOLEANS (§ 7 rule 1). This is the single most important
-- decision in the maintenance story: with the probabilities stored, retuning a threshold
-- is a SQL re-derivation that runs in seconds; with a boolean stored, every threshold
-- experiment costs a full re-judge (10–104 min). It is what let § 8j close C14 with no
-- model inference at all.
CREATE TABLE IF NOT EXISTS gloss_pair_verdicts (
  "glossKeyA"       text NOT NULL,   -- lexicographically ordered: glossKeyA < glossKeyB
  "glossKeyB"       text NOT NULL,
  cosine            real NOT NULL,   -- bi-encoder, step 3 (kept for analysis; not in the rule)
  "pEntailAb"       real NOT NULL,   -- NLI is DIRECTIONAL; both directions are stored
  "pEntailBa"       real NOT NULL,   -- so mutual entailment = min(ab, ba) is re-derivable
  "pContra"         real NOT NULL,   -- max contradiction over the two directions
  "wordnetAntonym"  boolean NOT NULL DEFAULT FALSE,
  "modelRevision"   text NOT NULL,
  "templateVersion" text NOT NULL,   -- part of the cache key: template wording shifts verdicts
  "judgedAt"        timestamptz NOT NULL DEFAULT NOW(),
  PRIMARY KEY ("glossKeyA", "glossKeyB")
);

-- Step 3 is incremental by set-diff against gloss_vectors, and step 4 by set-diff against
-- this table. Both diffs are membership tests on the PK, so no extra index is needed for
-- the build. This index serves the re-cluster (step 6), which streams every verdict whose
-- pins still match the current build.
CREATE INDEX IF NOT EXISTS idx_gloss_pair_verdicts_revision
  ON gloss_pair_verdicts ("modelRevision", "templateVersion");

COMMENT ON TABLE gloss_vectors IS 'DEV-ONLY build cache (docs/GLOSS_CONFUSABILITY.md § 5). Never deploy.';
COMMENT ON TABLE gloss_pair_verdicts IS 'DEV-ONLY build cache. Raw probabilities so thresholds are re-derivable without re-judging (§ 7 rule 1). Never deploy.';
