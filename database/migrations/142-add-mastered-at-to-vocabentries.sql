-- Migration 142: Add `masteredAt` to the vet tables — when a card last became mastered.
--
-- See docs/MASTERY_REWORK.md § "masteredAt" and docs/DECKS_FEATURE.md § "Sort by".
--
-- ── Why a stored column and not a derived value ───────────────────────────────
-- Every other mastery fact in this app is DERIVED: `category` is computed from
-- `typedMarkHistory` by compute_utcm_category() / computeUtcm(), never stored.
-- "When did this card become mastered" is the one mastery fact that CANNOT be
-- derived, because `typedMarkHistory` is a ROLLING WINDOW of the last 8 marks per
-- type. The marks that actually pushed the card over the mastery line have usually
-- been evicted from that window by the time anyone asks, so replaying the history
-- cannot find the crossing moment. The transition is only observable at the instant
-- it happens — exactly like a band promotion (migration 137), which is stored for
-- the same reason.
--
-- ── Semantics: sticky, last crossing ──────────────────────────────────────────
-- Written on every un-mastered → mastered transition, and NEVER cleared when the
-- card regresses. It answers "the most recent time this card crossed into
-- mastered", so a card that dipped to comfortable for one bad mark keeps a usable
-- date instead of losing its history to a single slip.
--
-- The one exception is UNDO: undoing the very mark that stamped the column clears
-- it back to NULL (flashcardRoutes /undoLastMark), mirroring how an undone mark
-- deletes its `category_promotions` row. NULL rather than the previous date because
-- the previous date is not recoverable — see the rolling-window note above.
--
-- ── Goal toggles do NOT touch this column, by design ──────────────────────────
-- Toggling an account's reading/writing goal re-bands EVERY card without any mark
-- being written, and none of that movement is recorded here. Intended: this column
-- records when the LEARNER carried a card over the line, and a goal toggle is the
-- learner moving the line, not the card. A sweep on goal change would overwrite
-- every real study date with one bulk timestamp and destroy the sort it exists for.
-- Do not add one.
--
-- ── NOT backfilled ────────────────────────────────────────────────────────────
-- Cards that are already mastered stay NULL. The true crossing moment is not
-- recoverable for them (rolling window again), and the "sort by recently mastered"
-- reader puts NULLs last, so they simply sit at the bottom until they are reviewed
-- across the line again.
--
-- ── No index ──────────────────────────────────────────────────────────────────
-- Sorting by this column happens CLIENT-SIDE over an already-loaded collection
-- (src/utils/vocabSort.ts); no query orders or filters on it. Add an index only if
-- a server-side ORDER BY ever appears.
--
-- Idempotent: safe to re-run.

ALTER TABLE vocabentries_zh ADD COLUMN IF NOT EXISTS "masteredAt" timestamptz;
ALTER TABLE vocabentries_es ADD COLUMN IF NOT EXISTS "masteredAt" timestamptz;

COMMENT ON COLUMN vocabentries_zh."masteredAt" IS
  'Most recent moment this card crossed into the mastered utcm band. Sticky across regression; NULL = never observed crossing (includes every card mastered before migration 142).';
COMMENT ON COLUMN vocabentries_es."masteredAt" IS
  'Most recent moment this card crossed into the mastered utcm band. Sticky across regression; NULL = never observed crossing (includes every card mastered before migration 142).';
