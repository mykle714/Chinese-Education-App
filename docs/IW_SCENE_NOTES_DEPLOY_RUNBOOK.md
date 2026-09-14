# TEMPORARY — Deploy runbook: iw scene notes + scene events (migrations 160, 161)

> **Delete this file once PPE is verified.** Status: **DEPLOYED 2026-09-05**; every schema
> check below passed on PPE (both columns landed with their empty defaults, the one existing
> scene backfilled to `''`, both versions recorded). PPE is current through migration **161**.
> **The notes/events half is now CONFIRMED (2026-09-06).** PPE's one scene, "Get Dinner",
> carries a non-empty `sceneNotes` ("This scene is Wang Shen's Restaurant. t1s1 means…") and
> one authored event (`e1`, "The player's food is ready"), armed by a `schedule_event` step in
> 王婶's *Submit the player's order to the kitchen*. Both columns round-tripped through the
> editor. It stays open only for the second, weaker condition — someone confirming a
> HALF-BUILT scene saves with amber warnings rather than being refused, which the finished
> row cannot evidence (it re-validates with zero problems).

## What ships

1. **Migration 160** — `iw_scenes."sceneNotes" TEXT NOT NULL DEFAULT ''`. The per-scene brief
   the model reads: what the scene is, and what its named place tags mean.
2. **Migration 161** — `iw_scenes.events` (jsonb, `'[]'`) and `iw_scene_runs."eventIds"`
   (`TEXT[]`, `'{}'`). Authored world EVENTS: the same one-line facts as complications, but
   scheduled — by a new `schedule_event` action step, or by an event's own `atStartSeconds`
   ("at scene open") — rather than drawn by the per-turn roll.
3. **Scene-editor validator becomes advisory** (no migration). `validateScene` now tags every
   problem with a severity; only structural faults (`language`, blank/over-long `name`, board
   dims, non-integer start cells, non-object `layout`) still refuse a save. Everything else
   comes back from `POST /api/immersiveWorld/scenes` as `warnings` beside the saved scene and
   is painted amber in the editor.
4. **Palette overlay pointer fix** (no migration) in the iw scene editor and the night market
   template editor: the floating tool palette no longer swallows the click that starts an edit
   on the cells behind it.

## Step order

**Both migrations MUST run BEFORE the container rebuild.** `ImmersiveWorldDAL`'s
`SCENE_COLUMNS` selects `"sceneNotes"` and `events` **by name** on every scene read, so old
schema + new code makes every editor scene load 500. The reverse (new schema + old code) is
harmless — the columns simply sit at `''` and `[]` — which is why the expand-only order is the
safe one. Both are in one `migrate.sh` pass; there is no held-back contract migration here.

```bash
# 1. On PPE, from the repo root:
git status --short          # PPE usually has real uncommitted work — commit & push it FIRST
git pull

# 2. Apply the migration BEFORE rebuilding.
./database/deploy/migrate.sh --dry-run     # expect: 160 and 161, in that order
./database/deploy/migrate.sh

# 3. Rebuild the containers as usual (/deploy).
```

## Verification SQL (expected results inline)

```sql
-- The column landed, NOT NULL, defaulting to the empty string.
SELECT column_name, data_type, is_nullable, column_default
  FROM information_schema.columns
 WHERE table_name = 'iw_scenes' AND column_name = 'sceneNotes';
-- → sceneNotes | text | NO | ''::text

-- Every pre-existing scene backfilled to ''. (PPE had 0 scenes at the 159 deploy; if any
-- exist now they must all be '' — nothing else can have written this column yet.)
SELECT count(*) AS total, count(*) FILTER (WHERE "sceneNotes" <> '') AS non_empty
  FROM iw_scenes;
-- → non_empty = 0

-- 161: both columns landed with empty defaults.
SELECT table_name, column_name, data_type, is_nullable, column_default
  FROM information_schema.columns
 WHERE (table_name = 'iw_scenes'     AND column_name = 'events')
    OR (table_name = 'iw_scene_runs' AND column_name = 'eventIds');
-- → iw_scenes     | events   | jsonb | NO | '[]'::jsonb
-- → iw_scene_runs | eventIds | ARRAY | NO | '{}'::text[]

-- Both migrations are recorded.
SELECT version, name FROM schema_migrations WHERE version IN (160, 161) ORDER BY version;
-- → 160 | 160-add-scene-notes.sql
-- → 161 | 161-add-scene-events.sql
```

**If a check fails:** the column is additive and nothing reads it yet at runtime (phase 2 will),
so a failure here is a failed `ALTER`, not a data problem — re-run `migrate.sh` after fixing the
cause. If the migration cannot be applied, **do not rebuild the containers**: the new code
cannot read the old schema.

## Rollback

```sql
ALTER TABLE iw_scene_runs DROP COLUMN "eventIds";
ALTER TABLE iw_scenes     DROP COLUMN events;
ALTER TABLE iw_scenes     DROP COLUMN "sceneNotes";
DELETE FROM schema_migrations WHERE version IN (160, 161);
```
…but only **together with** reverting the code, since the DAL selects the column by name.

## User-visible changes to expect

- The scene editor's details panel gains a **Scene notes** box, and the content panel gains an
  **Events** list (description + an optional "at scene open" delay). Authored actions gain a
  **Schedule event** step.
- **A half-built scene now SAVES.** The banner reads *"Saved … with N warnings"* and the
  offending fields are amber instead of red. Only the structural faults listed above still
  refuse, with the red *"This scene cannot be saved in this shape"* banner.
- Clicking to place a body or a place tag works over the whole board, including the region
  behind the tool palette.
