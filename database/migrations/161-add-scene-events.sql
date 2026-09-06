-- Migration 161: authored scene EVENTS (`iw_scenes.events`) and the run's record of which
-- ones fired (`iw_scene_runs."eventIds"`).
--
-- WHAT AN EVENT IS. The same thing a complication is — a one-line world fact the engine
-- injects into the turn context of everyone present, reacted to in character rather than
-- scripted (§ 14 Q31) — with a different TRIGGER. A complication is DRAWN by the per-turn
-- roll; an event is SCHEDULED, either by a `schedule_event` step inside an authored action
-- ("call the order through, the food arrives 20s later") or by the event's own
-- `atStartSeconds`, which arms it when the scene opens.
--
-- WHY TWO COLUMNS AND NOT ONE FLAGGED LIST. So neither trigger can reach the other's pool:
-- the random roll must never spring an authored beat before its cue, and a script must never
-- be able to arm the thing whose whole job is to be a surprise.
--
-- SHAPE (authored whole by the editor, like every other iw blob):
--   [{ id: "food_ready",
--      description: "The kitchen sends out the noodles.",
--      atStartSeconds: 20 }]        -- atStartSeconds omitted ⇒ script-armed only
-- No owner field, deliberately: an event belongs to the room, not to an NPC — the same rule
-- `complications` was given on 2026-09-04.
--
-- `eventIds` mirrors `complicationIds` (migration 159) exactly: an ordered TEXT[] of what
-- actually fired, in the order it fired, so a finished run can be read back. TEXT[] rather
-- than jsonb because it is a list of scalars, not an authored document.
--
-- Expand-only: both columns are NOT NULL with an empty default, so every existing row
-- backfills in one pass. Safe to run before the code that reads them.
--
-- Referenced by: server/contracts/iw.ts (IWSceneEvent, IW_MAX_EVENTS, IW_MAX_EVENT_LENGTH,
-- IW_MAX_EVENT_DELAY_SECONDS, the `schedule_event` step), server/services/iw/sceneValidation.ts,
-- server/dal/implementations/ImmersiveWorldDAL.ts,
-- src/features/immersiveworld/IWSceneContentPanel.tsx (authoring the pool),
-- src/features/immersiveworld/IWSceneActionsPanel.tsx (the step).
-- Documented in docs/IMMERSIVE_WORLD.md § 5.4 and § 12 phase 1d.

ALTER TABLE iw_scenes
  ADD COLUMN IF NOT EXISTS events JSONB NOT NULL DEFAULT '[]'::jsonb;

ALTER TABLE iw_scene_runs
  ADD COLUMN IF NOT EXISTS "eventIds" TEXT[] NOT NULL DEFAULT '{}';

COMMENT ON COLUMN iw_scenes.events IS
  'Authored world events: [{id, description, atStartSeconds?}]. Injected like a complication but SCHEDULED (by a schedule_event step or atStartSeconds), never drawn by the per-turn roll.';
COMMENT ON COLUMN iw_scene_runs."eventIds" IS
  'Ordered ids of the events that fired during this run, in the order they fired. Mirrors "complicationIds".';
