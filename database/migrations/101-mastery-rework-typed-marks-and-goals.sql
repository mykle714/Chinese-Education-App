-- Migration 101: Mastery rework — typed marks, per-account goals, goal-weighted pbh
--
-- See docs/MASTERY_REWORK.md for the full design.
--
-- WHAT CHANGES
--   1. Each card now tracks FOUR independent mark streams (8 most recent each),
--      one per mark type: Recognition / Production / Reading / Writing. These live
--      in a new `typedMarkHistory` jsonb keyed by type, replacing the single
--      typeless `markHistory` array.
--   2. A card's utcm `category` (Unfamiliar/Target/Comfortable/Mastered) is no
--      longer a GENERATED column: its new definition (the progress-bar-height, pbh)
--      depends on the ACCOUNT's goal flags (goalCount), which a generated column
--      may not reference (it can only see its own row). So `category` moves to a
--      service-layer / in-query compute via compute_utcm_category(...), and the
--      stored generated column + compute_flashcard_category() are dropped.
--   3. Accounts gain `readingGoal` / `writingGoal` boolean flags. Recognition +
--      Production are always goals (mandatory, not stored); Reading/Writing are
--      per-account opt-in. Spanish accounts never set them (no es reading/writing
--      mark source), but the flags are language-agnostic in the schema.
--   4. The per-mark success-rate columns (totalSuccessRate / last8SuccessRate /
--      last16SuccessRate) are dropped — the new model doesn't use them. The
--      lifetime aggregates totalMarkCount / totalCorrectCount are kept.
--
-- DATA EFFECT
--   No backfill. Existing mark history is DISCARDED (no real customers yet — see
--   docs). `typedMarkHistory` defaults to '{}' so every card starts fresh (all
--   tracks empty → all positive counts 0 → 'Unfamiliar').
--
-- pbh FORMULA (mirrored in compute_utcm_category below and in the TS masteryCompute
-- util for the client progress bar):
--   positive(track) = count of isCorrect marks among that track's <=8-entry window
--                     (empty window slots count as negatives, i.e. just don't add).
--   goals           = {recognition, production} (+reading if readingGoal, +writing
--                     if writingGoal); goalCount ∈ {2,3,4}.
--   pbh = LEAST(6, max positive among goals)
--         + (sum of the remaining goals' positives) / ((goalCount - 1) * 3)
--   Bands: pbh<3 Unfamiliar; <6 Target; <8 Comfortable; else Mastered.
--
-- Idempotent: safe to re-run.

-- ── 1. Drop the old generated category column (both vet tables) ────────────────
-- Must precede dropping compute_flashcard_category(), which it depends on.
ALTER TABLE vocabentries_zh DROP COLUMN IF EXISTS category;
ALTER TABLE vocabentries_es DROP COLUMN IF EXISTS category;

DROP FUNCTION IF EXISTS compute_flashcard_category(jsonb);

-- ── 2. New mastery-compute functions ──────────────────────────────────────────

-- Count the positive (isCorrect) marks in one type's mark array. NULL/absent → 0.
-- The array already holds <=8 entries; missing entries are implicitly negative
-- (they simply don't contribute), which is the "empty window slots are negative"
-- rule from the design.
CREATE OR REPLACE FUNCTION mastery_positive_count(track jsonb)
RETURNS int
LANGUAGE sql
IMMUTABLE
AS $$
  SELECT COALESCE(
    count(*) FILTER (WHERE (e ->> 'isCorrect')::boolean),
    0
  )::int
  FROM jsonb_array_elements(COALESCE(track, '[]'::jsonb)) AS e;
$$;

-- Derive the utcm category from a card's typedMarkHistory and the account's goal
-- flags. IMMUTABLE so it can be spliced into WHERE/SELECT of the selection queries
-- (which JOIN users to supply the goal flags). Mirrors the TS masteryCompute util.
CREATE OR REPLACE FUNCTION compute_utcm_category(
  typed_mark_history jsonb,
  reading_goal boolean,
  writing_goal boolean
)
RETURNS varchar(20)
LANGUAGE plpgsql
IMMUTABLE
AS $$
DECLARE
  h            jsonb := COALESCE(typed_mark_history, '{}'::jsonb);
  goals        int[];
  goal_count   int;
  max_val      int;
  sum_val      int;
  first_term   numeric;
  second_term  numeric;
  pbh          numeric;
BEGIN
  -- Mandatory goals: recognition + production.
  goals := ARRAY[
    mastery_positive_count(h -> 'recognition'),
    mastery_positive_count(h -> 'production')
  ];
  IF COALESCE(reading_goal, false) THEN
    goals := goals || mastery_positive_count(h -> 'reading');
  END IF;
  IF COALESCE(writing_goal, false) THEN
    goals := goals || mastery_positive_count(h -> 'writing');
  END IF;

  goal_count := array_length(goals, 1);                     -- 2..4
  SELECT max(x), sum(x) INTO max_val, sum_val FROM unnest(goals) AS x;

  first_term := LEAST(6, max_val);                          -- capped at 6
  IF goal_count > 1 THEN
    -- Remaining goals = all but a single instance of the max.
    second_term := (sum_val - max_val)::numeric / ((goal_count - 1) * 3);
  ELSE
    second_term := 0;
  END IF;
  pbh := first_term + second_term;

  RETURN CASE
    WHEN pbh < 3 THEN 'Unfamiliar'
    WHEN pbh < 6 THEN 'Target'
    WHEN pbh < 8 THEN 'Comfortable'
    ELSE 'Mastered'
  END;
END;
$$;

-- ── 3. typedMarkHistory column (both vet tables) ──────────────────────────────
ALTER TABLE vocabentries_zh
  ADD COLUMN IF NOT EXISTS "typedMarkHistory" jsonb NOT NULL DEFAULT '{}'::jsonb;
ALTER TABLE vocabentries_es
  ADD COLUMN IF NOT EXISTS "typedMarkHistory" jsonb NOT NULL DEFAULT '{}'::jsonb;

COMMENT ON COLUMN vocabentries_zh."typedMarkHistory" IS
  'Typed mark streams keyed by type: {recognition,production,reading,writing}, each the <=8 most recent {timestamp,isCorrect}. Drives compute_utcm_category(). See docs/MASTERY_REWORK.md';
COMMENT ON COLUMN vocabentries_es."typedMarkHistory" IS
  'Typed mark streams keyed by type: {recognition,production,reading,writing}, each the <=8 most recent {timestamp,isCorrect}. Drives compute_utcm_category(). See docs/MASTERY_REWORK.md';

-- ── 4. Drop the old typeless history + success-rate columns ───────────────────
ALTER TABLE vocabentries_zh DROP COLUMN IF EXISTS "markHistory";
ALTER TABLE vocabentries_zh DROP COLUMN IF EXISTS "totalSuccessRate";
ALTER TABLE vocabentries_zh DROP COLUMN IF EXISTS "last8SuccessRate";
ALTER TABLE vocabentries_zh DROP COLUMN IF EXISTS "last16SuccessRate";
ALTER TABLE vocabentries_es DROP COLUMN IF EXISTS "markHistory";
ALTER TABLE vocabentries_es DROP COLUMN IF EXISTS "totalSuccessRate";
ALTER TABLE vocabentries_es DROP COLUMN IF EXISTS "last8SuccessRate";
ALTER TABLE vocabentries_es DROP COLUMN IF EXISTS "last16SuccessRate";

-- ── 5. Account goal flags ─────────────────────────────────────────────────────
ALTER TABLE users
  ADD COLUMN IF NOT EXISTS "readingGoal" boolean NOT NULL DEFAULT false;
ALTER TABLE users
  ADD COLUMN IF NOT EXISTS "writingGoal" boolean NOT NULL DEFAULT false;

COMMENT ON COLUMN users."readingGoal" IS
  'Account opts into the Reading mastery goal (adds the reading track to pbh). See docs/MASTERY_REWORK.md';
COMMENT ON COLUMN users."writingGoal" IS
  'Account opts into the Writing mastery goal (adds the writing track to pbh). See docs/MASTERY_REWORK.md';
