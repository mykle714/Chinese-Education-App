# Data Deployment (reference tables → prod)

Sync one or more local reference tables to production, completely overwriting prod's copy.

## Allowable Tables

Only these tables may be data-deployed. All others contain live user data and must never be touched:

| Table | Dump file |
|---|---|
| `dictionaryentries` | `database/dictionaryentries-data.dump` |
| `particlesandclassifiers` | `database/particlesandclassifiers-data.dump` |

## Environment

- **Local DB container**: `cow-postgres-local` (postgres:15-alpine)
- **Prod DB container**: `cow-postgres-prod` (on server 174.127.171.180)
- **LFS files**: `database/<table>-data.dump` (binary custom format, tracked in `.gitattributes`)
- **SSH**: User SSHs in manually. You do not have SSH access — give the user the commands to run.

---

## Steps (per table)

Repeat these steps for each table being deployed. Substitute `<TABLE>` with the table name (e.g. `dictionaryentries`).

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

## Important Notes

- **CRITICAL — allowable tables ONLY**: Never dump or restore any table not listed in the allowable tables above. Other tables (users, vocab entries, flashcard history, etc.) contain live production data that would be permanently overwritten and lost. The `-t <TABLE>` flag in `pg_dump` and `pg_restore` must always be present.
- Always use `-F c` (binary custom format) for the dump — plain SQL causes psql compatibility errors on prod due to pg_dump 15.17 meta-commands (`\N`, `\.`, `\restrict`).
- Always use `pg_restore` on the server (not `psql -f`) because the dump is binary format.
- Full reference: `docs/DATA_DEPLOYMENT_GUIDE.md`
