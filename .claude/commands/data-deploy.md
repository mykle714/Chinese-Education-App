# Data Deployment (reference tables → prod)

Sync one or more local reference tables to production, completely overwriting prod's copy.

## Allowable Tables

Only these tables may be data-deployed. All others contain live user data and must never be touched:

| Table | Dump file | Restore mode |
|---|---|---|
| `dictionaryentries_zh` | `database/dictionaryentries_zh-data.dump` | TRUNCATE + restore (full overwrite) |
| `dictionaryentries_es` | `database/dictionaryentries_es-data.dump` | TRUNCATE + restore (full overwrite) |
| `particlesandclassifiers` | `database/particlesandclassifiers-data.dump` | TRUNCATE + restore (full overwrite) |
| `icons8` | `database/icons8-data.dump` | **Merge only** (see below) — never truncate |

> **Prereq for `dictionaryentries_es`**: prod must already have the table (migration 58
> applied) before restoring, or `pg_restore` will fail. Confirm migrations are current
> on prod first.

> **FK dependency — always deploy `icons8` alongside `dictionaryentries_zh`/`_es`**:
> both tables have `iconId` FK-referencing `icons8("icons8Id")` (`ON DELETE SET NULL`,
> not deferrable). If the local dump carries icon references prod's `icons8` doesn't
> have yet, the `dictionaryentries_zh`/`_es` restore's `COPY` fails atomically —
> **the entire table restore aborts and the table is left empty** (this happened in
> production on 2026-07-02). Always merge-sync `icons8` first, in the same deploy.

## Environment

- **Local DB container**: `cow-postgres-local` (postgres:15-alpine)
- **Prod DB container**: `cow-postgres-prod` (on server 174.127.171.180)
- **LFS files**: `database/<table>-data.dump` (binary custom format, tracked in `.gitattributes`)
- **SSH**: User SSHs in manually. You do not have SSH access — give the user the commands to run.

---

## Steps (per table)

Repeat these steps for each table being deployed. Substitute `<TABLE>` with the table name (e.g. `dictionaryentries_zh`).

### 1. Dump from local Postgres (run locally)

```bash
docker exec cow-postgres-local pg_dump -U cow_user -d cow_db -t <TABLE> --data-only -F c -f /tmp/<TABLE>_dump.dump
docker cp cow-postgres-local:/tmp/<TABLE>_dump.dump /home/cow/database/<TABLE>-data.dump
```

Report the file size and row count:

```bash
ls -lh /home/cow/database/<TABLE>-data.dump
docker exec cow-postgres-local psql -U cow_user -d cow_db -c "SELECT COUNT(*) FROM <TABLE>;"
```

### 2. Commit and push via LFS (run locally)

```bash
git add database/<TABLE>-data.dump
git commit -m "data: refresh <TABLE> dump"
git push origin main
```

Confirm LFS upload completes successfully.

### 3. Tell the user to run on the server

Always present ALL server commands as a single copy-pasteable block. Example for `<TABLE>`:

```bash
cd ~/vocabulary-app
git pull origin main

docker cp database/<TABLE>-data.dump cow-postgres-prod:/tmp/<TABLE>_dump.dump
docker exec cow-postgres-prod psql -U cow_user -d cow_db -c "TRUNCATE TABLE <TABLE>;"
docker exec cow-postgres-prod pg_restore -U cow_user -d cow_db -t <TABLE> --data-only /tmp/<TABLE>_dump.dump

# Verify (should match local count)
docker exec cow-postgres-prod psql -U cow_user -d cow_db -c "SELECT COUNT(*) FROM <TABLE>;"
```

---

## `icons8` — merge-only sync (never TRUNCATE)

`icons8` is a shared cache table: prod accumulates its own rows organically (users
picking custom card icons, `ensureIcon` download-on-select — see
`docs/CARD_ICON_LAYOUT.md`), so a full overwrite would destroy live prod data other
tables FK-reference (`dictionaryentries_zh/_es.iconId`, `users.avatarIconId`).
Instead, merge local's rows into prod's table, keeping every prod-only row:

### 1–2. Dump and commit — same as any other table (`-t icons8 --data-only -F c`), pushed via LFS.

### 3. Merge-restore on the server

Swap the live table aside, restore the dump into a fresh scratch table (which
FK-checking tables continue to reference correctly by name across the rename), copy
new rows across with `ON CONFLICT DO NOTHING`, then drop the scratch copy:

```bash
cd ~/vocabulary-app
git pull origin main

docker cp database/icons8-data.dump cow-postgres-prod:/tmp/icons8_dump.dump
docker exec cow-postgres-prod psql -U cow_user -d cow_db -c 'ALTER TABLE icons8 RENAME TO icons8_live;'
docker exec cow-postgres-prod psql -U cow_user -d cow_db -c 'CREATE TABLE icons8 (LIKE icons8_live INCLUDING ALL);'
docker exec cow-postgres-prod pg_restore -U cow_user -d cow_db -t icons8 --data-only /tmp/icons8_dump.dump
docker exec cow-postgres-prod psql -U cow_user -d cow_db -c 'INSERT INTO icons8_live SELECT * FROM icons8 ON CONFLICT ("icons8Id") DO NOTHING;'
docker exec cow-postgres-prod psql -U cow_user -d cow_db -c 'DROP TABLE icons8;'
docker exec cow-postgres-prod psql -U cow_user -d cow_db -c 'ALTER TABLE icons8_live RENAME TO icons8;'

# Verify — prod count should be >= local count (prod keeps its own extra rows)
docker exec cow-postgres-prod psql -U cow_user -d cow_db -c "SELECT COUNT(*) FROM icons8;"
```

Run this **before** any `dictionaryentries_zh`/`_es` restore in the same deploy, so
every `iconId` those dumps carry already exists in prod's `icons8`.

---

## Important Notes

- **CRITICAL — allowable tables ONLY**: Never dump or restore any table not listed in the allowable tables above. Other tables (users, vocab entries, flashcard history, etc.) contain live production data that would be permanently overwritten and lost. The `-t <TABLE>` flag in `pg_dump` and `pg_restore` must always be present.
- Always use `-F c` (binary custom format) for the dump — plain SQL causes psql compatibility errors on prod due to pg_dump 15.17 meta-commands (`\N`, `\.`, `\restrict`).
- Always use `pg_restore` on the server (not `psql -f`) because the dump is binary format.
- Full reference: `docs/DATA_DEPLOYMENT_GUIDE.md`
