-- 163 — rename the iw scene layout's `locations` key to `places`
--
-- DATA-ONLY, NO SCHEMA CHANGE. `iw_scenes.layout` is jsonb, so the named-place map has never
-- been a column; this renames one KEY inside it.
--
-- WHY. Every other surface in the feature already said PLACE — `IWScenePlacesPanel`,
-- `PlaceChip`, the `walk_to_tag` label ("Walk to place"), `IWSceneInteractions` ("keyed by
-- place name"), and all of docs/IMMERSIVE_WORLD.md § 14 Q42/Q43 — while the stored key alone
-- said `locations`. It also collided in grep with the night market's entirely unrelated
-- `nightmarkettemplatelocations`.
--
-- ORDERING: SAFE IN EITHER DIRECTION, but not symmetric, so it is worth being precise:
--   * New code + old rows  — fine. `scenePlaces()` (server/contracts/iw.ts) falls back to
--     `locations`, so a row this migration has not reached still opens correctly.
--   * Old code + new rows  — DEGRADED, briefly. The pre-rename editor reads `layout.locations`
--     directly and would show a migrated scene with an empty Places panel. Nothing is lost
--     (the row is intact and the author would simply not save over it), and iw has no
--     learner-facing surface at all, so the blast radius is one authoring session.
-- So the STANDARD `/deploy` order (migrate.sh, then rebuild) is fine and needs no runbook:
-- the only cost is that a scene opened in the ~2 minutes between the two shows an empty
-- Places panel, and iw has no learner-facing surface for that window to affect.
--
-- IDEMPOTENT: the WHERE clause skips rows already carrying `places`, so a re-run is a no-op.
-- There is no separate backfill — every save writes `places` from now on
-- (`masksToSceneLayout`), so this only has to catch what was authored before today.

UPDATE iw_scenes
SET layout = (layout - 'locations') || jsonb_build_object('places', layout -> 'locations')
WHERE layout ? 'locations'
  AND NOT (layout ? 'places');

-- A row that somehow carried BOTH keys keeps `places` (which `scenePlaces` already prefers)
-- and simply loses the stale duplicate.
UPDATE iw_scenes
SET layout = layout - 'locations'
WHERE layout ? 'locations'
  AND layout ? 'places';
