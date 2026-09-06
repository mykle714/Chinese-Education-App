-- Migration 160: scene-specific instructions for the model (`iw_scenes."sceneNotes"`).
--
-- WHAT IT IS. One free-text box per scene, authored in the scene editor's details panel,
-- carrying the two things nothing else in the schema can say:
--   1. what this scene IS ("a cramped noodle stall at closing time, the last customer of
--      the night"), and
--   2. how to read its named places ("‘counter’ is where payment happens; ‘tables’ is the
--      seating area") — the place tags are single words chosen for the author's own
--      dropdowns (§ 14 Q42), and a word is not a description.
--
-- WHY IT IS NOT `objective` COMING BACK. Migration 159 dropped `objective` because nothing
-- read it: the completion action already stated the errand, in steps the engine runs. This
-- column is the opposite case — it exists PRECISELY to be read, by the model, and it says
-- things no other column encodes. If it ever stops being injected into a prompt, drop it
-- the same way 159 dropped its predecessor.
--
-- ⚠️ NO META-LANGUAGE GUARD, by decision (2026-09-05). The text reaches NPCs verbatim, so
-- § 14 Q27's "an NPC is told who it is, never what it is for" is the AUTHOR's rule to keep
-- here, not the validator's. `findMetaLanguage` (server/services/iw/npcPrompt.ts) exists and
-- could be pointed at this field later if authored scenes start leaking the frame.
--
-- Expand-only and safe to run before the code that reads it: NOT NULL with a '' default, so
-- every existing row backfills to the empty string in one pass.
--
-- Referenced by: server/contracts/iw.ts (IWScene.sceneNotes, IW_MAX_SCENE_NOTES_LENGTH),
-- server/dal/implementations/ImmersiveWorldDAL.ts, server/services/iw/sceneValidation.ts,
-- src/features/immersiveworld/IWSceneDetailsPanel.tsx.
-- Documented in docs/IMMERSIVE_WORLD.md § 12 phase 1d.

ALTER TABLE iw_scenes
  ADD COLUMN IF NOT EXISTS "sceneNotes" TEXT NOT NULL DEFAULT '';

COMMENT ON COLUMN iw_scenes."sceneNotes" IS
  'Author-written scene brief injected into the model prompt: what the scene is, and what its place tags mean. Reaches NPCs verbatim — no meta-language guard.';
