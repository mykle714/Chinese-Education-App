-- Migration 170: per-character writing mastery (+ a one-off reset of every writing mark)
--
-- WHY (docs/WRITING_PRACTICE_REWORK.md § 3a): writing is now tracked per CHARACTER.
--   - A writing result on a multi-character word is fanned out into one mark per
--     character, written to that character's own single-character vet row (created as a
--     hidden 'provisional' row when the learner has none). Those fanned-out marks carry
--     `"viaWord": true` so they never restart the character's own cooldown clock.
--   - The word's own writing track keeps only "dummy" marks (`"clockOnly": true`) —
--     its cooldown clock. They are NOT mastery.
--   - A multi-character word's writing mastery is the AVERAGE of its characters'
--     writing positive counts (0–8, so it is fractional). Computed on read, never
--     stored: every vet read selects it as "writingMastery" (vetTable.ts →
--     `writingMasterySelect`) and the writing bar's band is derived from it
--     (`barCategoryExpr('writing')` → compute_writing_category).
--
-- No schema change — functions only, plus a data reset.
--
-- ── 1. mastery_positive_count ignores clock-only marks ─────────────────────────
-- A word's dummy marks must never count as mastery, wherever a track is counted.
-- Mirrored in TS by `positiveCount` (server/contracts/mastery.ts).
CREATE OR REPLACE FUNCTION mastery_positive_count(track jsonb)
RETURNS int
LANGUAGE sql
IMMUTABLE
AS $$
  SELECT COALESCE(
    count(*) FILTER (
      WHERE (e ->> 'isCorrect')::boolean
        AND COALESCE((e ->> 'clockOnly')::boolean, FALSE) = FALSE
    ),
    0
  )::int
  FROM jsonb_array_elements(COALESCE(track, '[]'::jsonb)) AS e;
$$;

-- ── 2. compute_writing_mastery ─────────────────────────────────────────────────
-- Single character → its own writing positive count.
-- 2+ characters   → the average of each character's single-char row's writing
--                   positive count for this user (a character with no row counts 0).
-- Mirrored in TS by `writingMasteryFromChars` (server/contracts/mastery.ts).
-- STABLE, not IMMUTABLE: it reads other vet rows.
CREATE OR REPLACE FUNCTION compute_writing_mastery(p_user uuid, p_word text, p_history jsonb)
RETURNS double precision
LANGUAGE sql
STABLE
AS $$
  SELECT CASE
    WHEN char_length(p_word) <= 1 THEN
      mastery_positive_count(COALESCE(p_history, '{}'::jsonb) -> 'writing')::double precision
    ELSE (
      SELECT avg(
        COALESCE(
          (SELECT mastery_positive_count(c."typedMarkHistory" -> 'writing')
             FROM vocabentries_zh c
            WHERE c."userId" = p_user AND c."entryKey" = ch AND c.language = 'zh'),
          0
        )
      )::double precision
      FROM regexp_split_to_table(p_word, '') AS ch
    )
  END;
$$;

COMMENT ON FUNCTION compute_writing_mastery(uuid, text, jsonb) IS
  'Writing mastery (0-8, fractional for words): own writing positives for a single character, else the average over its characters'' single-char vet rows. See docs/WRITING_PRACTICE_REWORK.md § 3a';

-- ── 3. compute_writing_category ────────────────────────────────────────────────
-- The writing bar's utcm band from the averaged mastery. Same cut points as
-- compute_type_category / categoryForPbh (3 / 6 / 8).
CREATE OR REPLACE FUNCTION compute_writing_category(p_user uuid, p_word text, p_history jsonb)
RETURNS varchar(20)
LANGUAGE sql
STABLE
AS $$
  SELECT CASE
    WHEN m < 3 THEN 'Unfamiliar'
    WHEN m < 6 THEN 'Target'
    WHEN m < 8 THEN 'Comfortable'
    ELSE 'Mastered'
  END::varchar(20)
  FROM (SELECT compute_writing_mastery(p_user, p_word, p_history) AS m) AS t;
$$;

-- ── 4. Reset: drop every writing mark and writing mastery stamp ────────────────
-- Approved 2026-10-04 (no live customers, test accounts only): the old marks were
-- whole-word marks under the old model and cannot be split onto characters.
-- writing_practice_completions (the stars) is deliberately kept.
UPDATE vocabentries_zh
   SET "typedMarkHistory" = "typedMarkHistory" - 'writing',
       "masteredAt" = CASE WHEN "masteredAt" IS NULL THEN NULL ELSE "masteredAt" - 'writing' END
 WHERE "typedMarkHistory" ? 'writing'
    OR ("masteredAt" IS NOT NULL AND "masteredAt" ? 'writing');

UPDATE vocabentries_es
   SET "typedMarkHistory" = "typedMarkHistory" - 'writing',
       "masteredAt" = CASE WHEN "masteredAt" IS NULL THEN NULL ELSE "masteredAt" - 'writing' END
 WHERE "typedMarkHistory" ? 'writing'
    OR ("masteredAt" IS NOT NULL AND "masteredAt" ? 'writing');

-- category_promotions (velocity) rows for the writing bar are KEPT: they record band
-- climbs that really happened, and velocity is a history, not a derived state.
