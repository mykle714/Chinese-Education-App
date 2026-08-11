-- Migration 143: Three independent mastery bars per card (core / reading / writing).
--
-- See docs/MASTERY_REWORK.md § "Three bars" and docs/MASTERY_BARS_DEPLOY_RUNBOOK.md.
--
-- ── WHAT CHANGES ─────────────────────────────────────────────────────────────
-- Migration 101 made a card's utcm band GOAL-BLENDED: turning on the reading goal
-- folded the reading track into the same pbh that recognition and production fed,
-- so a card the learner had genuinely mastered by sight was demoted the moment they
-- decided they also wanted to read. One number was being asked to mean "how well do
-- you know this word" and "which of four skills have you drilled" at once.
--
-- Those questions split here. A card now carries up to THREE bars, each banded
-- independently by the SAME cut points, so it can be mastered up to three times:
--
--   core    recognition + production, blended by the old pbh formula with the goal
--           count pinned at 2. ALWAYS active. This is the bar every whole-card
--           question means — deck counts, the Review gate, level estimation, the
--           mini-card chip, the community Learning feed.
--   reading the reading track's raw 0..8 positive count. Active only when
--           users."readingGoal".
--   writing likewise, gated on users."writingGoal".
--
-- The goal flags survive but no longer weight anything: they decide which bars are
-- SHOWN (and which collections, sort options and velocity steps exist). Reading and
-- writing marks accrue for everyone either way — the goal only surfaces them.
-- Consequence, and the point of the exercise: toggling a goal can no longer promote
-- or demote a single card.
--
-- ── 1. compute_core_category() ───────────────────────────────────────────────
-- Replaces compute_utcm_category() at every call site. Same formula, minus the goal
-- arguments — which is also why it needs no users JOIN, unlike its predecessor.
--
-- compute_utcm_category() is deliberately LEFT IN PLACE here. It is dead once the
-- new server code deploys, but this migration runs BEFORE that code (it has to —
-- see the masteredAt note below), and the still-running old code calls it on every
-- deck read. Drop it in a follow-up contract migration once prod is verified.
--
-- ── 2. vet."masteredAt" becomes jsonb, keyed by bar ──────────────────────────
-- Three bars cross into mastered at three different moments, so one timestamptz can
-- no longer answer "when did this card become mastered". The column becomes
--   {"core": "<iso>", "reading": "<iso>", "writing": "<iso>"}
-- with keys absent/null until that bar's crossing is observed. Every rule migration
-- 142 established still holds, now PER BAR: sticky across regression, retracted only
-- by undoing the exact mark that stamped it, untouched by goal toggles, and not
-- backfilled (the crossing moment is unrecoverable from the rolling 8-mark window).
--
-- ORDERING: this migration MUST land before the new server code, which reads and
-- writes the jsonb shape. That is safe in both directions here because migration 142
-- has never reached prod — prod gets 142 and 143 back to back and no deployed code
-- has ever written the timestamptz form. On dev the conversion below preserves any
-- existing value under the 'core' key.
--
-- ── 3. category_promotions."bar" ─────────────────────────────────────────────
-- Velocity sums band-steps across the bars a learner is pursuing, so a promotion has
-- to say which bar it moved. Existing rows are all core by construction: before this
-- migration there was only one bar. The DEFAULT is kept (not dropped after backfill)
-- so the old code still inserting without the column stays correct during the deploy
-- window.
--
-- Idempotent: safe to re-run.

-- ── 1. The core-bar band function ────────────────────────────────────────────
-- pbh = LEAST(6, max(recognition, production)) + min(recognition, production) / 3
-- Bands (shared with compute_type_category): <3 Unfamiliar, <6 Target, <8
-- Comfortable, else Mastered. IMMUTABLE so it can be spliced into WHERE/SELECT.
-- Mirrors coreProgressBarHeight() / computeCoreCategory() in
-- server/contracts/mastery.ts — server/__tests__/mastery.test.ts pins the pair.
CREATE OR REPLACE FUNCTION compute_core_category(typed_mark_history jsonb)
RETURNS varchar(20)
LANGUAGE sql
IMMUTABLE
AS $$
  WITH t AS (
    SELECT
      mastery_positive_count(COALESCE(typed_mark_history, '{}'::jsonb) -> 'recognition') AS rec,
      mastery_positive_count(COALESCE(typed_mark_history, '{}'::jsonb) -> 'production')  AS pro
  ), h AS (
    SELECT LEAST(6, GREATEST(rec, pro)) + LEAST(rec, pro)::numeric / 3 AS pbh FROM t
  )
  SELECT CASE
    WHEN pbh < 3 THEN 'Unfamiliar'
    WHEN pbh < 6 THEN 'Target'
    WHEN pbh < 8 THEN 'Comfortable'
    ELSE 'Mastered'
  END::varchar(20) FROM h;
$$;

COMMENT ON FUNCTION compute_core_category(jsonb) IS
  'utcm band of the CORE mastery bar (recognition + production blended: LEAST(6,max) + min/3). Goal-independent, so unlike the superseded compute_utcm_category() it needs no users join. The band every whole-card read means. See docs/MASTERY_REWORK.md';

COMMENT ON FUNCTION compute_utcm_category(jsonb, boolean, boolean) IS
  'SUPERSEDED by compute_core_category() in migration 143 — the reading/writing goals no longer weight a card''s band, they raise their own bars. Retained only so the pre-143 server code keeps working through the deploy window; drop once prod is verified.';

-- ── 2. masteredAt: timestamptz → jsonb keyed by bar ──────────────────────────
-- Guarded by the current column type so a re-run is a no-op rather than an error
-- (ALTER ... USING would fail on an already-converted column).
DO $$
DECLARE
  t text;
BEGIN
  FOREACH t IN ARRAY ARRAY['vocabentries_zh', 'vocabentries_es'] LOOP
    IF EXISTS (
      SELECT 1 FROM information_schema.columns
      WHERE table_name = t AND column_name = 'masteredAt' AND data_type <> 'jsonb'
    ) THEN
      EXECUTE format($f$
        ALTER TABLE %I
        ALTER COLUMN "masteredAt" TYPE jsonb
        USING CASE
          WHEN "masteredAt" IS NULL THEN NULL
          ELSE jsonb_build_object('core', to_char(
            "masteredAt" AT TIME ZONE 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS.MS"Z"'))
        END
      $f$, t);
    END IF;
  END LOOP;
END $$;

-- Covers the case where 142 never ran (a database bootstrapped past it): create the
-- column directly in its final shape.
ALTER TABLE vocabentries_zh ADD COLUMN IF NOT EXISTS "masteredAt" jsonb;
ALTER TABLE vocabentries_es ADD COLUMN IF NOT EXISTS "masteredAt" jsonb;

COMMENT ON COLUMN vocabentries_zh."masteredAt" IS
  'Per-bar mastery crossings: {"core"|"reading"|"writing": <ISO timestamp>}. Most recent moment that bar crossed into Mastered; sticky across regression; key absent/null = crossing never observed (includes every card mastered before migration 142). Written only by POST /api/flashcards/mark, retracted only by undoing the stamping mark, never touched by goal toggles.';
COMMENT ON COLUMN vocabentries_es."masteredAt" IS
  'Per-bar mastery crossings: {"core"|"reading"|"writing": <ISO timestamp>}. Most recent moment that bar crossed into Mastered; sticky across regression; key absent/null = crossing never observed (includes every card mastered before migration 142). Written only by POST /api/flashcards/mark, retracted only by undoing the stamping mark, never touched by goal toggles.';

-- ── 3. Which bar a promotion moved ───────────────────────────────────────────
ALTER TABLE category_promotions
  ADD COLUMN IF NOT EXISTS bar varchar(16) NOT NULL DEFAULT 'core';

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'category_promotions_bar_check'
  ) THEN
    ALTER TABLE category_promotions
      ADD CONSTRAINT category_promotions_bar_check
      CHECK (bar IN ('core', 'reading', 'writing'));
  END IF;
END $$;

COMMENT ON COLUMN category_promotions.bar IS
  'Which mastery bar this promotion moved (core/reading/writing), derived from the causing mark''s type. Velocity sums only the bars the account is pursuing, so a reading promotion earned by a learner with no reading goal is logged but not counted. Pre-143 rows are all core by construction.';

-- No new index: velocity already filters (userId, language, promotedAt) through
-- idx_category_promotions_user_lang_at and the bar predicate discards a handful of
-- rows from an already-tiny window. Add one only if that stops being true.
