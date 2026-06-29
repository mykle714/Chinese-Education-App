# Deploy to Production

Deploy the current branch to the production server at 174.127.171.180.

## Environment

- **Server**: 174.127.171.180 — this is the **same machine as dev**. Both dev and prod containers run side by side.
- **App directory**: `~/vocabulary-app`
- **Domain**: `mren.me` — Cloudflare Flexible SSL (Cloudflare terminates HTTPS; server only needs to serve HTTP on port 80)
- **SSH**: User SSHs in manually. You do not have SSH access — give the user the commands to run.
- **Deployment type**: "Future Updates" only (no initial setup needed)

## Port Layout

| Port | Service | Notes |
|------|---------|-------|
| 80 | `cow-frontend-prod` (Docker) | Prod nginx — serves static build + proxies `/api` to backend |
| 443 | `cow-frontend-prod` (Docker) | Mapped but nginx inside only listens on 80; Cloudflare handles SSL |
| 5002 | `cow-backend-prod` (Docker) | Prod backend, bound to `127.0.0.1` only |
| 5432 | `cow-postgres-prod` (Docker) | Prod DB, bound to `127.0.0.1` only |
| 3000 | `cow-frontend-local` (Docker) | Dev Vite server — do NOT expose at `mren.me` |
| 5001 | `cow-backend-local` (Docker) | Dev backend |
| 5433 | `cow-postgres-local` (Docker) | Dev DB |
| 8080 | `cow-adminer` (Docker) | DB admin UI |

**Critical**: A host nginx process (`systemctl`) was previously misconfigured to proxy `mren.me` to the dev Vite server on port 3000. The Vite dev build hardcodes `API_BASE_URL = "http://localhost:5000"`, which resolves to the **user's own machine** — causing "Load failed" on login. The prod Docker frontend serves a production build where `API_BASE_URL = ""` (relative URLs), which routes correctly through nginx. **If the host nginx is running, it must be stopped before starting prod containers** (port conflict on 80).

## Required Files

- **`.env`** must exist at `~/vocabulary-app/.env` with at minimum:
  - `POSTGRES_PASSWORD`
  - `JWT_SECRET`
  - `CLIENT_URL`

## Data Safety

- **Prod postgres volume**: `cow-prod_postgres_data` — holds all real user data
- **NEVER run** `docker-compose -f docker-compose.prod.yml down -v` — the `-v` flag destroys the volume
- Dev containers (`cow-*-local`) run on separate ports and do not conflict with prod; leave them running

## Database Migrations & Tracking

Migrations are **tracked** in a `schema_migrations` table (defined in `database/init/01-init-schema.sql`):

| Column | Meaning |
|--------|---------|
| `version` | migration number, e.g. `54` (primary key) |
| `name` | filename, e.g. `54-add-user-last-penalty-date.sql` |
| `applied_at` | timestamp, defaults to `NOW()` |

**To check which migrations prod has applied** (the authoritative source — do this before deploying to learn what's pending):

```bash
docker exec cow-postgres-prod psql -U cow_user -d cow_db \
  -c "SELECT version, name, applied_at FROM schema_migrations ORDER BY version;"
```

The highest `version` is where prod stands. Pending = any migration file in `database/migrations/` numbered higher.

### Inferring pending migrations from the last deployed commit (preferred, no DB query)

Prod runs on the **same machine as dev** and its checkout lives at `~/vocabulary-app`,
so the commit prod is currently serving is simply that repo's `HEAD` **before** the
`git pull`. Diffing that commit against what you're about to deploy tells you exactly
which migration files this deploy introduces — without needing to read the prod DB.

Run this **before** the deploy block to compute the pending set:

```bash
# Commit prod is currently on (read its checkout's HEAD before pulling):
PROD_SHA=$(git -C ~/vocabulary-app rev-parse HEAD)

# Migration files ADDED between prod's commit and what you're deploying (origin/main),
# in apply order. --diff-filter=A = only newly-added files (edits to existing
# migrations are never re-applied; migrations are immutable once shipped).
git -C ~/vocabulary-app fetch origin main
git -C ~/vocabulary-app log --name-only --diff-filter=A --pretty=format: \
  "${PROD_SHA}..origin/main" -- database/migrations/ \
  | grep -E '^database/migrations/[0-9]+.*\.sql$' | sort -Vu
```

Each line is a migration to run, already in `sort -V` order. Use this list to fill in
the inline migration commands in the deploy block (Step 3). Cross-check against the
`schema_migrations` query above if anything looks off — the DB table is authoritative,
the git diff is the fast path. (If the local repo is what's deployed rather than a
separate `~/vocabulary-app` checkout, substitute the appropriate path / use the
`schema_migrations` query instead.)

**The canonical runner is `database/deploy/migrate.sh`.** It reads `MAX(version)`, applies every file numbered higher (in `sort -V` order), and **records each one into `schema_migrations`**. It is idempotent — already-applied files are skipped, so re-running is safe.

⚠️ **If you apply a migration by hand** (`psql -f`) instead of via `migrate.sh`, you MUST also insert a tracking row, or `migrate.sh` will try to re-run it next time:

```bash
docker exec cow-postgres-prod psql -U cow_user -d cow_db \
  -c "INSERT INTO schema_migrations (version, name) VALUES (54, '54-add-user-last-penalty-date.sql');"
```

## Steps

### 1. Build & fix (run locally)

Run `npm install` first if any new packages were added (check `package.json` for recently added deps that may not be in `node_modules`). Then:

```bash
npm run build
```

If it fails:
- Read the error output carefully
- Fix all TypeScript and ESLint errors (warnings are acceptable)
- Re-run until the build passes
- Do not proceed to commit/push until the build succeeds

### 2. Commit & push (run locally)

Stage and commit all relevant changes, then push to `origin main`.

Determine which migrations are pending using the **"Inferring pending migrations from
the last deployed commit"** method above (diff `prodSHA..origin/main` over
`database/migrations/`). This is what drives the inline migration commands in Step 3 —
note the exact filenames + version numbers so they can be dropped into the command
block verbatim. The `schema_migrations` query is the authoritative fallback if the
git diff is ambiguous.

### 3. Tell the user to run on the server

Check if host nginx is running first (`systemctl is-active nginx`). If it is, the user must stop it before starting prod containers.

Always present ALL server commands as a single copy-pasteable block — never split across multiple steps or prose sections. Include the nginx stop if needed.

**Expand the inferred pending migrations inline.** Take the file list produced by the
"Inferring pending migrations from the last deployed commit" step and emit **one
`docker cp` + `psql -f` + `INSERT` triple per pending file**, in `sort -V` order, with
the real filenames and version numbers substituted in (no `<migration-file>`
placeholders left in the block the user pastes). If the inference found no added
migration files, omit the migration section entirely. Example below shows the shape
with two pending migrations (87 and 88) already substituted:

```bash
cd ~/vocabulary-app
sudo systemctl stop nginx   # only needed if host nginx is running — frees port 80 for prod container
git pull origin main
docker-compose -f docker-compose.prod.yml down
docker-compose -f docker-compose.prod.yml up --build -d

# Maintenance cron (prod only) — idempotent; installs/refreshes the hourly
# inactivity-penalty + weekly-reset schedule as the /etc/cron.d/cow-maintenance
# drop-in from the git-tracked source (self-elevates with sudo for the write).
# Safe to run every deploy. See docs/STREAK_EXPIRATION_CRON.md
bash database/cron/install-cron.sh

# Migration(s) — one cp + -f + INSERT triple per pending file (inferred from prodSHA..origin/main),
# in sort -V order. Copy file into container, run with -f, then RECORD it in schema_migrations.
# (never use < redirect, it breaks in pasted blocks; always insert the tracking row so migrate.sh stays correct)
docker cp database/migrations/87-add-default-icon-results-to-dictionaryentries.sql cow-postgres-prod:/tmp/87-add-default-icon-results-to-dictionaryentries.sql
docker exec cow-postgres-prod psql -U cow_user -d cow_db -v ON_ERROR_STOP=1 -f /tmp/87-add-default-icon-results-to-dictionaryentries.sql
docker exec cow-postgres-prod psql -U cow_user -d cow_db \
  -c "INSERT INTO schema_migrations (version, name) VALUES (87, '87-add-default-icon-results-to-dictionaryentries.sql');"

docker cp database/migrations/88-add-snap-config-to-vocabentries.sql cow-postgres-prod:/tmp/88-add-snap-config-to-vocabentries.sql
docker exec cow-postgres-prod psql -U cow_user -d cow_db -v ON_ERROR_STOP=1 -f /tmp/88-add-snap-config-to-vocabentries.sql
docker exec cow-postgres-prod psql -U cow_user -d cow_db \
  -c "INSERT INTO schema_migrations (version, name) VALUES (88, '88-add-snap-config-to-vocabentries.sql');"

# Verify
docker-compose -f docker-compose.prod.yml ps
curl http://localhost/api/health
```

If there are no pending migrations, omit that section but keep everything else in one block.
