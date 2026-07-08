# Data Deployment Guide

## Overview

A "data deployment" syncs one or more local reference tables to production, completely overwriting prod's copy. This is done after running backfill scripts locally that enrich reference data.

The transfer uses **Git LFS** — the binary dump is committed to the repo, pushed to GitHub, then pulled and restored on the server. This avoids SCP and all psql meta-command compatibility issues.

## Allowable Tables

Only these tables may be data-deployed. All others contain live user data and must never be touched.

> ⚠️ In particular, **never** truncate/restore `validations` (the data-validation
> review records, migration 104 — see [DATA_VALIDATION_SYSTEM.md](./DATA_VALIDATION_SYSTEM.md)).
> It is deliberately kept off this list and keyed by det `id` precisely so that
> `dictionaryentries_{zh,es}` deploys leave human review data intact.

| Table | Dump file | Description | Restore mode |
|---|---|---|---|
| `dictionaryentries_zh` | `database/dictionaryentries_zh-data.dump` | Dictionary entry data enriched by backfill scripts | TRUNCATE + restore |
| `dictionaryentries_es` | `database/dictionaryentries_es-data.dump` | Spanish det, keyed by (word1, pos, gender) — requires migration 58 | TRUNCATE + restore |
| `particlesandclassifiers` | `database/particlesandclassifiers-data.dump` | Particles and classifiers reference data (pct) | TRUNCATE + restore |
| `icons8` | `database/icons8-data.dump` | Icon cache (search results + downloaded bytes) | **Merge only, never TRUNCATE** |

**Foreign keys**: `dictionaryentries_zh.iconId` and `dictionaryentries_es.iconId` FK-reference
`icons8("icons8Id")` (`ON DELETE SET NULL`, migration 72). `users.avatarIconId` also references
it (migration 77). Because `icons8` accrues prod-only rows organically (users picking custom card
icons), it cannot be truncated — a merge-only restore is used instead (see the dedicated section
below). **Always merge-sync `icons8` before restoring `dictionaryentries_zh`/`_es`** in the same
deploy: if the local dump references an icon id prod's `icons8` doesn't have, the `COPY` during
`dictionaryentries_zh`/`_es` restore fails atomically and **the entire table is left empty**
(this happened in production on 2026-07-02 — see incident note at the bottom of this doc).

---

## Prerequisites

- Local Docker stack is running (`cow-postgres-local` container up)
- Code deployment already done (schema migrations already applied to prod)
- Git LFS is installed; `.gitattributes` tracks all dump files under `database/`

---

## Process (per table)

Substitute `<TABLE>` with the table name throughout.

### Step 1 — Dump from local Postgres (binary format)

Run locally:

```bash
docker exec cow-postgres-local pg_dump -U cow_user -d cow_db -t <TABLE> --data-only -F c -f /tmp/<TABLE>_dump.dump
docker cp cow-postgres-local:/tmp/<TABLE>_dump.dump /home/cow/database/<TABLE>-data.dump
```

This produces a binary custom-format dump. Binary format avoids plain-SQL psql meta-command issues (`\N`, `\.`, `\restrict`) that arise from version mismatches between local pg_dump and prod psql.

### Step 2 — Commit and push via LFS

```bash
git add database/<TABLE>-data.dump
git commit -m "data: refresh <TABLE> dump"
git push origin main
```

Git LFS uploads the binary file to GitHub LFS storage. The rest of the repo sees only a pointer.

### Step 3 — Pull on the server and restore

SSH into the server, then run:

```bash
cd ~/vocabulary-app
git pull origin main

docker cp database/<TABLE>-data.dump cow-postgres-prod:/tmp/<TABLE>_dump.dump
docker exec cow-postgres-prod psql -U cow_user -d cow_db -c "TRUNCATE TABLE <TABLE>;"
docker exec cow-postgres-prod pg_restore -U cow_user -d cow_db -t <TABLE> --data-only /tmp/<TABLE>_dump.dump
```

Note: `pg_restore` is used (not `psql -f`) because the dump is in binary custom format.

### Step 4 — Verify

```bash
docker exec cow-postgres-prod psql -U cow_user -d cow_db -c "SELECT COUNT(*) FROM <TABLE>;"
```

Cross-check against local (should match):

```bash
docker exec cow-postgres-local psql -U cow_user -d cow_db -c "SELECT COUNT(*) FROM <TABLE>;"
```

---

## `icons8` merge-restore (never TRUNCATE)

Swap the live table aside, restore the dump into a fresh scratch table with the same
name (FK-checking tables keep resolving correctly across the rename since Postgres FK
constraints follow the renamed table, not the name), merge new rows in with
`ON CONFLICT DO NOTHING` so prod-only rows survive, then drop the scratch copy:

```bash
docker cp database/icons8-data.dump cow-postgres-prod:/tmp/icons8_dump.dump
docker exec cow-postgres-prod psql -U cow_user -d cow_db -c 'ALTER TABLE icons8 RENAME TO icons8_live;'
docker exec cow-postgres-prod psql -U cow_user -d cow_db -c 'CREATE TABLE icons8 (LIKE icons8_live INCLUDING ALL);'
docker exec cow-postgres-prod pg_restore -U cow_user -d cow_db -t icons8 --data-only /tmp/icons8_dump.dump
docker exec cow-postgres-prod psql -U cow_user -d cow_db -c 'INSERT INTO icons8_live SELECT * FROM icons8 ON CONFLICT ("icons8Id") DO NOTHING;'
docker exec cow-postgres-prod psql -U cow_user -d cow_db -c 'DROP TABLE icons8;'
docker exec cow-postgres-prod psql -U cow_user -d cow_db -c 'ALTER TABLE icons8_live RENAME TO icons8;'
```

Run this before any `dictionaryentries_zh`/`_es` restore in the same deploy.

## Notes

- All dump files under `database/` are tracked by Git LFS (see `.gitattributes`). Do not remove LFS tracking or commit without LFS.
- Binary format (`-F c`) is required — plain SQL (`--data-only` without `-F c`) causes psql compatibility errors on prod due to version skew between local pg_dump 15.17 and the prod container.
- Use the `/data-deploy` skill to run this process interactively.

## Incident: 2026-07-02 — dictionary tables left empty mid-deploy

A `dictionaryentries_zh`/`_es` data deploy truncated both tables, then `pg_restore`
hit a `COPY` FK violation on `iconId` (referencing an `icons8` row that existed
locally but not on prod) and aborted the entire restore — leaving both tables with
0 rows in production until manually re-restored with the orphaned `iconId`s nulled
out. Root cause: `icons8` was never part of the sync process even though the det
tables FK-depend on it. Fixed by adding `icons8` above as a required, merge-only
sync step that must run before the det table restores.
