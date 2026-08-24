-- Migration 154: create gloss_meaning_groups — the runtime artifact of the gloss
-- confusability pipeline (docs/GLOSS_CONFUSABILITY.md § 5, phase 2).
--
-- This is the ONLY table of that feature that prod ever sees. The build artifacts
-- (gloss_vectors, gloss_pair_verdicts) are dev-only and are deliberately NOT migrations —
-- they are created by server/scripts/gloss-pipeline/dev-tables.sql on the box that runs
-- the job. Prod never runs a model, never stores a vector, and never needs a GPU.
--
-- Contents: one row per DISTINCT dd key (the output of ddCollisionKey), not per det row.
-- Keying by the string rather than a det id is what lets zh and es share one English
-- space, dedupes repeated glosses, and makes a gloss-rewriting backfill self-healing —
-- a rewritten gloss produces an unseen key rather than a stale row (§ 5, § 7).
--
-- SAFE TO AUTO-RUN, in any order relative to the container rebuild. The table is created
-- EMPTY, and § 6 rule 1 says a gloss with no row imposes no constraint, so until the
-- pipeline pushes data the app behaves exactly as it does today (phase-1 exact-dd guard).
-- Rollback is TRUNCATE (degrade to phase 1) or DROP; no code change is needed for either.
--
-- ⚠️  Source of truth for the DATA in this table is the DEV box, inverting the app-wide
-- rule that prod is authoritative — it is derived data, recomputable from
-- (det corpus, model revision, template version, thresholds). It must therefore be
-- EXCLUDED from /data-prod-to-dev, or a routine dev refresh overwrites dev's freshly
-- computed groups with prod's copy of what dev just sent up. See § 5a.

CREATE TABLE IF NOT EXISTS gloss_meaning_groups (
  -- The normalized display definition. Output of ddCollisionKey (server/utils/definitions.ts).
  "glossKey"        text PRIMARY KEY,

  -- The runtime lookup. Two cards may not share a round if they share this id (§ 6).
  "meaningGroupId"  integer NOT NULL,

  "builtAt"         timestamptz NOT NULL DEFAULT NOW(),

  -- Provenance, so a grouping on prod can always be traced to the build that produced it
  -- and "why are these two grouped?" is answerable without the build tables (§ 5a rule 3).
  "modelRevision"   text NOT NULL,
  "templateVersion" text NOT NULL,
  "corpusSnapshot"  text NOT NULL
);

-- The read path fetches every gloss key in one round's candidate list and asks which ids
-- collide, so lookups are by key (the PK). This index serves the inverse question —
-- "who else is in this group?" — used by the § 8g oversize-group alarm and by any
-- future "why grouped?" diagnostic.
CREATE INDEX IF NOT EXISTS idx_gloss_meaning_groups_group
  ON gloss_meaning_groups ("meaningGroupId");

COMMENT ON TABLE gloss_meaning_groups IS
  'Phase-2 gloss confusability groups (docs/GLOSS_CONFUSABILITY.md). One row per distinct dd key. DERIVED data, built on dev and pushed up; EXCLUDE from /data-prod-to-dev.';
