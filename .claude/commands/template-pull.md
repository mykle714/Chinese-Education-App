# Template Pull (prod authored content → local)

Pull the **authored content catalogs** from production down to a local dev
machine, completely overwriting local's copies. This is the **reverse-direction**
sibling of [`/data-prod-to-dev`](./data-prod-to-dev.md), and shares its shape:
Prod half = SOURCE, Local half = TARGET, transport = Git LFS. Both move **prod →
local**; there is no supported local → prod direction for either.

Two tables move, and they are **independent** — either half of this skill can be
run alone. Note that they need DIFFERENT overwrite primitives, for the reason in
the FK section below:

| Table | Dump file | Overwrite (into local) |
|---|---|---|
| `nightmarkettemplatedefinitions` | `database/nightmarkettemplatedefinitions-data.dump` | **TRUNCATE + restore** |
| `iw_scenes` | `database/iw_scenes-data.dump` | **DELETE + restore** (`TRUNCATE` is impossible — see below) |

Both are authored on the desktop by a **template author** (`users.isTemplateAuthor`,
migration 115 — one grant, three tools), and prod is the source of truth for both:

- **Templates** — the Night Market template catalog, from the template editor.
  See [NIGHT_MARKET_TEMPLATES.md](../../docs/NIGHT_MARKET_TEMPLATES.md) and
  [NIGHT_MARKET_TEMPLATE_EDITOR.md](../../docs/NIGHT_MARKET_TEMPLATE_EDITOR.md);
  migrations 107–109.
- **Scenes** — the Immersive World scene catalog, from the scene editor at
  `/immersive-world/scene-editor`. See
  [IMMERSIVE_WORLD.md](../../docs/IMMERSIVE_WORLD.md) § 12 phase 1d; migration 158.

> **Scenes only. Not runs, ratings or memories.** The other three `iw_*` tables
> (`iw_scene_runs`, `iw_scene_ratings`, `iw_npc_memories`) are **live learner data**
> and must never move in either direction — the same rule that keeps every other user
> table out of this skill.

> **NPCs do not move, because NPCs are not data.** An NPC is a prompt living in
> `server/config/iwNpcs.ts`, so it arrives by `git pull` like any other code. A scene's
> `npcCast` / `completerNpcId` are TEXT ids with no foreign key, which means **a scene
> dump can reference an NPC the target checkout does not have**. The local half's
> post-restore step below is what catches that.

---

## ⚠️ FIRST: Which machine are you on?

Read [amIOnTheProdMachine.md](../../amIOnTheProdMachine.md) (gitignored, present on
every machine) to determine dev vs prod. A full sync has **two halves that run on
two different machines**, and you can only run the half for the machine you are on
— you have no SSH access to the other one. Your job is:

- **On PROD** → you are the **SOURCE**. Run the [Prod half](#prod-half--source)
  yourself (dump → commit → push), then hand the user the
  [Local half](#local-half--target) commands to run on their dev box.
- **On DEV/local** → you are the **TARGET**. Hand the user the
  [Prod half](#prod-half--source) commands to run on the server first; once they
  confirm the push landed, run the [Local half](#local-half--target) yourself.

Always present the "other machine" commands as a single copy-pasteable block.

---

## Prod half — SOURCE (run against `cow-postgres-prod`)

Dumps each catalog in binary custom format, writes the plain-text **manifest** that
lets the local half check its references *before* it overwrites anything, then commits
everything via Git LFS and pushes.

### Templates

```bash
cd ~/vocabulary-app
git pull origin main          # start from a clean main

# 1. Binary dump of the catalog
docker exec cow-postgres-prod pg_dump -U cow_user -d cow_db \
  -t nightmarkettemplatedefinitions --data-only -F c -f /tmp/nmt_dump.dump
docker cp cow-postgres-prod:/tmp/nmt_dump.dump \
  database/nightmarkettemplatedefinitions-data.dump

# 2. Author manifest — every distinct createdBy + its email.
#    The local half checks these exist locally BEFORE truncating (see below).
docker exec cow-postgres-prod psql -U cow_user -d cow_db -At -F',' -c \
  'SELECT DISTINCT t."createdBy", u.email
     FROM nightmarkettemplatedefinitions t
     JOIN users u ON u.id = t."createdBy"
     ORDER BY 2;' \
  > database/nightmarkettemplatedefinitions-authors.txt

# 3. Report what is being shipped
ls -lh database/nightmarkettemplatedefinitions-data.dump
docker exec cow-postgres-prod psql -U cow_user -d cow_db -c \
  'SELECT COUNT(*) FROM nightmarkettemplatedefinitions;'
cat database/nightmarkettemplatedefinitions-authors.txt

# 4. Commit (dump via LFS, manifest as plain text) and push
git add database/nightmarkettemplatedefinitions-data.dump \
        database/nightmarkettemplatedefinitions-authors.txt
git commit -m "data: refresh nightmarkettemplatedefinitions dump (prod snapshot)"
git push origin main
```

Confirm the LFS upload completes. **Report the author manifest and row count** —
the local half needs them.

### Scenes

`iw_scenes` has **no `createdBy`** (migration 158 decided scene authorship is staff
business and nothing reads it), so there is no author manifest and no user FK to
satisfy. Its manifest is an **NPC** manifest instead: the ids a scene points at are
TEXT with no foreign key, and the database cannot check them — only the target's code
can. Same shape, different referent.

```bash
cd ~/vocabulary-app
git pull origin main

# 1. Binary dump of the scene catalog — SCENES ONLY. Never add -t iw_scene_runs,
#    iw_scene_ratings or iw_npc_memories: those are live learner data.
docker exec cow-postgres-prod pg_dump -U cow_user -d cow_db \
  -t iw_scenes --data-only -F c -f /tmp/iw_scenes.dump
docker cp cow-postgres-prod:/tmp/iw_scenes.dump \
  database/iw_scenes-data.dump

# 2. NPC manifest — every distinct npc id any scene references, from all three
#    places one can hide: the completer column, the npcCast blob, and the turns of
#    each authored conversation. The local half asserts each still resolves in code.
docker exec cow-postgres-prod psql -U cow_user -d cow_db -At -c \
  'SELECT DISTINCT "npcId" FROM (
       SELECT "completerNpcId" AS "npcId" FROM iw_scenes
       UNION ALL
       SELECT c->>\'npcId\' FROM iw_scenes, jsonb_array_elements("npcCast") AS c
       UNION ALL
       SELECT t->>\'npcId\' FROM iw_scenes,
              jsonb_array_elements(conversations) AS conv,
              jsonb_array_elements(conv->\'turns\') AS t
   ) refs
   WHERE "npcId" IS NOT NULL AND "npcId" <> \'\'
   ORDER BY 1;' \
  > database/iw_scenes-npcs.txt

# 3. Report what is being shipped
ls -lh database/iw_scenes-data.dump
docker exec cow-postgres-prod psql -U cow_user -d cow_db -c \
  'SELECT COUNT(*) AS scenes, COUNT(*) FILTER (WHERE published) AS published FROM iw_scenes;'
cat database/iw_scenes-npcs.txt

# 4. Commit (dump via LFS, manifest as plain text) and push
git add database/iw_scenes-data.dump database/iw_scenes-npcs.txt
git commit -m "data: refresh iw_scenes dump (prod snapshot)"
git push origin main
```

**Report the NPC manifest and the scene/published counts** — the local half needs both.

---

## Local half — TARGET (run against `cow-postgres-local`)

### Templates

> ⚠️ **FK safety (the icons8 incident, in reverse).** `nightmarkettemplatedefinitions.createdBy`
> is `NOT NULL` and FK-references `users(id)`. If the dump carries a `createdBy`
> UUID that does **not** exist in local's `users` table, a `TRUNCATE`-then-restore
> would abort mid-`COPY` and leave the local table **empty**. So the author check
> below runs **before** the truncate — if any author is missing we stop and leave
> the local table untouched.

```bash
cd <local repo>              # e.g. ~/vocabulary-app on the dev box
git pull origin main

# 1. AUTHOR PRE-CHECK — read required authors from the manifest, check each
#    against local users. DO NOT truncate yet.
cat database/nightmarkettemplatedefinitions-authors.txt   # id,email per line

#    For each id in that file:
docker exec cow-postgres-local psql -U cow_user -d cow_db -c \
  "SELECT id, email FROM users WHERE id = '<author-id-from-manifest>';"
```

**Decision point — NOTIFY the user of the author check result:**

- **Any author missing locally** → **STOP. Do not truncate.** Report exactly which
  UUIDs + emails from the manifest are absent from local `users`. The user must
  seed those accounts locally (or you may, with their OK, remap `createdBy` — but
  the chosen default here is *notify only*), then re-run the local half. Leaving
  the truncate un-run keeps the existing local catalog intact.
- **All authors present** → proceed to the restore:

```bash
# 2. Full overwrite: truncate local, restore prod's dump
docker cp database/nightmarkettemplatedefinitions-data.dump \
  cow-postgres-local:/tmp/nmt_dump.dump
docker exec cow-postgres-local psql -U cow_user -d cow_db -c \
  'TRUNCATE TABLE nightmarkettemplatedefinitions;'
docker exec cow-postgres-local pg_restore -U cow_user -d cow_db \
  -t nightmarkettemplatedefinitions --data-only /tmp/nmt_dump.dump

# 3. Verify — should match the prod row count from the prod half
docker exec cow-postgres-local psql -U cow_user -d cow_db -c \
  'SELECT COUNT(*) FROM nightmarkettemplatedefinitions;'
```

### Scenes

> ⚠️ **`TRUNCATE iw_scenes` DOES NOT WORK. Use `DELETE`.** `iw_scene_runs."sceneId"`
> references `iw_scenes(id)`, and Postgres refuses to truncate any table named in a
> foreign key **whether or not the referencing table holds a single row**:
>
> ```
> ERROR:  cannot truncate a table referenced in a foreign key constraint
> DETAIL:  Table "iw_scene_runs" references "iw_scenes".
> HINT:   Truncate table "iw_scene_runs" at the same time, or use TRUNCATE ... CASCADE.
> ```
>
> **Do not take either hint.** Both destroy `iw_scene_runs`, which is a learner's play
> history, and the FK is `ON DELETE RESTRICT` precisely so that cannot happen by
> accident. `DELETE FROM iw_scenes;` is the correct primitive: it is row-level, so it
> succeeds when nothing references a scene and **fails loudly** when something does.
>
> This is the mirror image of the template table's hazard, and worth naming as such.
> A template's risk is an INBOUND reference (`createdBy` → `users`), so its check runs
> *before* the overwrite. A scene's risk is an OUTBOUND one (`iw_scene_runs` → scenes),
> so the database itself enforces it *during* the overwrite — and the scene ids in a
> prod dump are per-machine UUIDs that would not match a local run's `sceneId` anyway.

```bash
cd <local repo>
git pull origin main          # brings the dump, the manifest AND server/config/iwNpcs.ts

# 1. RUN PRE-CHECK — is any local run pointing at a scene? If this is 0 the DELETE
#    below is safe; if it is not, STOP (see the decision point).
docker exec cow-postgres-local psql -U cow_user -d cow_db -c \
  'SELECT COUNT(*) AS local_runs FROM iw_scene_runs;'
```

**Decision point — NOTIFY the user of the run check result:**

- **`local_runs` > 0** → **STOP. Do not delete.** Local has played scenes, and their
  history references rows this pull would replace. Report the count and ask how to
  proceed. The runs are throwaway dev data in almost every case, so the usual answer is
  to clear them first (`DELETE FROM iw_scene_runs;` — which cascades to
  `iw_scene_ratings`, though **not** to `iw_npc_memories`, which is keyed by user+NPC
  and survives independently). Never do this without asking.
- **`local_runs` = 0** → proceed:

```bash
# 2. Full overwrite: DELETE local (not TRUNCATE), restore prod's dump
docker cp database/iw_scenes-data.dump cow-postgres-local:/tmp/iw_scenes.dump
docker exec cow-postgres-local psql -U cow_user -d cow_db -c \
  'DELETE FROM iw_scenes;'
docker exec cow-postgres-local pg_restore -U cow_user -d cow_db \
  -t iw_scenes --data-only /tmp/iw_scenes.dump

# 3. Verify the row count matches the prod half's report
docker exec cow-postgres-local psql -U cow_user -d cow_db -c \
  'SELECT COUNT(*) AS scenes, COUNT(*) FILTER (WHERE published) AS published FROM iw_scenes;'

# 4. NPC RESOLUTION CHECK — the one check the database cannot make. Compare the
#    shipped manifest against the cast this checkout actually has.
cat database/iw_scenes-npcs.txt
cd server && npx tsx -e \
  "import('./config/iwNpcs.js').then(m => console.log(m.IW_NPCS.map(n => n.id).join('\n')))"
```

Every id in `iw_scenes-npcs.txt` must appear in that list. **Better still: restart the
backend and read its log** — `server/services/iw/validateStoredNpcIds.ts` runs this exact
sweep at boot across every `iw_*` table and prints either

```
[iw] NPC-id validation passed — N stored reference(s) all resolve.
```

or a per-npc breakdown of what is orphaned. An orphan means the dump is newer than the
checkout's cast: `git pull` again. It is a **warning, not a crash** — the scenes restore
fine and only iw is affected — so do not skip reading the log on the assumption that a
clean boot means a clean catalog.

---

## Important Notes

- **These two tables ONLY.** The `-t nightmarkettemplatedefinitions` / `-t iw_scenes`
  flag must be present on every `pg_dump`/`pg_restore`. Never dump or restore any other
  table with this skill — everything else is live user data. For scenes that emphatically
  includes the sibling `iw_scene_runs`, `iw_scene_ratings` and `iw_npc_memories`.
- **The two halves are independent.** Pull templates without scenes or scenes without
  templates; nothing in one references the other. Run only the half the user asked for.
- **Direction is prod → local only.** There is no way to push either catalog the other
  way: the local → prod data push skill has been **deleted** and prod is the source of
  truth. Never restore these dumps into `cow-postgres-prod` — it would clobber the
  authoritative catalogs. Author templates and scenes against prod directly.
- **Binary format (`-F c`) + `pg_restore`.** Plain SQL causes psql meta-command
  errors from pg_dump version skew; always dump with `-F c` and restore with
  `pg_restore` (not `psql -f`).
- **Manifests are committed plain text**, not LFS — they must stay greppable so the
  local half can read them before restoring.
- **Each catalog's guard runs at its own moment, and they are not interchangeable:**
  the template author check runs **before** the truncate (it is the guard against the
  empty-table failure mode — do not reorder it); the scene run check runs before the
  DELETE, and the scene NPC check runs **after** the restore, because it validates
  against code rather than against the database.
- Full context: [NIGHT_MARKET_TEMPLATES.md](../../docs/NIGHT_MARKET_TEMPLATES.md) for
  templates, [IMMERSIVE_WORLD.md](../../docs/IMMERSIVE_WORLD.md) § 12 phase 1a/1d for
  scenes.
