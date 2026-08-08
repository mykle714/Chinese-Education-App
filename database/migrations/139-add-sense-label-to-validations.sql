-- Migration 139: per-sense validation records — add validations."senseLabel".
--
-- WHY
-- Until now every `validations.field` addressed data that lives at the ENTRY level:
-- one `frequencyScore` column, one `difficulty` column, one `partsOfSpeech` array.
-- The eip/cdp "Commonality" chip showed that entry-level `frequencyScore`, so the
-- chip's Approve/Flag pair had exactly one thing to point at.
--
-- Those surfaces now show the SELECTED SENSE's commonality — the per-cluster
-- `frequencyScore` inside `definitionClusters` (migration 90 for zh, 123 for es),
-- which is the honest number for a polyseme (干 "to do" = 5, 干 "shield" = 1). The
-- new `senseFrequencyScore` validation field reviews one cluster of one entry, so a
-- record needs to say WHICH cluster.
--
-- HOW IT'S ADDRESSED
-- By the cluster's `sense` LABEL — the same key `vocabentries_*.selectedSense` uses
-- (migration 99). A label is stable across re-scoring and re-ordering, unlike the
-- sorted index, and it is unique within an entry by construction. See
-- docs/DEFINITION_CLUSTERS.md.
--
-- WHY `NOT NULL DEFAULT ''` AND NOT NULLABLE
-- The column joins the uniqueness key, and Postgres treats NULLs as DISTINCT in a
-- UNIQUE constraint (pre-15 `NULLS DISTINCT` is the only behaviour available). A
-- nullable discriminator would therefore let ONE validator insert unlimited
-- duplicate entry-level rows for the same (entry, field) — silently breaking the
-- "one record per user/field" rule that both submit paths rely on
-- (`ON CONFLICT ON CONSTRAINT validations_unique_per_user`). '' is the sentinel for
-- "entry-level field, no sense" and every existing row gets it from the DEFAULT, so
-- their uniqueness semantics are byte-for-byte what they were before this migration.
--
-- Idempotent: IF EXISTS / IF NOT EXISTS throughout, and the constraint is dropped
-- before being recreated with the wider key.

-- ── 1. the discriminator column ──────────────────────────────────────────────
ALTER TABLE validations
    ADD COLUMN IF NOT EXISTS "senseLabel" TEXT NOT NULL DEFAULT '';

COMMENT ON COLUMN validations."senseLabel" IS
    'Which sense cluster this record reviews, addressed by the cluster''s `sense` label '
    '(definitionClusters[].sense — the same key vocabentries.selectedSense uses). '
    'Empty string = an ENTRY-LEVEL field (definitions / partsOfSpeech / difficulty / '
    'frequencyScore / exampleSentenceN), which has no sense. NOT NULL because it is part '
    'of validations_unique_per_user and Postgres treats NULLs as distinct there. '
    'See docs/DATA_VALIDATION_SYSTEM.md.';

-- ── 2. widen the uniqueness key ──────────────────────────────────────────────
-- Without this a validator could review only ONE sense of a given word: their second
-- sense's UPSERT would collide with the first on (entryId, language, field, validator)
-- and overwrite it.
ALTER TABLE validations
    DROP CONSTRAINT IF EXISTS validations_unique_per_user;

ALTER TABLE validations
    ADD CONSTRAINT validations_unique_per_user
    UNIQUE ("entryId", language, field, "senseLabel", "validatorUserId");

COMMENT ON TABLE validations IS
    'Human validation records (approve/flag + reviewed content) per (entry, field, senseLabel). '
    'Kept off the det tables so prod data deploys (TRUNCATE+restore of dictionaryentries_*) never '
    'wipe them; backfills skip fields recorded here. senseLabel is '''' for entry-level fields and '
    'a definitionClusters[].sense label for per-sense fields. See docs/DATA_VALIDATION_SYSTEM.md.';
