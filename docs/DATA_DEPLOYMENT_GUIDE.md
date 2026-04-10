# Data Deployment Guide

## Overview

A "data deployment" syncs the local `dictionaryentries` table (det) to production, completely overwriting prod's copy. This is done after running backfill scripts locally that enrich dictionary entry data.

The transfer uses **Git LFS** — the binary dump is committed to the repo, pushed to GitHub, then pulled and restored on the server. This avoids SCP and all psql meta-command compatibility issues.

**Scope**: `dictionaryentries` table only. No other tables are affected.

**Foreign keys**: As of 2026-04-09, no other tables have FK references to `dictionaryentries`, so a plain `TRUNCATE` is safe.

---

## Prerequisites

- Local Docker stack is running (`cow-postgres-local` container up)
- Code deployment already done (schema migrations already applied to prod)
- Git LFS is installed; `.gitattributes` tracks `database/dictionaryentries-data.dump`

---

## Process

### Step 1 — Dump from local Postgres (binary format)

Run locally:

```bash
docker exec cow-postgres-local pg_dump -U cow_user -d cow_db -t dictionaryentries --data-only -F c -f /tmp/det_dump.dump
docker cp cow-postgres-local:/tmp/det_dump.dump /home/cow/database/dictionaryentries-data.dump
```

This produces a binary custom-format dump (~5MB). Binary format avoids plain-SQL psql meta-command issues (`\N`, `\.`, `\restrict`) that arise from version mismatches between local pg_dump and prod psql.

### Step 2 — Commit and push via LFS

```bash
git add database/dictionaryentries-data.dump
git commit -m "data: refresh dictionaryentries dump"
git push origin main
```

Git LFS uploads the binary file to GitHub LFS storage. The rest of the repo sees only a pointer.

### Step 3 — Pull on the server and restore

SSH into the server, then run:

```bash
cd ~/vocabulary-app
git pull origin main

docker cp database/dictionaryentries-data.dump cow-postgres-prod:/tmp/det_dump.dump
docker exec cow-postgres-prod psql -U cow_user -d cow_db -c "TRUNCATE TABLE dictionaryentries;"
docker exec cow-postgres-prod pg_restore -U cow_user -d cow_db -t dictionaryentries --data-only /tmp/det_dump.dump
```

Note: `pg_restore` is used (not `psql -f`) because the dump is in binary custom format.

### Step 4 — Verify

```bash
docker exec cow-postgres-prod psql -U cow_user -d cow_db -c "SELECT COUNT(*) FROM dictionaryentries;"
```

Cross-check against local (should match):

```bash
docker exec cow-postgres-local psql -U cow_user -d cow_db -c "SELECT COUNT(*) FROM dictionaryentries;"
```

---

## Notes

- `database/dictionaryentries-data.dump` is tracked by Git LFS (see `.gitattributes`). Do not remove this tracking or commit without LFS.
- Binary format (`-F c`) is required — plain SQL (`--data-only` without `-F c`) causes psql compatibility errors on prod due to version skew between local pg_dump 15.17 and the prod container.
- If FK references to `dictionaryentries` are added in the future, check whether `TRUNCATE CASCADE` is needed.
- Use the `/data-deploy` skill to run this process interactively.
