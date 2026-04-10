# Data Deployment (dictionaryentries → prod)

Sync the local `dictionaryentries` table to production, completely overwriting prod's copy.

## Environment

- **Local DB container**: `cow-postgres-local` (postgres:15-alpine)
- **Prod DB container**: `cow-postgres-prod` (on server 174.127.171.180)
- **LFS file**: `database/dictionaryentries-data.dump` (binary custom format)
- **SSH**: User SSHs in manually. You do not have SSH access — give the user the commands to run.

## Steps

### 1. Dump from local Postgres (run locally)

```bash
docker exec cow-postgres-local pg_dump -U cow_user -d cow_db -t dictionaryentries --data-only -F c -f /tmp/det_dump.dump
docker cp cow-postgres-local:/tmp/det_dump.dump /home/cow/database/dictionaryentries-data.dump
```

Report the file size and row count:

```bash
ls -lh /home/cow/database/dictionaryentries-data.dump
docker exec cow-postgres-local psql -U cow_user -d cow_db -c "SELECT COUNT(*) FROM dictionaryentries;"
```

### 2. Commit and push via LFS (run locally)

```bash
git add database/dictionaryentries-data.dump
git commit -m "data: refresh dictionaryentries dump"
git push origin main
```

Confirm LFS upload completes successfully.

### 3. Tell the user to run on the server

```bash
cd ~/vocabulary-app
git pull origin main

docker cp database/dictionaryentries-data.dump cow-postgres-prod:/tmp/det_dump.dump
docker exec cow-postgres-prod psql -U cow_user -d cow_db -c "TRUNCATE TABLE dictionaryentries;"
docker exec cow-postgres-prod pg_restore -U cow_user -d cow_db -t dictionaryentries --data-only /tmp/det_dump.dump
```

### 4. Verify

Tell the user to confirm the row count matches local:

```bash
docker exec cow-postgres-prod psql -U cow_user -d cow_db -c "SELECT COUNT(*) FROM dictionaryentries;"
```

## Important Notes

- Always use `-F c` (binary custom format) for the dump — plain SQL causes psql compatibility errors on prod due to pg_dump 15.17 meta-commands (`\N`, `\.`, `\restrict`).
- Always use `pg_restore` on the server (not `psql -f`) because the dump is binary format.
- Full reference: `docs/DATA_DEPLOYMENT_GUIDE.md`
