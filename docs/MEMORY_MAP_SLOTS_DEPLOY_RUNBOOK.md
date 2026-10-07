# Memory Map slot tree — deploy runbook (migration 173)

> **TEMPORARY.** Delete this file once PPE is verified (step 5 passes and someone has
> opened Memory Map on PPE and seen a full, tilted map).
>
> **Status: NOT YET DEPLOYED.** Applied on DEV only (2026-10-06). Do not trust this line
> on its own — derive pending work from `schema_migrations` and `migrate.sh --dry-run`.

Feature doc: [MEMORY_MAP_GAME.md](./MEMORY_MAP_GAME.md) § 2.1–§ 2.4, § 3.6, § 8.

## What ships

* **Migration 173** (`database/migrations/173-memory-map-slots.sql`) — a **contract**
  migration: renames `memory_map_placements_zh/_es` → `memory_map_slots_zh/_es`,
  **TRUNCATEs both** (every learner's map re-spawns on their next visit), drops `x`/`y`,
  adds `parentId`/`link`/`angle`/`tilt`/`bow`, and turns `vocabEntryId` into a nullable
  `ON DELETE SET NULL` FK.
* Code that reads the new tables by name (`MemoryMapDAL`) and the new wire shape
  (`slots` + `words`) on the client.

## Why this is not a plain `/deploy`

There is **no window in which both versions work**. Old code selects `x`/`y` from
`memory_map_placements_*`; new code selects `parentId`/`tilt` from `memory_map_slots_*`.
Whichever order is chosen, Memory Map's two endpoints 500 for the length of the gap.
Nothing else in the app touches these tables, so the blast radius is that one game for
about a minute.

**Order: migrate, then rebuild immediately** (the 150-rename precedent). The game is
broken only during the rebuild, and the new code never sees the old schema.

## Steps

### 1. Pre-checks (on PPE)

```bash
git status --short          # PPE usually has local work — commit/push it first (CLAUDE.md)
./database/deploy/migrate.sh --dry-run
```

Expected: **173** pending (PPE was at 172 on 2026-10-04) — plus **174** if the Writing
Notebook ships in the same deploy. 174 (`notebook_sheets` + `notebook_cells`,
[WRITING_NOTEBOOK.md](./WRITING_NOTEBOOK.md)) is expand-only and creates two brand-new
tables, so it belongs in the same pre-rebuild `migrate.sh` pass as 173 and needs no runbook
of its own; no shipped code reads either table before the rebuild. If anything else is
pending, read its own runbook before continuing.

```sql
SELECT MAX(version) FROM schema_migrations;                                 -- expect 172
SELECT to_regclass('memory_map_placements_zh'), to_regclass('memory_map_slots_zh');
-- expect: memory_map_placements_zh | (null)
```

### 2. Pull the code, then apply the migration

```bash
git pull --ff-only
./database/deploy/migrate.sh
```

### 3. Rebuild the containers straight away

Per `/deploy`. Memory Map returns 500 between steps 2 and 3, and nothing else is affected.

### 4. If the migration fails

It runs in `migrate.sh`'s transaction, so a failure leaves the schema untouched and the
OLD code still works — do not rebuild. Read the error; the likeliest cause is a
constraint name on PPE differing from dev's (`memory_map_placements_zh_vocabEntryId_fkey`,
`…_pkey`, `…_userId_fkey`, `uq_memory_map_zh_user_entry`). Check with
`\d memory_map_placements_zh`, fix the names in the migration, and re-run.

### 5. Verify (copy-paste; expected results inline)

```sql
SELECT version FROM schema_migrations WHERE version = 173;                  -- 1 row

SELECT column_name, is_nullable, data_type FROM information_schema.columns
 WHERE table_name = 'memory_map_slots_zh' ORDER BY column_name;
-- angle YES real · bow NO real · createdAt NO · id NO · language NO ·
-- link NO character varying · parentId YES integer · scale NO real · tilt NO real · userId NO uuid ·
-- vocabEntryId YES integer          (and NO x / y rows)

SELECT conname, confdeltype FROM pg_constraint
 WHERE conrelid = 'memory_map_slots_zh'::regclass AND contype = 'f' ORDER BY conname;
-- memory_map_slots_zh_parentId_fkey     a   (NO ACTION — NOT r)
-- memory_map_slots_zh_userId_fkey       c
-- memory_map_slots_zh_vocabEntryId_fkey n   (SET NULL)

-- Same three checks for memory_map_slots_es.

SELECT COUNT(*) FROM memory_map_slots_zh;                                   -- 0 right after deploy
```

Then open Memory Map on PPE as any account:

* the map has **50 tiles** (header reads `n / 50`), **tilted**, in several islands;
* an account with few cards still gets 50 (the rest are lent);
* afterwards `SELECT COUNT(*), COUNT(DISTINCT "parentId") FROM memory_map_slots_zh WHERE "userId" = '<that user>';`
  → `50 | ≥1`, and exactly one row has `"parentId" IS NULL`.

## User-visible changes

* Every existing map is **regenerated** on next visit (arrangement only; no progress is
  lost — membership is the reading track, marks live on the vet). The growth toast will
  announce up to 50 "new" words once.
* Words are bare ink characters (no outline until armed — blue — or answered — green / orange / red), tilted −30°…+30° (normal around 0°, σ 6°), multi-character words on a light arc (bow, σ 5° of end lean), touching character to character — no tiles, no fences. Glyph shapes are measured from the learner's font on load.
* Maps are always full at 50, lending provisional cards when the library is short (this
  mints `starterPackBucket = 'provisional'` vet rows for small accounts on first visit).
* A graduated word's slot is refilled in place after it fades.

## Rollback

Code: revert the commit and rebuild. Schema: the old shape cannot be restored with data
(positions were never stored in the new model), but maps regenerate on load anyway, so
recreating the empty old tables is enough:

```sql
BEGIN;
TRUNCATE memory_map_slots_zh, memory_map_slots_es;
ALTER TABLE memory_map_slots_zh RENAME TO memory_map_placements_zh;
ALTER TABLE memory_map_slots_es RENAME TO memory_map_placements_es;
ALTER TABLE memory_map_placements_zh DROP COLUMN "parentId", DROP COLUMN link, DROP COLUMN angle, DROP COLUMN tilt,
  ADD COLUMN x REAL NOT NULL, ADD COLUMN y REAL NOT NULL, ALTER COLUMN "vocabEntryId" SET NOT NULL;
ALTER TABLE memory_map_placements_es DROP COLUMN "parentId", DROP COLUMN link, DROP COLUMN angle, DROP COLUMN tilt,
  ADD COLUMN x REAL NOT NULL, ADD COLUMN y REAL NOT NULL, ALTER COLUMN "vocabEntryId" SET NOT NULL;
DELETE FROM schema_migrations WHERE version = 173;
COMMIT;
```

(Constraint/sequence names keep their `slots` spelling after this; harmless — the old
DAL never names them. The vocabEntryId FK stays SET NULL rather than CASCADE; harmless
for the old code, which only ever reads rows that join to a live card.)
