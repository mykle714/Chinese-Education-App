-- Migration 128: per-mark-type utcm category (game word-set selection)
--
-- See docs/MASTERY_REWORK.md § "Games select by their own mark type".
--
-- WHY
--   compute_utcm_category() (migration 101) answers "how far along is this card
--   OVERALL", blending every goal track through the pbh formula. That is the right
--   question for the flp (which presents two mark types) and for the decks page,
--   but the WRONG question for a game that only ever exercises ONE track: a card
--   with a maxed Recognition window and an empty Reading window reads as
--   'Comfortable' overall, so Word Search No-Pinyin would serve it as a
--   Comfortable card even though its Reading history is completely empty.
--
--   So each pool-selecting game now buckets candidates by the recent mark history
--   of the single type it emits (bubble-match = recognition, word-search =
--   reading/production by mode).
--
-- BANDS
--   Identical cut points to the overall pbh bands, applied to the raw 0..8
--   positive count of the ONE track (empty window slots count as negative, same
--   rule as mastery_positive_count):
--     0-2 Unfamiliar | 3-5 Target | 6-7 Comfortable | 8 Mastered
--   Note Mastered therefore requires a perfect 8/8 window for that type.
--
-- No schema change — this adds a function only. Mirrored in TS by
-- computeTypeCategory() in server/utils/masteryCompute.ts (and the client copy in
-- src/utils/masteryCompute.ts); keep all three in sync.
--
-- Idempotent: safe to re-run.

CREATE OR REPLACE FUNCTION compute_type_category(
  typed_mark_history jsonb,
  mark_type text
)
RETURNS varchar(20)
LANGUAGE sql
IMMUTABLE
AS $$
  SELECT CASE
    WHEN mastery_positive_count(COALESCE(typed_mark_history, '{}'::jsonb) -> mark_type) < 3 THEN 'Unfamiliar'
    WHEN mastery_positive_count(COALESCE(typed_mark_history, '{}'::jsonb) -> mark_type) < 6 THEN 'Target'
    WHEN mastery_positive_count(COALESCE(typed_mark_history, '{}'::jsonb) -> mark_type) < 8 THEN 'Comfortable'
    ELSE 'Mastered'
  END::varchar(20);
$$;

COMMENT ON FUNCTION compute_type_category(jsonb, text) IS
  'utcm band for ONE mark type''s 8-mark window (0-2/3-5/6-7/8). Used by the game pool queries so a game buckets cards by the track it actually exercises, unlike the goal-blended compute_utcm_category(). See docs/MASTERY_REWORK.md';
