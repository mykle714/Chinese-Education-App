#!/usr/bin/env bash
#
# Run a backfill script from the HOST against the PRODUCTION database.
#
# LAYER: data-enrichment (backfill) invocation shim.
#
# WHY THIS EXISTS: backfills used to run inside `cow-backend-local` on the dev box
# and reach prod only via /data-deploy. That flow is retired — enrichment now runs
# directly against prod. But the prod backend image (`cow-prod-backend`) ships
# neither scripts/backfill/ nor tsx, so `docker exec cow-backend-prod ...` cannot
# work. Instead we run the repo's scripts on the host (node + server/node_modules
# are present) and point them at cow-postgres-prod, which publishes 5432 on
# 127.0.0.1 only.
#
# CREDENTIALS: the repo's server/.env.docker holds the DEV password and
# DB_HOST=postgres (a compose service name that does not resolve from the host).
# The prod password lives in the repo-root .env as POSTGRES_PASSWORD. Because
# dotenv does NOT override variables already present in process.env, exporting
# them here wins over .env.docker inside the script.
#
# USAGE:
#   scripts/backfill/run-prod.sh scripts/backfill/chinese/backfill-hsk-level.js --words=未来
#   BACKFILL_ORACLE=export scripts/backfill/run-prod.sh scripts/backfill/chinese/backfill-hsk-level.js
#
# Referenced by: .claude/commands/oracle-backfill.md, .claude/commands/mark-discoverable.md
set -euo pipefail

REPO_ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/../../.." && pwd)"

if [[ ! -f "$REPO_ROOT/.env" ]]; then
  echo "❌ $REPO_ROOT/.env not found — it carries POSTGRES_PASSWORD for the prod DB." >&2
  exit 1
fi

# shellcheck disable=SC1091
set -a; . "$REPO_ROOT/.env"; set +a

if [[ -z "${POSTGRES_PASSWORD:-}" ]]; then
  echo "❌ POSTGRES_PASSWORD is empty in $REPO_ROOT/.env" >&2
  exit 1
fi

# Point the scripts at the published prod port rather than the compose hostname.
export DB_HOST=127.0.0.1
export DB_PORT=5432
export DB_NAME=cow_db
export DB_USER=cow_user
export DB_PASSWORD="$POSTGRES_PASSWORD"

# TLS off: cow-postgres-prod runs postgres:15-alpine, which is not built with TLS
# support, and 5432 is published on 127.0.0.1 only (never the public interface), so
# this connection never leaves the loopback device. DB_SSL is the explicit control
# added to server/db-config.ts — it beats that file's older
# "NODE_ENV=production && DB_HOST!='postgres'" inference, which wrongly infers TLS
# here because we reach the container by IP rather than by its compose hostname.
export DB_SSL=false

cd "$REPO_ROOT/server"
exec npx tsx "$@"
