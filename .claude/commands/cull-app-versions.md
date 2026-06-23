# Cull App Versions — keep one dev app on port 3000

Ensure exactly **one** version of the dev app is running and that it is the canonical
frontend on **port 3000**. Use when the user says the app behaves like stale/old code,
sees a version that doesn't match recent changes, or asks to "make sure only one version
is running" / "kill the other versions".

## Why this is needed

The dev app runs as live-reload Docker containers (`npm run dev`). Duplicates accumulate:
a host `npm run dev` / Vite started outside Docker, a leftover container from another
worktree, or a second frontend on a stray port (3001 / 5173 / 4173). When more than one
is up, the browser may be talking to an old one — so a fix that's already in the code
"doesn't show up". This skill culls everything except the one canonical dev stack and the
prod stack.

## Hard safety rules

1. **NEVER touch the prod stack.** On this machine prod runs alongside dev (see
   `deploy.md`): any container whose name ends in `-prod` (`cow-frontend-prod`,
   `cow-backend-prod`, `cow-postgres-prod`) and anything on ports **80 / 443 / 5002** is
   off-limits. Confirm the machine first with `amIOnTheProdMachine.md`; the rules are the
   same either way, but be extra careful if it says PROD.
2. **Detect, don't assume ports.** The live container port maps drift from the docs
   (dev backend has been seen on `5000` *and* `5001`; dev db on `5432` *and* `5433`).
   Always read the actual maps from `docker ps`; never hardcode.
3. **Keep the DB.** `cow-postgres-local` holds dev data — never remove it, only ever
   start it if stopped.
4. Stop/remove **app server** duplicates only (frontend / backend / stray Vite). Leave
   `cow-adminer` and `cow-postgres-local` alone.

## Step 1 — Inventory everything that could be serving the app

```bash
# Docker containers (note ports + status)
docker ps -a --format '{{.Names}}\t{{.Ports}}\t{{.Status}}' | grep -E 'cow-|frontend|backend'

# AUTHORITATIVE duplicate check — listeners on dev-ish ports. A `docker-proxy` owner is
# the canonical Docker map; any owner that is NOT docker-proxy is a stray HOST dev server.
ss -ltnp 2>/dev/null | grep -E ':(3000|3001|3002|4173|5173|5000|5001)\b'

# Candidate host dev servers. CAUTION: this ALSO lists the container's OWN processes
# (Docker shares the host PID view), so it is noisy — do NOT kill blindly. A process is
# a real host stray ONLY if its cwd is a host repo path; a container process has cwd /app.
ps -eo pid,cmd | grep -E 'vite|npm run dev|node .*(server|index)' | grep -v grep
# Disambiguate each suspicious pid — container = /app, host stray = /home/cow[/...]:
#   ls -l /proc/<pid>/cwd
```

## Step 2 — Identify the canonical version (the keeper)

The keeper is the Docker frontend publishing **0.0.0.0:3000->3000** — normally
`cow-frontend-local`. Confirm it answers:

```bash
docker ps --format '{{.Names}} {{.Ports}}' | grep '3000->'   # expect cow-frontend-local
curl -sI http://localhost:3000 | head -1                     # expect HTTP 200
```

Its sibling local containers (same compose project, names ending `-local`) form the
canonical set to keep: `cow-frontend-local`, `cow-backend-local`, `cow-postgres-local`,
`cow-adminer`.

## Step 3 — Cull the strays

**(a) Host (non-Docker) dev servers.** A stray host instance is a non-`docker-proxy`
listener on a dev port (from the `ss` check) **and/or** a `vite`/`npm run dev`/`node`
process whose `cwd` is a host repo path (`/proc/<pid>/cwd` → `/home/cow…`, not `/app`).
Kill only those — never a process whose cwd is `/app` (that is the container itself):

```bash
kill <pid>        # escalate to: kill -9 <pid> only if it doesn't exit
```

**(b) Duplicate / orphaned Docker app containers.** Any container that is an app
frontend or backend but is **not** in the canonical `-local` set and **not** `-prod`
(e.g. a second `cow-frontend-*`, a container publishing 3000/3001 from another worktree,
an old image). Stop and remove it:

```bash
docker stop <name> && docker rm <name>
```

Do **not** remove `cow-postgres-local`, `cow-adminer`, or any `-prod` container.

## Step 4 — Make sure the keeper is up

If the canonical set isn't running, start it (compose is preferred so the network/links
are correct):

```bash
# Preferred — from the main repo where the compose file lives:
docker compose -f /home/cow/docker-compose.yml up -d cow-frontend-local cow-backend-local cow-postgres-local
# Fallback if already created but stopped:
docker start cow-postgres-local cow-backend-local cow-frontend-local
```

## Step 5 — Verify the end state

```bash
docker ps --format '{{.Names}}\t{{.Ports}}' | grep -E 'cow-'   # one *-local frontend, one backend
ss -ltnp 2>/dev/null | grep ':3000'                            # exactly one listener (docker-proxy)
curl -sI http://localhost:3000 | head -1                       # HTTP 200
```

Report: which strays were culled, and the final single-frontend-on-3000 state.

## Important caveat — which CODE port 3000 serves

Culling guarantees *one* running version; it does **not** guarantee that version is the
code you're editing. The dev containers **bind-mount `/home/cow` (the main working
tree)**, not git worktrees under `/home/cow/.claude/worktrees/`. So changes made on a
worktree branch will NOT appear on port 3000 until they're in `/home/cow`'s working tree
(the containers run `npm run dev`, so once the files are there Vite/nodemon hot-reload
them). If the user is on a worktree and "doesn't see" their change after culling, the
cause is the mount, not a duplicate — surface that and confirm how they want the
worktree branch reflected into `/home/cow`.
