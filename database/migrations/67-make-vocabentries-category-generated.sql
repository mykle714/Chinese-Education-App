-- Migration 67: Make vocabentries.category a GENERATED STORED column derived from markHistory
--
-- BACKGROUND
-- `category` (Unfamiliar / Target / Comfortable / Mastered) is a card's progress
-- level. It drives the entire flashcard-learn (flp) selection pipeline:
--   - working-loop distribution buckets (1 Mastered / 2 Comfortable / 2 Unfamiliar / 5 Target),
--   - replacement preference + fallback order in getNextLibraryCardWithFallback,
--   - the per-category cooldown window in isCardOnCooldown,
--   - the Side-2 progress chip in the UI.
-- It was a plain column written by application code (the /api/flashcards/mark and
-- undo endpoints, StarterPacks "already-learned" seeding, the add-to-library
-- insert). Every writer derived it the same way: bucket the count of correct marks
-- in the last 8 reviews. Because nothing enforced that, any code path (or seed SQL)
-- that wrote `category` WITHOUT a matching `markHistory` produced drift — a card
-- could be labelled 'Target' with an empty history, then "snap" to 'Unfamiliar' on
-- its first real mark. (Observed on the reader-vocab test account.)
--
-- NEW MODEL
-- Make `category` a single-source-of-truth GENERATED ALWAYS AS (...) STORED column
-- computed from `markHistory`. The DB now derives it, so it can never disagree with
-- the mark history again, and reads (incl. the WHERE category = X filters in the
-- working-loop queries) are identical in cost to a plain stored column. The bucketing
-- lives in the IMMUTABLE function compute_flashcard_category(jsonb), which mirrors
-- server/server.ts calculateCategoryFromMarkHistory exactly:
--   correct-in-last-8 <= 2 -> Unfamiliar, <= 5 -> Target, <= 7 -> Comfortable, else Mastered.
--
-- DATA EFFECT
-- A STORED generated column is recomputed for every existing row when added, so no
-- backfill is needed. Existing rows whose stored category disagreed with their
-- markHistory are corrected on the spot (e.g. fabricated 'Target'/'Comfortable' rows
-- with empty history become 'Unfamiliar'; genuine 8/8 rows stay 'Mastered').
--
-- CALLER CHANGES (see same PR)
-- No code may write `category` anymore (Postgres rejects INSERT/UPDATE targeting a
-- generated column). The mark/undo endpoints now read it back via RETURNING; the
-- StarterPacks mastered path relies on its 8/8 markHistory write; add-to-library
-- and the dead VocabEntryDAL.updateCategory drop the column entirely.
--
-- Postgres requires generation expressions to use only IMMUTABLE functions; a
-- user-defined IMMUTABLE function qualifies. NOTE: because the generated columns
-- depend on this function, changing the thresholds later means dropping the two
-- generated columns, replacing the function, then re-adding the columns (a function
-- a generated column depends on cannot be freely redefined in place).
--
-- Only the live per-language vet tables are touched. The legacy base `vocabentries`
-- table (superseded by the migration-66 split) is no longer read or written by code,
-- so it is intentionally left as-is.
-- Idempotent: safe to re-run.

-- Bucket the count of correct marks among the last 8 reviews into a progress level.
-- IMMUTABLE so it can back a generated column. COALESCE guards a NULL history;
-- an empty array yields 0 correct -> 'Unfamiliar'.
CREATE OR REPLACE FUNCTION compute_flashcard_category(mark_history jsonb)
RETURNS varchar(20)
LANGUAGE sql
IMMUTABLE
AS $$
  SELECT CASE
    WHEN correct_count <= 2 THEN 'Unfamiliar'
    WHEN correct_count <= 5 THEN 'Target'
    WHEN correct_count <= 7 THEN 'Comfortable'
    ELSE 'Mastered'
  END
  FROM (
    -- Count correct marks among the most recent 8 (last 8 by array position).
    SELECT count(*) FILTER (WHERE (recent.elem ->> 'isCorrect')::boolean) AS correct_count
    FROM (
      SELECT elem
      FROM jsonb_array_elements(COALESCE(mark_history, '[]'::jsonb))
             WITH ORDINALITY AS arr(elem, ord)
      ORDER BY ord DESC
      LIMIT 8
    ) AS recent
  ) AS counts;
$$;

-- Swap each table's plain `category` column for a generated one. There is no
-- in-place "add a generation expression" ALTER, so drop and re-add. The new column
-- lands at the end of the column list (cosmetic only; all reads are by name / ve.*).
ALTER TABLE vocabentries_zh DROP COLUMN IF EXISTS category;
ALTER TABLE vocabentries_zh
  ADD COLUMN category varchar(20)
  GENERATED ALWAYS AS (compute_flashcard_category("markHistory")) STORED;

ALTER TABLE vocabentries_es DROP COLUMN IF EXISTS category;
ALTER TABLE vocabentries_es
  ADD COLUMN category varchar(20)
  GENERATED ALWAYS AS (compute_flashcard_category("markHistory")) STORED;

COMMENT ON COLUMN vocabentries_zh.category IS
  'Progress level, GENERATED from markHistory via compute_flashcard_category(). Read-only: never write this column.';
COMMENT ON COLUMN vocabentries_es.category IS
  'Progress level, GENERATED from markHistory via compute_flashcard_category(). Read-only: never write this column.';
