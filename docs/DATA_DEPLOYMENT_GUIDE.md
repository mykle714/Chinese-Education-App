# Data Deployment Guide

## Overview

A "data deployment" syncs one or more local reference tables to production, completely overwriting prod's copy. This is done after running backfill scripts locally that enrich reference data.

The transfer uses **Git LFS** — the binary dump is committed to the repo, pushed to GitHub, then pulled and restored on the server. This avoids SCP and all psql meta-command compatibility issues.

## Allowable Tables

Only these tables may be data-deployed. All others contain live user data and must never be touched:

| Table | Dump file | Description |
|---|---|---|
| `dictionaryentries` | `database/dictionaryentries-data.dump` | Dictionary entry data enriched by backfill scripts |
| `particlesandclassifiers` | `database/particlesandclassifiers-data.dump` | Particles and classifiers reference data (pct) |

**Foreign keys**: No other tables currently have FK references to these tables, so a plain `TRUNCATE` is safe before restore.

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

## Notes

- All dump files under `database/` are tracked by Git LFS (see `.gitattributes`). Do not remove LFS tracking or commit without LFS.
- Binary format (`-F c`) is required — plain SQL (`--data-only` without `-F c`) causes psql compatibility errors on prod due to version skew between local pg_dump 15.17 and the prod container.
- If FK references to any of these tables are added in the future, check whether `TRUNCATE CASCADE` is needed.
- Use the `/data-deploy` skill to run this process interactively.
