#!/bin/bash
# migrate.sh — Applies pending migration files from database/migrations/ to the target database.
#
# Usage:
#   ./migrate.sh [host] [port] [database] [user]
#
# Defaults to local Docker credentials if no args supplied.
#
# How it works:
#   1. Reads the schema_migrations table to find the highest applied version.
#   2. Runs any migration file whose version number is higher than that.
#   3. After each successful migration, inserts a record into schema_migrations.
#
# Migration files must follow the naming convention: <version>-<description>.sql
# e.g. 36-add-foo-column.sql
#
# Requirements: psql must be installed and reachable on PATH.

set -euo pipefail

PGHOST="${1:-localhost}"
PGPORT="${2:-5432}"
PGDATABASE="${3:-cow_db}"
PGUSER="${4:-cow_user}"

MIGRATIONS_DIR="$(cd "$(dirname "$0")/../migrations" && pwd)"

PSQL="psql -h $PGHOST -p $PGPORT -d $PGDATABASE -U $PGUSER"

echo "==> Connecting to $PGDATABASE on $PGHOST:$PGPORT as $PGUSER"

# Ensure the schema_migrations table exists (safe to run even on first deploy)
$PSQL -c "
    CREATE TABLE IF NOT EXISTS schema_migrations (
        version    INTEGER PRIMARY KEY,
        name       VARCHAR(255) NOT NULL,
        applied_at TIMESTAMP NOT NULL DEFAULT NOW()
    );
"

# Get the highest applied version (0 if none)
MAX_APPLIED=$($PSQL -t -c "SELECT COALESCE(MAX(version), 0) FROM schema_migrations;" | tr -d ' ')
echo "==> Highest applied migration: $MAX_APPLIED"

APPLIED=0

for filepath in $(ls "$MIGRATIONS_DIR"/*.sql 2>/dev/null | sort -V); do
    filename=$(basename "$filepath")

    # Extract leading version number from filename (e.g. "36" from "36-add-foo.sql")
    version=$(echo "$filename" | grep -oE '^[0-9]+')

    if [ -z "$version" ]; then
        echo "    SKIP (no version number): $filename"
        continue
    fi

    if [ "$version" -le "$MAX_APPLIED" ]; then
        echo "    SKIP (already applied): $filename"
        continue
    fi

    echo "    APPLY: $filename"
    $PSQL -f "$filepath"

    $PSQL -c "INSERT INTO schema_migrations (version, name) VALUES ($version, '$filename');"
    echo "    OK: $filename recorded in schema_migrations"
    APPLIED=$((APPLIED + 1))
done

if [ "$APPLIED" -eq 0 ]; then
    echo "==> No new migrations to apply."
else
    echo "==> Done. Applied $APPLIED migration(s)."
fi
