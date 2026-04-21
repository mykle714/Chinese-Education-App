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

Check for new migration files in `database/migrations/` — note them so the user knows to run them.

### 3. Tell the user to run on the server

Check if host nginx is running first (`systemctl is-active nginx`). If it is, the user must stop it before starting prod containers.

Always present ALL server commands as a single copy-pasteable block — never split across multiple steps or prose sections. Include the nginx stop if needed. If there are migrations, include them inline. Example:

```bash
cd ~/vocabulary-app
sudo systemctl stop nginx   # only needed if host nginx is running — frees port 80 for prod container
git pull origin main
docker-compose -f docker-compose.prod.yml down
docker-compose -f docker-compose.prod.yml up --build -d

# Migration(s) — copy file into container first, then run with -f (never use < redirect, it breaks in pasted blocks)
docker cp database/migrations/<migration-file>.sql cow-postgres-prod:/tmp/<migration-file>.sql
docker exec cow-postgres-prod psql -U cow_user -d cow_db -f /tmp/<migration-file>.sql

# Verify
docker-compose -f docker-compose.prod.yml ps
curl http://localhost/api/health
```

If there are no migrations, omit that section but keep everything else in one block.
