-- Migration 69: Adjust compute_flashcard_category() band thresholds
--
-- BACKGROUND
-- `category` (Unfamiliar / Target / Comfortable / Mastered) is a GENERATED STORED
-- column on every per-language vet table (migration 67), derived from `markHistory`
-- by the IMMUTABLE function compute_flashcard_category(jsonb). The function buckets
-- the count of correct marks among the last 8 reviews into a progress band.
--
-- CHANGE
-- Re-band the correct-in-last-8 count so the progress levels are:
--     0-1 -> Unfamiliar   (was 0-2)
--     2-4 -> Target       (was 3-5)
--     5-6 -> Comfortable  (was 6-7)
--     7-8 -> Mastered     (was 8)
-- This shifts each cutoff down by one mark, so cards graduate to higher bands a
-- little sooner (notably Mastered now starts at 7/8 rather than a perfect 8/8).
--
-- DATA EFFECT
-- Because `category` is a STORED generated column, re-adding it recomputes the value
-- for every existing row using the new function. No separate backfill is needed;
-- existing cards are re-banded in place when the columns are re-added below.
--
-- MECHANICS
-- A generated column depends on the function backing it, so Postgres won't let us
-- redefine the function in place. As in migration 67 we must: drop the two generated
-- columns, CREATE OR REPLACE the function, then re-add the columns. Only the live
-- per-language vet tables (vocabentries_zh / vocabentries_es) carry the column.
-- Idempotent: safe to re-run.

-- Drop the generated columns first so the function it depends on can be replaced.
ALTER TABLE vocabentries_zh DROP COLUMN IF EXISTS category;
ALTER TABLE vocabentries_es DROP COLUMN IF EXISTS category;

-- Re-band the correct-mark count. IMMUTABLE so it can back a generated column.
-- COALESCE guards a NULL history; an empty array yields 0 correct -> 'Unfamiliar'.
CREATE OR REPLACE FUNCTION compute_flashcard_category(mark_history jsonb)
RETURNS varchar(20)
LANGUAGE sql
IMMUTABLE
AS $$
  SELECT CASE
    WHEN correct_count <= 1 THEN 'Unfamiliar'
    WHEN correct_count <= 4 THEN 'Target'
    WHEN correct_count <= 6 THEN 'Comfortable'
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

-- Re-add the generated columns; STORED recomputes them for all existing rows.
ALTER TABLE vocabentries_zh
  ADD COLUMN category varchar(20)
  GENERATED ALWAYS AS (compute_flashcard_category("markHistory")) STORED;

ALTER TABLE vocabentries_es
  ADD COLUMN category varchar(20)
  GENERATED ALWAYS AS (compute_flashcard_category("markHistory")) STORED;

COMMENT ON COLUMN vocabentries_zh.category IS
  'Progress level, GENERATED from markHistory via compute_flashcard_category(). Read-only: never write this column.';
COMMENT ON COLUMN vocabentries_es.category IS
  'Progress level, GENERATED from markHistory via compute_flashcard_category(). Read-only: never write this column.';
