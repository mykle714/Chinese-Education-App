#!/usr/bin/env bash
#
# Snapshot the dictionary-entry tables from the PRODUCTION database.
#
# LAYER: data-enrichment (backfill) safety net.
#
# WHY: enrichment now writes directly to prod (the old dev → /data-deploy review
# gate is retired), so a bad run reaches learners immediately with no staging copy
# to fall back on. Every oracle-backfill run takes one of these FIRST.
#
# Dumps dictionaryentries_zh, dictionaryentries_es and validations (the last so a
# restore cannot resurrect det rows while dropping the human review records that
# protect them) to server/backups/det-<UTC timestamp>.sql.gz.
#
# RESTORE (destructive — read before running):
#   gunzip -c server/backups/det-<ts>.sql.gz \
#     | docker exec -i cow-postgres-prod psql -U cow_user -d cow_db
#
# USAGE: scripts/backfill/backup-det.sh [label]
# Referenced by: .claude/commands/oracle-backfill.md
set -euo pipefail

REPO_ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/../../.." && pwd)"
LABEL="${1:-}"
TS="$(date -u +%Y%m%dT%H%M%SZ)"
OUT_DIR="$REPO_ROOT/server/backups"
OUT="$OUT_DIR/det-${TS}${LABEL:+-$LABEL}.sql.gz"

mkdir -p "$OUT_DIR"

echo "📦 Dumping det tables from cow-postgres-prod ..."
# --clean --if-exists so the dump is directly replayable over an existing DB.
docker exec cow-postgres-prod pg_dump \
  -U cow_user -d cow_db \
  --clean --if-exists \
  -t dictionaryentries_zh \
  -t dictionaryentries_es \
  -t validations \
  | gzip > "$OUT"

# pipefail makes a pg_dump failure fatal, but an empty/truncated file is still
# possible if the container died mid-stream — check the artifact is plausible.
SIZE=$(stat -c%s "$OUT")
if [[ "$SIZE" -lt 100000 ]]; then
  echo "❌ Backup looks truncated (${SIZE} bytes): $OUT" >&2
  exit 1
fi

echo "✅ Backup written: $OUT ($(numfmt --to=iec "$SIZE"))"
echo "$OUT"
