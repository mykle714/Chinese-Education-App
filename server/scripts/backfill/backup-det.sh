#!/usr/bin/env bash
#
# Snapshot the dictionary-entry tables from the PRODUCTION database.
#
# LAYER: data-enrichment (backfill) safety net.
#
# WHY: enrichment now writes directly to prod (the old dev → prod data-deploy review
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

# ── retention ────────────────────────────────────────────────────────────────
# Unattended rounds (oracle-cron.sh) take a dump every run, so without pruning the
# directory grows ~17 MB/round forever. Keep only the newest DET_BACKUP_KEEP (default 1).
#
# Rotation covers EVERY det-*.sql.gz, labeled ones included: the skill passes a label on
# every routine round ("-oracle-run", "-prepass-round3", ...), so exempting labeled dumps
# would exempt essentially all of them and prune nothing. If you need a dump to survive,
# move it out of this directory.
#
# ⚠️ KEEP=1 means the surviving dump is the state before the MOST RECENT round only. A bad
# round not caught before the next one starts has its pre-image deleted, and the corruption
# is baked into the only remaining copy. With parallel workers this is sharper still: two
# workers backing up in the same hour leave only the second one's dump.
KEEP="${DET_BACKUP_KEEP:-1}"
mapfile -t ROTATING < <(ls -1t "$OUT_DIR"/det-*.sql.gz 2>/dev/null || true)
if (( ${#ROTATING[@]} > KEEP )); then
  for old in "${ROTATING[@]:$KEEP}"; do
    rm -f -- "$old"
    echo "🧹 Pruned old backup: $(basename "$old")"
  done
fi

echo "$OUT"
