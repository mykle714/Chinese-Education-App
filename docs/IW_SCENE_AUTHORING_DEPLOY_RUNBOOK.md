# ⚠️ TEMPORARY — Immersive World scene-authoring deploy runbook

**Delete this file once the one remaining check below is done.**
Status: **DEPLOYED TO PROD 2026-09-05** — migration 159 applied and recorded, containers
rebuilt, every schema check in § 5 passed.

### What was verified on prod

| Check | Result |
|---|---|
| Pre-check (§ 3) | `scenes = 0`, `runs = 0`, `MAX(version) = 158` — the single-pass assumption held |
| Prod divergence | 1 behind / **0 ahead**, no modified tracked files (only oracle-run output). Fast-forward pull |
| `migrate.sh` | `APPLY: 159 … applied and recorded`. `MAX(version) = 159` |
| § 5 (a)–(f) | all six matched: both dead columns gone, both facings NOT NULL default `'s'`, CHECK installed, `complicationIds` is `ARRAY`/`_text`, singular column gone |
| Containers | backend + frontend healthy, postgres up; `/api/health` 200, `https://mren.me/api/health` 200 |
| iw boot sweep | `[iw] NPC-id validation passed — 0 stored reference(s) all resolve.` |
| iw route gating | `GET /api/immersiveWorld/scenes` unauthenticated → **401** |
| DAL ↔ schema | the DAL's exact `SCENE_COLUMNS` SELECT resolves against live `iw_scenes` — this is the mismatch that would have shown up as a 500 on save rather than as a schema error |

### ⏳ The one check still owed

**Nobody has opened the editor as a template author.** Log in as an `isTemplateAuthor`
account and confirm: the **Scene Editor** tile appears on the Home hub, the NPC picker lists
**six** NPCs (迈克尔 · 王婶 · 小陈 · 老周 · 周敏 · 马师傅), and a scene **saves and re-loads**.
That last one is the real test — everything above proves the schema and the column list agree,
but only a save proves the whole authoring path does.

**Delete this file once that passes.** Nothing here is blocking; the feature is
author-gated and invisible to learners either way.

---

*Original pre-deploy contents follow, kept until the check above is done.*

Covers **migration 159** (`159-iw-scene-authoring-corrections.sql`) and the code that ships
with it: the iw scene editor's first end-to-end-authorable state.

> Derive the actual pending set from `schema_migrations` and `migrate.sh --dry-run`, not from
> this banner. If they disagree with this file, **this file is stale** — that is the rule from
> the 2026-08-16 deploy, and four retired runbooks earned it.

---

## 1. What ships, in one paragraph

Migration 159 drops two dead columns from `iw_scenes` (`words`, `objective`), reshapes
`iw_scene_runs."complicationId"` (a single TEXT) into `"complicationIds"` (TEXT[]), and adds
`"playerStartFacing"` / `"companionStartFacing"` to `iw_scenes`. The code alongside it
finishes the scene editor: authored actions replace the old model action enum, the completion
action becomes one of the completer NPC's own authored actions, walkability masks are gone,
NPC avatars render on the board, and two new NPCs (`zhou_min`, `ma_shifu`) join the registry.

---

## 2. Why this is a SINGLE-PASS deploy despite being a contract migration

Normally a contract migration must land **after** the container rebuild (the 2026-08-17
lesson: 149 dropped columns the old code still wrote). **That does not apply here**, and the
reason is worth stating precisely rather than trusting:

**No shipped code reads or writes `iw_scenes` or `iw_scene_runs` at all.** The whole iw
feature is unreleased. The DAL, service, controller and editor page exist only on this branch.
So there is no "old code" to break, in either direction, and 159 may run **before** the
rebuild in one ordinary `migrate.sh` pass.

The single assumption behind that is **zero rows**. Step 3's pre-check is what verifies it. If
it finds rows, **stop** — someone authored a scene on prod through a path this runbook does not
know about, and dropping `objective` would destroy authored text.

---

## 3. Pre-check — run this BEFORE anything else

```sql
-- Expect 0 and 0. Anything else: STOP and re-read § 2.
SELECT (SELECT count(*) FROM iw_scenes)     AS scenes,
       (SELECT count(*) FROM iw_scene_runs) AS runs;

-- Expect 158. If it is already 159, the migration ran and you are only deploying code.
SELECT MAX(version) FROM schema_migrations;
```

**If `scenes > 0`:** do not run 159. Dump the table first
(`pg_dump -t iw_scenes`), then decide whether the rows are worth keeping — every one of them
predates the Q42 action model and its `completionAction` holds an engine verb
(`'accept_payment'`) that resolves to no authored action, so it will fail validation on its
next save regardless.

**If `runs > 0`:** likewise stop. `complicationId` values would be discarded by the DROP.

---

## 4. Order

| # | Step | Notes |
|---|---|---|
| 1 | Pre-check (§ 3) | Must be 0 / 0 / 158 |
| 2 | `git status --short` on prod | **Prod always has local work.** Commit and push it FROM PROD before pulling, so the pull is a fast-forward (the 2026-09-02 and 2026-09-04 lesson, twice over) |
| 3 | `git pull` | |
| 4 | `migrate.sh` | Applies 159 alone. Safe before the rebuild — see § 2 |
| 5 | Rebuild containers | |
| 6 | Verify (§ 5) | |

There is **no held-back migration** in this batch and no crontab or systemd change, so
`install-timers.sh` does **not** need re-running.

---

## 5. Verification SQL, with expected results

```sql
-- (a) The two dead columns are gone. Expect 0 rows.
SELECT column_name FROM information_schema.columns
 WHERE table_name = 'iw_scenes' AND column_name IN ('words', 'objective');

-- (b) Both facings exist, NOT NULL, defaulting to 's'. Expect 2 rows, both 's'::character varying.
SELECT column_name, is_nullable, column_default FROM information_schema.columns
 WHERE table_name = 'iw_scenes' AND column_name LIKE '%StartFacing';

-- (c) The facing CHECK constraint is installed. Expect 1 row.
SELECT conname FROM pg_constraint WHERE conname = 'chk_iw_scenes_start_facings';

-- (d) The run's complication list is a TEXT ARRAY, not TEXT. Expect one row: ARRAY / text.
SELECT data_type, udt_name FROM information_schema.columns
 WHERE table_name = 'iw_scene_runs' AND column_name = 'complicationIds';

-- (e) The singular column is gone. Expect 0 rows.
SELECT column_name FROM information_schema.columns
 WHERE table_name = 'iw_scene_runs' AND column_name = 'complicationId';

-- (f) Recorded. Expect 159.
SELECT MAX(version) FROM schema_migrations;
```

**Then verify the app, not just the schema.** The editor is behind
`users.isTemplateAuthor`; log in as an author and confirm the **Scene Editor** tile appears on
the Home hub and the page loads its NPC picker with **six** NPCs (迈克尔 · 王婶 · 小陈 · 老周 ·
周敏 · 马师傅). A scene that saves and re-loads is the real check — the DAL's column list and
the migration's columns have to agree exactly, and a mismatch shows up as a 500 on save, not
as a schema error.

### If a check fails

- **(a) still returns rows** → the `DROP COLUMN IF EXISTS` was a no-op against a table that
  never had them, or the migration did not run. Check (f).
- **(b)/(c) missing** → `ADD COLUMN IF NOT EXISTS` skipped because a column of that name
  already existed with a different shape. Inspect with `\d iw_scenes` before re-running
  anything.
- **Save returns 500** → almost certainly the DAL/column mismatch above. The server log names
  the missing column. Do **not** patch the column list on prod; roll back (§ 6) and fix on dev.

---

## 6. Rollback

Because nothing reads these tables, rollback is **code-only**: redeploy the previous image and
leave 159 applied. The schema change is inert without the code.

If the schema itself must be reverted (it should not need to be):

```sql
ALTER TABLE iw_scenes ADD COLUMN objective TEXT NOT NULL DEFAULT '';
ALTER TABLE iw_scenes ADD COLUMN words JSONB NOT NULL DEFAULT '[]'::jsonb;
ALTER TABLE iw_scenes DROP CONSTRAINT IF EXISTS chk_iw_scenes_start_facings;
ALTER TABLE iw_scenes DROP COLUMN "playerStartFacing", DROP COLUMN "companionStartFacing";
ALTER TABLE iw_scene_runs DROP COLUMN "complicationIds";
ALTER TABLE iw_scene_runs ADD COLUMN "complicationId" TEXT;
DELETE FROM schema_migrations WHERE version = 159;
```

⚠️ `objective` comes back with a `DEFAULT ''` it did not originally have, because 158 declared
it `NOT NULL` with no default and there would be no value to give an existing row. With zero
rows this is cosmetic; drop the default afterwards if the table is ever restored for real.

---

## 7. User-visible behaviour change

**None for learners.** iw is unreleased; nothing on any learner-facing surface changes.

For **template authors** (`isTemplateAuthor`), the scene editor changes shape:

- The **Objective** field is gone. The completion action says what the scene is for.
- **Does what** is now a picker of the completer NPC's own authored actions, not a fixed list
  of verbs. It is disabled until that NPC has an action.
- The **street / communal** paint tools and their tints are gone (Q/W and 1/2 unbound); the
  cast hotkeys moved from 3–0 to **1–8**.
- Bodies on the board are **drawn as avatars** instead of coloured squares, and the details
  panel gained a **facing** picker for the player and the companion.
- Two new NPCs appear in the picker.

⚠️ **Neither new NPC has been through § 5.6's character sweep or `prefix-size.js`.** They are
safe to place in a scene (nothing runs a scene yet) but must be swept before the runtime ships.
Tracked in `docs/IMMERSIVE_WORLD.md` § 5.6.
