# PPE Rename Deploy Runbook

> **TEMPORARY — delete once verified on PPE.**
> **Status: NOT YET DEPLOYED** (written 2026-09-13). Derive the real state from the checks
> below, not from this banner.

The SSH box (`beech-2025`, 174.127.171.187) is renamed from "prod" to **PPE**
(pre-production). The rename also changes things that exist at runtime, so a plain
`/deploy` is **not** enough:

| Before | After | Where it lives |
|---|---|---|
| `docker-compose.prod.yml`, project `cow-prod` | `docker-compose.ppe.yml`, project `cow-ppe` | repo |
| `cow-{postgres,backend,frontend}-prod` / `-local` | `cow-{postgres,backend,frontend}` on **both** machines | compose files |
| volume `cow-prod_postgres_data` (PPE) / `cow_postgres_data` (dev) | `cow_postgres_data` on both, **pinned** via `volumes.postgres_data.name` | Docker daemon on each box |
| `server/scripts/backfill/run-prod.sh` | `run-ppe.sh` | repo (called by `oracle-cron.sh`) |
| `amIOnTheProdMachine.md` | `machineEnvironment.md` | gitignored, **renamed by hand on each box** |
| `/ssh-prod`, `/data-prod-to-dev` | `/ssh-ppe`, `/data-ppe-to-dev` | `.claude/commands/` |
| `~/.ssh/id_ed25519_cow_prod` | `~/.ssh/id_ed25519_cow_ppe` | dev box only |
| `PROD_DB_*` env vars | `PPE_DB_*` | `server/scripts/gloss-pipeline/push-groups.ts` |

**No migration.** The data is copied from volume to volume, not changed by SQL.

## ⚠️ The one way this loses data (apparently)

Docker names an unpinned volume `<project>_<volume>`. Changing the project from `cow-prod`
to `cow-ppe` without the `name:` pin would make `up` create a **new, empty** volume, and
the app would start against a blank database. The old volume would still exist, so this is
recoverable, but it looks exactly like data loss. The pin prevents that, and the copy in
step 5 moves the data under the pinned name. **Never run `down -v` at any point.**

## Step order (on PPE, as `michael`, in `~/vocabulary-app`)

1. **Pause the oracle cron.** Comment out both `oracle-cron.sh` lines in `crontab -e`.
   Confirm no round is running: `pgrep -af oracle-cron` returns nothing.
2. **Converge git.** Commit PPE's local work and push it. Then confirm
   `git rev-list --left-right --count HEAD...origin/main` → `0 0` before pulling.
3. **Back up and count rows** (while still on the old names):
   ```bash
   mkdir -p ~/backups
   docker exec cow-postgres-prod pg_dump -U cow_user -d cow_db -Fc > ~/backups/pre-ppe-rename-$(date +%Y%m%d%H%M).dump
   docker exec cow-postgres-prod psql -U cow_user -d cow_db -At -c \
     "SELECT (SELECT count(*) FROM users)||' '||(SELECT count(*) FROM dictionaryentries_zh)||' '||(SELECT count(*) FROM vocabentries_zh)||' '||(SELECT max(version) FROM schema_migrations)" \
     | tee ~/backups/pre-ppe-rename-counts.txt
   ```
4. **Stop the old stack**, using the OLD file (it disappears with the pull):
   `docker compose -f docker-compose.prod.yml down` (**no `-v`**). Then `git pull`.
5. **Copy the volume** (the stack is stopped, so the data files are consistent):
   ```bash
   docker volume create cow_postgres_data
   docker run --rm -v cow-prod_postgres_data:/from:ro -v cow_postgres_data:/to alpine \
     sh -c 'cp -a /from/. /to/'
   ```
6. **Check what compose resolves BEFORE `up`:**
   `docker compose -f docker-compose.ppe.yml config | grep -A2 '^volumes:'`
   → must show `name: cow_postgres_data`.
7. **Start and rebuild:** `docker compose -f docker-compose.ppe.yml up -d --build`.
   Compose may warn that the volume "already exists but was not created by Docker
   Compose". That is expected (step 5 created it); it is still the volume that gets used.
8. **Verify**, where every check must pass:
   ```bash
   docker ps --format '{{.Names}} {{.Status}}' | grep '^cow-'      # cow-postgres, cow-backend, cow-frontend all Up
   docker inspect cow-postgres --format '{{range .Mounts}}{{.Name}}{{end}}'   # → cow_postgres_data
   docker exec cow-postgres psql -U cow_user -d cow_db -At -c \
     "SELECT (SELECT count(*) FROM users)||' '||(SELECT count(*) FROM dictionaryentries_zh)||' '||(SELECT count(*) FROM vocabentries_zh)||' '||(SELECT max(version) FROM schema_migrations)"
   # → identical to ~/backups/pre-ppe-rename-counts.txt
   curl -s -o /dev/null -w '%{http_code}\n' https://mren.me/            # → 200
   ```
9. **Pending migrations:** run `migrate.sh --dry-run` against PPE and apply any per `/deploy`.
10. **Timers:** `database/cron/install-timers.sh`, then
    `grep -h ExecStart ~/.config/systemd/user/cow-*.service` → only `cow-postgres` / `cow-backend`.
11. **Marker file:** `mv amIOnTheProdMachine.md machineEnvironment.md` and make it say PPE.
12. **Resume the oracle cron.** Uncomment both lines. The script path is unchanged, and it now
    calls `run-ppe.sh`. Optionally dry-run it: `DRY_RUN=1 SHARD=0/2 server/scripts/backfill/oracle-cron.sh`.

**Dev box:** `docker-compose down && docker-compose up -d` (no `-v`) recreates the containers
under the new names. The volume keeps its name (`cow_postgres_data`), so nothing is copied. Rename
`amIOnTheProdMachine.md` → `machineEnvironment.md` and the SSH key pair.

## If a check fails

- **Row counts differ or the DB is empty** → `docker compose -f docker-compose.ppe.yml down`,
  confirm `cow-prod_postgres_data` still exists, then redo step 5 into a freshly
  removed/recreated `cow_postgres_data`. If in doubt, `pg_restore` the step-3 dump.
- **Containers unhealthy** → `docker logs cow-backend`. The code is the same as the
  pre-rename build plus the pulled commits, so check the pulled commits first.

## Rollback

`git checkout <pre-rename sha> -- docker-compose.prod.yml` (or check out the previous commit),
then `docker compose -f docker-compose.ppe.yml down` and
`docker compose -f docker-compose.prod.yml up -d`. `cow-prod_postgres_data` is untouched by
this whole procedure, so the old stack comes back with its original data. Re-run
`install-timers.sh` from the old commit to restore the old unit files.

## Cleanup (only after a few days of healthy PPE)

`docker volume rm cow-prod_postgres_data`, and `docker image prune` for the old
`cow-prod-*` images. Delete this runbook.

**Referenced code:** `docker-compose.ppe.yml` → `volumes.postgres_data.name`; `docker-compose.yml`
→ same; `database/cron/install-timers.sh`; `database/cron/cow-*.service.template`;
`server/scripts/backfill/oracle-cron.sh`; `server/scripts/backfill/run-ppe.sh`.
