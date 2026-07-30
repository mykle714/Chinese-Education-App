#!/bin/bash
# migrate.sh — Applies pending migration files from database/migrations/ to the target database.
#
# Usage:
#   ./migrate.sh [host] [port] [database] [user]
#   ./migrate.sh --dry-run              [host] [port] [database] [user]
#   ./migrate.sh --allow-out-of-order   [host] [port] [database] [user]
#   ./migrate.sh --baseline <version>   [host] [port] [database] [user]
#
# Defaults to local Docker credentials if no args supplied.
#
# How it works:
#   1. Reads the SET of versions already recorded in schema_migrations.
#   2. Runs every migration file whose version is NOT in that set, in version order.
#   3. Each file runs inside ONE transaction together with its schema_migrations
#      INSERT, so a migration is either fully applied and recorded, or neither.
#
# Migration files must follow the naming convention: <version>-<description>.sql
# e.g. 36-add-foo-column.sql
#
# ── Why a set and not a high-water mark ────────────────────────────────────────
# This script used to select work with `WHERE version > MAX(version applied)`.
# That silently and PERMANENTLY skipped any migration that landed on main out of
# order — routine with parallel branches. If 132 was applied and 130 then merged,
# 130 was never run and the summary cheerfully printed "No new migrations to apply."
# A set difference cannot do that: a version is pending until its own row exists.
#
# Two related failure modes are also closed here:
#   - The migration file used to run with NO surrounding transaction, so a file that
#     failed halfway left the schema partially changed.
#   - The schema_migrations INSERT was a SEPARATE psql invocation, so a failure
#     between the two left the database changed but unrecorded.
#
# ── Out-of-order migrations stop the run ───────────────────────────────────────
# A pending migration whose version is BELOW the highest recorded version means one
# of two very different things, and the script cannot tell them apart:
#   (a) it genuinely never ran (the old runner ate it) — it must be applied; or
#   (b) it DID run but was never recorded, typically because the database was
#       bootstrapped from the full schema dump in database/init/01-init-schema.sql
#       rather than by replaying migrations — it must NOT be applied.
# Guessing either way is dangerous, so the run stops and asks. Use `--baseline N` for
# case (b) and `--allow-out-of-order` for case (a).
#
# ── Databases bootstrapped from the init schema dump ───────────────────────────
# `database/init/01-init-schema.sql` already contains the cumulative result of every
# migration up to whatever version it was dumped at. Such a database must be told so:
#
#     ./migrate.sh --baseline 132 localhost 5432 cow_db cow_user
#
# which records every migration file up to 132 as applied WITHOUT running it. Only
# then will an ordinary run do the right thing.
#
# Note: a few migrations legitimately cannot run inside a transaction (e.g.
# CREATE INDEX CONCURRENTLY). Mark those by putting the line
#   -- migrate:no-transaction
# anywhere in the file; they are then applied unwrapped and recorded afterwards.
#
# See docs/ARCHITECTURE_REVIEW.md finding 11.
#
# Requirements: psql must be installed and reachable on PATH.

set -euo pipefail

DRY_RUN=0
ALLOW_OUT_OF_ORDER=0
BASELINE=""

while [ $# -gt 0 ]; do
    case "$1" in
        --dry-run)            DRY_RUN=1; shift ;;
        --allow-out-of-order) ALLOW_OUT_OF_ORDER=1; shift ;;
        --baseline)           BASELINE="${2:-}"; shift 2 ;;
        --) shift; break ;;
        -*) echo "Unknown option: $1" >&2; exit 2 ;;
        *)  break ;;
    esac
done

PGHOST="${1:-localhost}"
PGPORT="${2:-5432}"
PGDATABASE="${3:-cow_db}"
PGUSER="${4:-cow_user}"

MIGRATIONS_DIR="$(cd "$(dirname "$0")/../migrations" && pwd)"

PSQL="psql -h $PGHOST -p $PGPORT -d $PGDATABASE -U $PGUSER -v ON_ERROR_STOP=1"

echo "==> Connecting to $PGDATABASE on $PGHOST:$PGPORT as $PGUSER"
[ "$DRY_RUN" -eq 1 ] && echo "==> DRY RUN — nothing will be applied"

# Ensure the schema_migrations table exists (safe to run even on first deploy)
$PSQL -q -c "
    CREATE TABLE IF NOT EXISTS schema_migrations (
        version    INTEGER PRIMARY KEY,
        name       VARCHAR(255) NOT NULL,
        applied_at TIMESTAMP NOT NULL DEFAULT NOW()
    );
"

# The SET of applied versions. Read once; membership is tested locally so we don't
# issue a query per file.
APPLIED_VERSIONS=$($PSQL -t -A -c "SELECT version FROM schema_migrations ORDER BY version;")
APPLIED_COUNT=$(echo "$APPLIED_VERSIONS" | grep -c '[0-9]' || true)
HIGHEST_APPLIED=$(echo "$APPLIED_VERSIONS" | grep '[0-9]' | tail -1 || true)
echo "==> $APPLIED_COUNT migration(s) already recorded (highest: ${HIGHEST_APPLIED:-none})"

is_applied() {
    # Exact whole-line match, so version 13 is never mistaken for 130.
    echo "$APPLIED_VERSIONS" | grep -qx "$1"
}

# Echo "<version> <filename>" for every migration file, in version order.
list_migrations() {
    for filepath in $(ls "$MIGRATIONS_DIR"/*.sql 2>/dev/null | sort -V); do
        filename=$(basename "$filepath")
        version=$(echo "$filename" | grep -oE '^[0-9]+' || true)
        [ -z "$version" ] && continue
        # Strip leading zeros so "05" and "5" are one version to the integer column.
        echo "$((10#$version)) $filename"
    done
}

sql_quote() { echo "$1" | sed "s/'/''/g"; }

# ── --baseline: record without running ─────────────────────────────────────────
if [ -n "$BASELINE" ]; then
    if ! echo "$BASELINE" | grep -qE '^[0-9]+$'; then
        echo "ERROR: --baseline needs a version number, got '$BASELINE'" >&2
        exit 2
    fi
    echo "==> BASELINE to version $BASELINE — recording as applied WITHOUT running"
    RECORDED=0
    while read -r version filename; do
        [ "$version" -gt "$BASELINE" ] && continue
        is_applied "$version" && continue
        echo "    RECORD: $filename"
        if [ "$DRY_RUN" -eq 0 ]; then
            $PSQL -q -c "INSERT INTO schema_migrations (version, name) VALUES ($version, '$(sql_quote "$filename")');"
        fi
        RECORDED=$((RECORDED + 1))
    done < <(list_migrations)
    echo "==> Baseline complete. Recorded $RECORDED migration(s) as already applied."
    exit 0
fi

# ── Collect pending work and check ordering before touching anything ───────────
PENDING_LIST=""
OUT_OF_ORDER=""
PENDING=0

while read -r version filename; do
    is_applied "$version" && continue
    PENDING=$((PENDING + 1))
    PENDING_LIST="$PENDING_LIST$version $filename"$'\n'
    if [ -n "$HIGHEST_APPLIED" ] && [ "$version" -lt "$HIGHEST_APPLIED" ]; then
        OUT_OF_ORDER="$OUT_OF_ORDER  $filename"$'\n'
    fi
done < <(list_migrations)

if [ -n "$OUT_OF_ORDER" ] && [ "$ALLOW_OUT_OF_ORDER" -eq 0 ]; then
    OOO_COUNT=$(echo "$OUT_OF_ORDER" | grep -c '[^[:space:]]' || true)
    cat >&2 <<EOF

==> STOPPING: $OOO_COUNT pending migration(s) are BELOW the highest recorded
    version ($HIGHEST_APPLIED). This script will not guess whether they were
    already applied.

$OUT_OF_ORDER
    If this database was bootstrapped from database/init/01-init-schema.sql, these
    migrations are already reflected in the schema and must only be RECORDED:

        $0 --baseline $HIGHEST_APPLIED $PGHOST $PGPORT $PGDATABASE $PGUSER

    If they genuinely never ran (the old high-water-mark runner skipped them),
    apply them for real:

        $0 --allow-out-of-order $PGHOST $PGPORT $PGDATABASE $PGUSER

    Inspect first with --dry-run.
EOF
    exit 1
fi

if [ "$DRY_RUN" -eq 1 ]; then
    [ "$PENDING" -gt 0 ] && echo "$PENDING_LIST" | grep '[0-9]' | while read -r _ f; do echo "    PENDING: $f"; done
    echo "==> $PENDING migration(s) pending."
    exit 0
fi

# ── Apply ──────────────────────────────────────────────────────────────────────
APPLIED=0
while read -r version filename; do
    [ -z "$version" ] && continue
    filepath="$MIGRATIONS_DIR/$filename"
    sql_name=$(sql_quote "$filename")

    if grep -q -- '-- *migrate:no-transaction' "$filepath"; then
        # Opted out of the wrapper (e.g. CREATE INDEX CONCURRENTLY). Applied bare,
        # then recorded — the one case where a crash between the two is possible.
        echo "    APPLY (no transaction): $filename"
        $PSQL -f "$filepath"
        $PSQL -q -c "INSERT INTO schema_migrations (version, name) VALUES ($version, '$sql_name');"
    else
        echo "    APPLY: $filename"
        # One transaction for the migration AND its bookkeeping row: ON_ERROR_STOP
        # aborts the whole thing, so a half-applied migration can never be recorded
        # and a recorded migration can never be half-applied.
        {
            echo "BEGIN;"
            cat "$filepath"
            echo ""
            echo "INSERT INTO schema_migrations (version, name) VALUES ($version, '$sql_name');"
            echo "COMMIT;"
        } | $PSQL -q -f -
    fi

    echo "    OK: $filename applied and recorded"
    APPLIED=$((APPLIED + 1))
done < <(echo "$PENDING_LIST" | grep '[0-9]' || true)

if [ "$APPLIED" -eq 0 ]; then
    echo "==> No new migrations to apply."
else
    echo "==> Done. Applied $APPLIED migration(s)."
fi
