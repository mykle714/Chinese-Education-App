# Dev Machine Setup

How to stand up a second local dev environment for this repo, with full
functional parity to an existing machine (secrets, seed data, machine
identity). Companion to [DOCKER_GUIDE.md](./DOCKER_GUIDE.md) and
[DOCKER_COMMANDS.md](./DOCKER_COMMANDS.md), which cover day-to-day container
operation once the stack is up.

## What's in git vs. what isn't

The repo (`https://github.com/mykle714/Chinese-Education-App.git`) carries all
code, `docker-compose.yml` / `docker-compose.prod.yml`, `database/migrations/`
(schema, applied automatically on first boot via `database/init`), and the
dictionary seed dumps (`det_dump.dump`, `database/*.dump`).

Everything below is **gitignored** and machine-local — it must be copied in by
hand (scp, password manager, etc.) from an existing dev machine. None of it can
be regenerated from the repo alone.

| File | Consumed by | Contents |
|---|---|---|
| `amIOnTheProdMachine.md` | Claude / any agent working in the repo | Machine identity (`DEV` vs `PROD`); see [CLAUDE.md](../CLAUDE.md) |
| `server/.env` | `npm run server` (non-Docker backend) | `DB_HOST/PORT/NAME/USER/PASSWORD`, `JWT_SECRET`, `CLIENT_URL`, `GOOGLE_APPLICATION_CREDENTIALS`, `GOOGLE_TTS_VOICE_ZH`, `TTS_PROVIDER`, `ICONS8_API_KEY`, `DICT_AI_API_KEY` |
| `server/.env.docker` | `backend` container (docker-compose.yml) | Same DB/JWT/CLIENT_URL fields, plus `ANTHROPIC_API_KEY`, `OPENAI_API_KEY`, `DICT_AI_API_KEY`, `ICONS8_API_KEY` |
| `.env.local` | Vite frontend | `VITE_STREAK_RETENTION_POINTS`, `VITE_STREAK_PENALTY_PERCENT`, `VITE_TEST_USER_MESSAGE` |
| `server/google-tts-credentials.json` | Google Cloud TTS client | GCP service-account key (matches `server/.gitignore`'s `*-credentials.json`) |
| `.claude/settings.local.json` | Claude Code (this machine only) | Local permission overrides — optional, not functionally required by the app |

`docker-compose.prod.yml` env vars are documented separately in
[DOCKER_GUIDE.md](./DOCKER_GUIDE.md#environment-variables) and are only
relevant on the prod server, not a second dev machine.

## Bring-up sequence

1. Install Docker Engine 20.10+, Docker Compose 2.0+, and a Node version
   matching the existing dev machine (no `engines` field is pinned in
   `package.json` / `server/package.json`, so match by hand: `node -v`).
2. `git clone` the repo.
3. Copy in the six gitignored files/dirs from the table above.
4. `docker-compose up --build -d` — brings up `cow-postgres-local` (host
   `5433`), `cow-backend-local` (host `5001` → container `5000`),
   `cow-frontend-local` (host `3000`), `cow-adminer` (host `8080`). Schema
   migrations in `database/migrations/` run automatically against the fresh
   `postgres_data` volume.
5. Restore dictionary seed data — see below.
6. Verify: `curl http://localhost:5001/api/health`, then load
   `http://localhost:3000`.

## Restoring dictionary data

Known gap: `database/restore-dictionary.sh` is stale. It targets a single
`dictionaryentries` table and a `dictionaryentries-data.sql` file, but the
table was split into `dictionaryentries_zh` / `dictionaryentries_es` (see
CLAUDE.md's "Dictionary Tables" section, migrations 57/58), and the seed data
now ships as `.dump` files:

- `database/dictionaryentries_zh-data.dump`
- `database/dictionaryentries_es-data.dump`
- `database/icons8-data.dump`
- `database/particlesandclassifiers-data.dump`
- `det_dump.dump` (repo root — appears to be a superset/alternate of the zh dump; source and relationship to the per-table dumps under `database/` not yet confirmed)

Until the script is updated, restore manually with `pg_restore` (or `psql` if
the dump is plain-text) against `cow-postgres-local`, table by table. Confirm
row counts against an existing dev machine's tables after restore
(`dictionaryentries_zh`, `dictionaryentries_es`, `icons8`,
`particlesandclassifiers`) to check for a clean, complete import.

## Not yet covered here

- Whether `data/` (270MB of source word lists / CSVs, gitignored per repo
  root `.gitignore`'s `*.local` and explicit dump/backup rules — confirm
  before assuming it's needed) must also be copied for any scripts under
  `server/scripts/` to run.
- MCP server config (`.mcp.json`) is committed and needs no machine-specific
  changes, but the Puppeteer MCP server itself (`npx @modelcontextprotocol/server-puppeteer`)
  will re-download on first use — no action needed, just note the first run
  will be slower.
