# Data Deployment Guide

## Overview

A "data deployment" syncs the local `dictionaryentries` table (det) to production, completely overwriting prod's copy. This is done after running backfill scripts locally that enrich dictionary entry data.

The transfer uses **Git LFS** — the SQL dump is committed to the repo as a large file, pushed to GitHub, then pulled on the server. This avoids the need for direct SCP access to the server.

**Scope**: `dictionaryentries` table only. No other tables are affected.

**Foreign keys**: As of 2026-04-09, no other tables have FK references to `dictionaryentries`, so a plain `TRUNCATE` is safe.

---

## Prerequisites

- Local Docker stack is running (`cow-postgres-local` container up)
- Code deployment already done (schema migrations already applied to prod)
- Git LFS is installed and the repo is configured (`.gitattributes` tracks `database/dictionaryentries-data.sql`)

---

## Process

### Step 1 — Dump from local Postgres into the LFS file

Run locally:

```bash
docker exec cow-postgres-local pg_dump -U cow_user -d cow_db -t dictionaryentries --data-only -f /tmp/det_dump.sql
docker cp cow-postgres-local:/tmp/det_dump.sql /home/cow/database/dictionaryentries-data.sql
sed -i '/^\\restrict /d; /^\\unrestrict /d' /home/cow/database/dictionaryentries-data.sql
```

This overwrites `database/dictionaryentries-data.sql` with a fresh plain-SQL dump (uses `COPY` format). The `sed` strips `\restrict`/`\unrestrict` security headers added by pg_dump 15.17+ that cause psql errors on the prod container.

### Step 2 — Commit and push via LFS

```bash
git add database/dictionaryentries-data.sql
git commit -m "data: refresh dictionaryentries dump"
git push origin main
```

Git LFS automatically uploads the large file to GitHub's LFS storage. The rest of the repo sees only a pointer file.

### Step 3 — Pull on the server and restore

SSH into the server, then run:

```bash
cd ~/vocabulary-app
git pull origin main

# Truncate prod's dictionaryentries, then restore from the SQL dump
docker exec cow-postgres-prod psql -U cow_user -d cow_db -c "TRUNCATE TABLE dictionaryentries;"
docker cp database/dictionaryentries-data.sql cow-postgres-prod:/tmp/det_dump.sql
docker exec cow-postgres-prod psql -U cow_user -d cow_db -f /tmp/det_dump.sql
```

### Step 4 — Verify

```bash
docker exec cow-postgres-prod psql -U cow_user -d cow_db -c "SELECT COUNT(*) FROM dictionaryentries;"
```

Cross-check the count against local:

```bash
# Run locally
docker exec cow-postgres-local psql -U cow_user -d cow_db -c "SELECT COUNT(*) FROM dictionaryentries;"
```

Counts should match.

---

## Notes

- `database/dictionaryentries-data.sql` is tracked by Git LFS (see `.gitattributes`). Do not remove this tracking.
- The dump uses `--data-only` — only row data is transferred, not the table schema. Schema is managed by migrations.
- If FK references to `dictionaryentries` are added in the future, check whether `TRUNCATE CASCADE` is needed (it would also clear those referencing tables).
- The `det_dump.dump` binary format file (used in an earlier approach) can be deleted from the project root if present — the LFS SQL approach supersedes it.
