# Docker Startup Troubleshooting

## Port Already In Use

### Zombie postgres/nginx processes after container stop

**Symptom:** `docker compose up -d` fails with `failed to bind host port X.X.X.X:5432/tcp: address already in use` (or port 80/443), even though `docker ps` shows no running containers.

**Cause:** When Docker stops a container ungracefully (e.g., SIGKILL after timeout, or container is force-removed), child processes spawned by the container's PID 1 (postgres worker processes, nginx workers) can survive as orphans on the host. These processes continue to hold the port.

**Diagnosis:**
```bash
# Find zombie postgres processes (uid 70 is the postgres user in Alpine)
ps aux | grep -E "^70 .* postgres" | grep -v grep | awk '{print $2}'

# Find zombie nginx processes
ps aux | grep nginx | grep -v grep | awk '{print $2}'

# Confirm what's holding the port
ss -tlnp | grep :5432
```

**Fix:** Kill all zombie processes at once, then retry:
```bash
sudo kill <pid1> <pid2> ...
docker compose up -d
```

**Prevention:** Both compose files now include `stop_grace_period: 30s` on the postgres service, giving postgres enough time to checkpoint and shut down cleanly before Docker sends SIGKILL.

---

### Port conflicts with host services

**Symptom:** `failed to bind host port` for ports 5000 (backend) or 5432 (postgres).

**Known conflicts on this host:**
| Port | Conflict | Resolution |
|------|----------|------------|
| 5000 | Plex Media Server | Dev backend mapped to `5001:5000`, prod backend mapped to `5002:5000` |
| 5432 | Prod postgres (when running alongside dev) | Dev postgres mapped to `5433:5432` |

**Note:** Backend containers communicate with postgres via Docker's internal network (`postgres:5432`), so host port mappings only affect external access — changing them does not affect service-to-service communication.

---

## Compose Project Name Conflicts

**Symptom:** Running `sudo docker compose -f docker-compose.prod.yml up -d` recreates or interferes with dev containers, or vice versa.

**Cause:** By default, Docker Compose derives the project name from the directory name. Both `docker-compose.yml` and `docker-compose.prod.yml` live in the same directory (`vocabulary-app`), so they share a project name and Docker treats their containers as belonging to the same project.

**Fix applied:** Both files now have explicit `name:` fields at the top:
- `docker-compose.yml` → `name: cow-dev`
- `docker-compose.prod.yml` → `name: cow-prod`

This gives each environment its own isolated namespace of containers and networks.

---

## Frontend Container Not Joining Docker Network

**Symptom:** `docker logs cow-frontend-prod` shows `host not found in upstream "backend"`. `docker inspect cow-frontend-prod --format '{{json .NetworkSettings.Networks}}'` returns `{}`.

**Cause:** The frontend container was created before the Docker network was fully established (e.g., due to repeated failed start attempts). The container exists but was never connected to the compose network.

**Fix:** `restart` does not re-attach a container to a network — use `--force-recreate`:
```bash
sudo docker compose -f docker-compose.prod.yml up -d --force-recreate frontend
```

---

## Database Password Mismatch

**Symptom:** Backend returns 500 on all DB operations. `docker logs cow-backend-prod` shows `ERR_DATABASE_CONNECTION: Database connection unavailable` or `password authentication failed for user "cow_user"`.

**Cause:** `.env` contains two separate password variables:
- `POSTGRES_PASSWORD` — used by the postgres container to initialize the database user
- `DB_PASSWORD` — read by `server/db-config.ts` to connect to the database

If these values differ, the backend cannot authenticate. **These must always be identical.**

**Diagnosis:**
```bash
# Test which password works
docker exec cow-backend-prod node -e "
const { Pool } = require('pg');
const pool = new Pool({ host: process.env.DB_HOST, port: process.env.DB_PORT, database: process.env.DB_NAME, user: process.env.DB_USER, password: process.env.DB_PASSWORD });
pool.connect().then(c => { console.log('OK'); c.release(); pool.end(); }).catch(e => console.error(e.message));
"
```

**Fix:** Ensure `DB_PASSWORD` and `POSTGRES_PASSWORD` in `.env` are identical.

**Important:** After editing `.env`, a `restart` is not sufficient — env vars are baked in at container creation time. Use `--force-recreate`:
```bash
sudo docker compose -f docker-compose.prod.yml up -d --force-recreate backend
```

---

## Missing server/.env.docker

**Symptom:** `docker compose up -d` fails immediately with `env file ./server/.env.docker not found`.

**Cause:** `docker-compose.yml` (dev) requires `server/.env.docker` for the backend service. This file is gitignored and must be created manually.

**Fix:** Create `server/.env.docker` with the local dev database credentials:
```env
DB_HOST=postgres
DB_PORT=5432
DB_NAME=cow_db
DB_USER=cow_user
DB_PASSWORD=cow_password_local

JWT_SECRET=<value from .env>
CLIENT_URL=http://localhost:3000
NODE_ENV=development
PORT=5000
```

The local postgres password (`cow_password_local`) is hardcoded in `docker-compose.yml` under the postgres service environment block.
