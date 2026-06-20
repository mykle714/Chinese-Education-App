#!/usr/bin/env bash
#
# Idempotently install the prod maintenance cron into the CURRENT user's crontab.
#
# Why this exists: the *SQL logic* (expire-stale-streaks.sql) has always been
# git-tracked, but the *schedule* (the crontab line that runs it hourly) used to
# live only in the prod user's system crontab — untracked and un-deployable. This
# script makes the schedule a reviewable, diffable artifact in the repo and lets
# `/deploy` install it the same way it ships code: edit here, commit, deploy.
#
# Design notes:
#   - PROD ONLY. Dev is intentionally left clean (run the SQL by hand with
#     `psql -f` when testing). See docs/STREAK_EXPIRATION_CRON.md.
#   - Idempotent. Re-running replaces our managed block in place; running it on
#     every deploy is safe.
#   - Non-destructive. Any UNmanaged crontab lines (e.g. the walker test trigger)
#     are preserved untouched — we only rewrite the marker-delimited block below,
#     matched by EXACT line so the markers need no regex escaping.
#   - Path-portable. Absolute paths are derived from this script's location, so a
#     checkout in a different directory still produces correct cron lines.
set -euo pipefail

# Repo root = two levels up from database/cron/install-cron.sh
REPO_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)"

# Exact-match marker lines delimiting the block this script owns.
BEGIN="# BEGIN cow-maintenance-cron (managed by database/cron/install-cron.sh — do not edit by hand)"
END="# END cow-maintenance-cron"

# The managed block. The schedule lives HERE — this is the editable source of
# truth for when the job runs. Runs at HH:01 so the 4 AM local-day boundary has
# definitely ticked over for any timezone whose day-rollover lands on the hour.
read -r -d '' BLOCK <<EOF || true
$BEGIN
# Hourly inactivity-penalty + weekly-reset maintenance — see docs/STREAK_EXPIRATION_CRON.md
1 * * * * /usr/bin/docker exec -i cow-postgres-prod psql -U cow_user -d cow_db < $REPO_DIR/database/cron/expire-stale-streaks.sql >> $REPO_DIR/logs/streak-expire.log 2>&1
$END
EOF

# The cron line redirects output here; make sure the dir exists (logs/ is gitignored).
mkdir -p "$REPO_DIR/logs"

# Rebuild the crontab without our job, then append the fresh managed block.
# We drop THREE things so the result converges to exactly one streak line no
# matter the prior state (guards against double-scheduling = double penalties):
#   1. our marker-delimited block (exact-line match via awk — no regex escaping);
#   2. any leftover line that invokes the job SQL (the LEGACY unmanaged line that
#      predates this script, or a stray duplicate);
#   3. the legacy standalone comment that used to sit above that line.
# Everything else (e.g. the walker test trigger) is preserved verbatim.
current="$(crontab -l 2>/dev/null || true)"
cleaned="$(printf '%s\n' "$current" | awk -v b="$BEGIN" -v e="$END" '
  $0 == b { skip = 1; next }
  skip && $0 == e { skip = 0; next }
  skip { next }
  index($0, "expire-stale-streaks.sql") { next }
  $0 == "# Hourly streak expiration — see docs/STREAK_EXPIRATION_CRON.md" { next }
  { print }
')"

# Drop a leading blank line if the crontab was previously empty.
printf '%s\n%s\n' "$(printf '%s' "$cleaned" | sed '/./,$!d')" "$BLOCK" | crontab -

echo "Installed cow-maintenance cron. Current crontab:"
crontab -l
