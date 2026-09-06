-- Migration 162: PLACE INTERACTIONS (`iw_scenes.interactions`).
--
-- WHAT AN INTERACTION IS. A script that runs when the LEARNER walks up to a named place —
-- the first thing in the feature triggered by the learner's own body rather than by the
-- model choosing (an authored action, § 14 Q42), by the per-turn roll (a complication) or by
-- a timer (an event, migration 161). On desktop the learner issues a walk command on a cell;
-- the engine paths as close as it can and, on arrival, runs whatever script that cell's place
-- carries.
--
-- WHY IT IS KEYED BY PLACE TAG. An interaction is not a new authored thing standing beside
-- places; it is an OPTIONAL PROPERTY OF A PLACE (§ 14 Q43). A place with no entry is an
-- ordinary walk destination, a place with one is a thing the learner can poke. Keying by tag
-- means one place cannot have two scripts, and every cascade `layout.locations` already has —
-- a rename moves the tag, a delete drops it — carries the script with it for free.
--
-- WHY A COLUMN RATHER THAN A FIELD INSIDE `layout.locations`. `layout` is board GEOMETRY:
-- where things are. A script is BEHAVIOUR. Folding one into the other would turn the
-- `tag -> "col,row"` map into a map of objects and rewrite every reader of a shape three
-- editor panels already depend on. The same relationship `npcCast` (who is here) has to the
-- actions hanging off it.
--
-- SHAPE (authored whole by the editor, like every other iw blob):
--   { "menu board": [
--       { "kind": "popup", "imageId": "tea_menu", "caption": "The day's menu" },
--       { "kind": "npc_action", "npcId": "wang_shen", "actionId": "act2" },
--       { "kind": "schedule_event", "eventId": "food_ready", "seconds": 20 } ] }
--
-- The step vocabulary is deliberately SMALLER than an authored action's, because an
-- interaction has no performer: every subject-relative step (walk, face, wait for the
-- learner) is meaningless without an NPC to be the subject of it, and the one step that
-- needs a subject names it (`npc_action`). The one genuinely new capability is `popup`,
-- whose art is CLIENT files in `src/assets/iw-popups/` — the id is a file stem, so adding
-- popup art is dropping a file in a folder, with no code change and no upload path.
--
-- Expand-only: NOT NULL with an empty-object default, so every existing row backfills in one
-- pass and it is safe to run before the code that reads it. `'{}'` and not `'[]'` — this blob
-- is the one iw object-keyed collection, not a list.
--
-- Referenced by: server/contracts/iw.ts (IWSceneInteractions, IWInteractionStep,
-- IW_INTERACTION_STEP_KINDS, IW_MAX_INTERACTION_STEPS, IW_MAX_POPUP_CAPTION_LENGTH,
-- IW_POPUP_IMAGE_ID), server/services/iw/sceneValidation.ts (validateInteractions),
-- server/dal/implementations/ImmersiveWorldDAL.ts,
-- src/features/immersiveworld/IWScenePlacesPanel.tsx (authoring),
-- src/features/immersiveworld/iwPopupArt.ts (the popup catalogue).
-- Documented in docs/IMMERSIVE_WORLD.md § 5.4a and § 14 Q43.

ALTER TABLE iw_scenes
  ADD COLUMN IF NOT EXISTS interactions JSONB NOT NULL DEFAULT '{}'::jsonb;

COMMENT ON COLUMN iw_scenes.interactions IS
  'Place interactions, keyed by layout.locations tag: {"<tag>": [{kind, ...}]}. Runs when the learner walks up to that place''s cell. Steps: popup | npc_action | start_conversation | schedule_event | wait.';
