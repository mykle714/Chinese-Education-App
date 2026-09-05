-- Migration 159: Immersive World — four corrections to migration 158's schema.
--
-- See docs/IMMERSIVE_WORLD.md § 3a, § 5.4, § 9.2, § 12 phase 1d and § 14 Q31/Q42.
--
-- ⚠️ CONTRACT MIGRATION. Every change here DROPS or RESHAPES a column 158 created.
-- It is safe to run in one pass because **no shipped code reads or writes any of these
-- tables**: the whole iw feature is unreleased, and both dev and prod hold ZERO rows in
-- `iw_scenes` and `iw_scene_runs` (verified before writing this — see the runbook). There
-- is therefore no expand/contract window to respect and no data to preserve; if a future
-- deploy of this file ever finds rows, that assumption has broken and the runbook's
-- pre-check is what catches it.
--
-- The four corrections, each of which invalidates a column 158 shipped:
--
--   1. `words` is dead. Scene-authored "essential words" was removed on 2026-09-05 as
--      out of spec (§ 9.4's point 3 went with it). The model's vocabulary guidance is now
--      the learner's level and the learner's own library, with nothing authored per scene.
--
--   2. `objective` is dead. 158 called it "ENGINE-FACING AND ENGLISH … read by the
--      completion check", but the completion check reads `completerNpcId` +
--      `completionAction` and nothing else. Since Q42 made the completion action an
--      AUTHORED action of the completer's ("take payment": walk over, say a line, wait),
--      the objective restated in prose what that action already says in steps — a second
--      description of the same fact, with no reader.
--
--   3. `complicationId` (singular) cannot hold what a run produces. Q31 was corrected on
--      2026-09-05: a complication is not drawn once per run but rolled **per turn at 20%**,
--      so a run of ~12 turns averages ~2.4 of them. Becomes `complicationIds`, an ordered
--      TEXT[] of blob ids in the order they fired. TEXT[] rather than jsonb because this is
--      a list of scalars, not an authored document — the other iw jsonb columns all hold
--      structures the editor writes whole.
--
--   4. Both actors need a starting FACING. 158 gave the player and the companion a start
--      CELL but no direction, so a scene opened with two bodies staring in whatever
--      direction the renderer defaulted to. Cast NPCs have carried `facing` inside
--      `npcCast` since 158; these two are stored as columns for the same reason their
--      cells are — they are not cast members and there is no blob for them to live in.
--
-- NOT CHANGED, deliberately: `completionAction` stays VARCHAR(40). Its MEANING changed
-- under Q42 — it used to hold one of a closed set of engine verbs ('accept_payment') and
-- now holds an `IWNpcAction.id` from the completer's own cast entry ('act1', 'pay') — but
-- the type still fits, and with zero rows there is nothing to convert. The column comment
-- below is what stops the next reader assuming the old meaning.

-- ── 1 + 2: two dead columns on iw_scenes ────────────────────────────────────
ALTER TABLE iw_scenes DROP COLUMN IF EXISTS words;
ALTER TABLE iw_scenes DROP COLUMN IF EXISTS objective;

-- ── 4: authored start facings ───────────────────────────────────────────────
-- Defaults are not arbitrary: 's' points a sprite down-screen toward the camera, which is
-- the pose a body should hold when a scene opens and nothing has told it otherwise. The
-- editor always writes an explicit value, so the default only ever serves a hand-written
-- row (which § 14 Q2 explicitly recommends for scene one).
ALTER TABLE iw_scenes
    ADD COLUMN IF NOT EXISTS "playerStartFacing" VARCHAR(1) NOT NULL DEFAULT 's',
    ADD COLUMN IF NOT EXISTS "companionStartFacing" VARCHAR(1) NOT NULL DEFAULT 's';

ALTER TABLE iw_scenes
    DROP CONSTRAINT IF EXISTS chk_iw_scenes_start_facings;
ALTER TABLE iw_scenes
    ADD CONSTRAINT chk_iw_scenes_start_facings CHECK (
        "playerStartFacing"    IN ('n', 'e', 's', 'w') AND
        "companionStartFacing" IN ('n', 'e', 's', 'w')
    );

COMMENT ON COLUMN iw_scenes."completionAction" IS
    'An IWNpcAction.id on the completer''s cast entry — NOT an engine verb. The author '
    'programs the action that ends the scene and nominates it here (§ 14 Q42).';

-- ── 3: a run draws several complications, not one ───────────────────────────
ALTER TABLE iw_scene_runs DROP COLUMN IF EXISTS "complicationId";
ALTER TABLE iw_scene_runs
    ADD COLUMN IF NOT EXISTS "complicationIds" TEXT[] NOT NULL DEFAULT '{}';

COMMENT ON COLUMN iw_scene_runs."complicationIds" IS
    'Blob ids of every complication that fired in this run, in the order they fired. '
    'Each turn carries a 20% chance of one (§ 14 Q31); a run of ~12 turns averages ~2.4.';
