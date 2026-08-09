-- Migration 142: drop the discover `sortable` flag (reverts migration 110)
--
-- Retires the two-tier visibility model. Discover sort / quick-mark / progress and
-- the provisional-card lender all gate on `discoverable = TRUE` again, for every
-- language — the same single flag the dictionary, reader and flashcard surfaces use.
--
-- WHY IT IS BEING REMOVED
-- Migration 110 split "showable as a sort card" (sortable: level-assigned + lead
-- gloss cleaned) from "fully enriched + data-deployed" (discoverable), so a cheap
-- two-step pre-pass could put cards in front of learners long before the 13-step
-- manifest finished. The split only pays for itself if that corpus-wide pre-pass
-- actually runs. It never did: on prod, ~1.3% of the zh corpus was sortable and only
-- ~218 rows were sortable-but-not-discoverable, because the oracle backfill's
-- `--discoverable` heal queue refills on every manifest version bump and starves the
-- `--unsortable` pre-pass scope. So the column bought a few hundred rows of reach
-- while forking every discover supply query on language, adding a second promotion
-- script, a second completeness bar (buildSortableReadyPredicate), a second planner
-- scope, and a corpus invariant (discoverable ⇒ sortable) that every writer of
-- `discoverable` had to remember to maintain. Not worth it — see docs/DISCOVER_FLOW.md.
--
-- EFFECT ON DATA
-- The ~218 sortable-but-not-discoverable rows simply stop appearing in discover.
-- Nothing else is lost: the pre-pass work they carry lives in the `difficulty` and
-- `definitions` columns plus their `enrichmentLog` stamps, so when the rest of the
-- manifest lands they promote to `discoverable` normally. No user data references
-- the flag (no vet/discover_skips column, no client field).
--
-- ⚠️ EXPAND/CONTRACT — THIS IS THE CONTRACT STEP. The code that stopped reading
-- `sortable` must be DEPLOYED BEFORE this file runs, or every discover supply query
-- errors on a missing column. See docs/SORTABLE_DEPRECATION_DEPLOY_RUNBOOK.md.
--
-- Idempotent (IF EXISTS on both drops).

-- ── 1. the partial index that covered the sortable supply queries ─────────────
-- Dropped first and explicitly: DROP COLUMN would cascade to it anyway, but naming it
-- keeps the revert of migration 110 readable and makes a re-run of this file a no-op.
DROP INDEX IF EXISTS idx_dictionary_sortable_language;

-- ── 2. the column ─────────────────────────────────────────────────────────────
ALTER TABLE dictionaryentries_zh
    DROP COLUMN IF EXISTS sortable;
