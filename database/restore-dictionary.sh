#!/usr/bin/env bash
# Restores dictionaryentries data from the committed dump file.
# Run this once on a fresh environment after `docker-compose up`.
#
# Usage: bash database/restore-dictionary.sh

set -e

CONTAINER="cow-postgres-local"
DB="cow_db"
USER="cow_user"
DUMP_FILE="$(dirname "$0")/dictionaryentries-data.sql"

if [ ! -f "$DUMP_FILE" ]; then
  echo "ERROR: Dump file not found at $DUMP_FILE"
  exit 1
fi

if ! docker ps --filter "name=$CONTAINER" --filter "status=running" --format "{{.Names}}" | grep -q "$CONTAINER"; then
  echo "ERROR: Container '$CONTAINER' is not running. Start it with: docker-compose up -d"
  exit 1
fi

echo "Checking existing row count..."
EXISTING=$(docker exec "$CONTAINER" psql -U "$USER" -d "$DB" -tAc "SELECT COUNT(*) FROM dictionaryentries;")
echo "  Current rows: $EXISTING"

if [ "$EXISTING" -gt 0 ]; then
  read -r -p "Table already has $EXISTING rows. Truncate and re-import? [y/N] " confirm
  if [[ ! "$confirm" =~ ^[Yy]$ ]]; then
    echo "Aborted."
    exit 0
  fi
  echo "Truncating dictionaryentries..."
  docker exec "$CONTAINER" psql -U "$USER" -d "$DB" -c "TRUNCATE TABLE dictionaryentries RESTART IDENTITY;"
fi

echo "Restoring dictionaryentries (this may take a minute)..."
docker exec -i "$CONTAINER" psql -U "$USER" -d "$DB" < "$DUMP_FILE"

FINAL=$(docker exec "$CONTAINER" psql -U "$USER" -d "$DB" -tAc "SELECT COUNT(*) FROM dictionaryentries;")
echo "Done. Rows in dictionaryentries: $FINAL"
