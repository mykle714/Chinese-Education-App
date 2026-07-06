-- Migration 99: Add `selectedSense` to the per-language vocabentries (vet) tables
--
-- Persists a learner's chosen definition-cluster sense per card (docs/DEFINITION_CLUSTERS.md).
-- A polysemous Chinese entry carries orthogonal sense clusters (`definitionClusters`,
-- migration 90); the flashcard/EnglishBlock sense picker lets the learner switch which
-- sense the card shows. That choice was previously ephemeral (reset to the starred/default
-- sense on every entry change); this column persists it PER USER PER WORD.
--
-- WHY a text label (the cluster's `sense` string) and NOT an index:
--   The picker addresses clusters by their position in the vernacular-sorted list, but that
--   ordering is derived at render time from each cluster's `vernacularScore`. A stored index
--   would silently repoint at a DIFFERENT meaning if the entry is ever re-clustered or
--   re-scored. The `sense` label is the stable identity of a cluster, so it's what we store.
--   On read the client resolves the label back to a sorted index; if the label no longer
--   exists (the entry was re-clustered), it falls back to the default/starred sense (index 0).
-- NULL = no explicit choice = show the default/starred sense (highest vernacular register).
--
-- Per-user-per-word, like `iconLayout` (migration 82), `snapConfig` (88), `textColors` (89),
-- `textLayout` (91), and `cardColor` (94) — so it lives on the vet row (identity
-- (userId, entryKey, language)), NOT on the shared det entry. This is exactly why the
-- read-only dictionary cdp (a det-fallback VocabEntry with no userId) never carries a value
-- here and always renders the default sense.
--
-- Written by its own lightweight PATCH /api/vocabEntries/:id/selected-sense (the sense
-- picker is available during normal review, outside the icon editor's Save flow).
--
-- The column flows into reads automatically: vocab reads select `ve.*` and the zh read
-- wrapper (vetReadFrom) uses `SELECT *`, so no select-list changes are needed.
--
-- Idempotent: safe to re-run.

ALTER TABLE vocabentries_zh
  ADD COLUMN IF NOT EXISTS "selectedSense" text;

ALTER TABLE vocabentries_es
  ADD COLUMN IF NOT EXISTS "selectedSense" text;

COMMENT ON COLUMN vocabentries_zh."selectedSense" IS
  'Per-card chosen definitionClusters sense (the cluster''s `sense` label). NULL = default/starred sense. See docs/DEFINITION_CLUSTERS.md.';

COMMENT ON COLUMN vocabentries_es."selectedSense" IS
  'Per-card chosen definitionClusters sense (the cluster''s `sense` label). NULL = default/starred sense. See docs/DEFINITION_CLUSTERS.md.';
