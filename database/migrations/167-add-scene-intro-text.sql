-- Migration 167: the learner-facing scene intro (`iw_scenes."introText"`).
--
-- WHAT IT IS. A short author-written blurb shown to the LEARNER as a dismissable card the
-- moment the scene opens ("You're hungry. Find the noodle stall and order a bowl."), with the
-- world held still behind it until they tap Start. Empty = no card.
--
-- ⚠️ IT IS THE MIRROR IMAGE OF `sceneNotes` (migration 160), and must stay that way.
-- `sceneNotes` is written IN-WORLD because the model reads it verbatim. This column is written
-- TO THE LEARNER, out of world — it may freely say "your goal is…", which is exactly the meta
-- language § 14 Q27 keeps out of a prompt. So it must NEVER be composed into a model prompt.
-- If a future change wants to tell NPCs something, that belongs in `sceneNotes`.
--
-- Expand-only and safe to run before the code that reads it: NOT NULL with a '' default, so
-- every existing row backfills to the empty string (= no intro card) in one pass. The shipped
-- `ImmersiveWorldDAL` selects the column by name, so it must land BEFORE the container rebuild
-- (the standard `/deploy` order — no runbook needed).
--
-- Referenced by: server/contracts/iw.ts (IWScene.introText, IW_MAX_INTRO_TEXT_LENGTH),
-- server/dal/implementations/ImmersiveWorldDAL.ts, server/services/iw/sceneValidation.ts,
-- src/features/immersiveworld/IWSceneDetailsPanel.tsx,
-- src/features/immersiveworld/play/IWSceneIntroCard.tsx.
-- Documented in docs/IMMERSIVE_WORLD.md § 12 phase 1d.

ALTER TABLE iw_scenes
  ADD COLUMN IF NOT EXISTS "introText" TEXT NOT NULL DEFAULT '';

COMMENT ON COLUMN iw_scenes."introText" IS
  'Learner-facing intro shown as a dismissable card on scene load (world held until dismissed). Out-of-world prose — never injected into a model prompt; that is sceneNotes.';
