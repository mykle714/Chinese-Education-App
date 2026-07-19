#!/usr/bin/env bash
#
# Install the prod maintenance cron as a dedicated /etc/cron.d drop-in.
#
# Why this exists: the *SQL logic* (expire-stale-streaks.sql) has always been
# git-tracked, but the *schedule* (the line that runs it hourly) used to live
# only in the prod user's crontab — untracked and un-deployable. This script
# makes the schedule a reviewable, diffable artifact in the repo and lets
# `/deploy` install it the same way it ships code: edit here, commit, deploy.
#
# Why /etc/cron.d (not the user crontab): the server hosts other projects whose
# cron lives in the same user crontab. A per-project drop-in file gives physical
# isolation — this project owns exactly /etc/cron.d/cow-maintenance, and editing
# or removing it can never disturb another project's schedule.
#
# Design notes:
#   - PROD ONLY. Dev is intentionally left clean (run the SQL by hand with
#     `psql -f` when testing). See docs/STREAK_EXPIRATION_CRON.md.
#   - Idempotent. It writes the whole drop-in file, so re-running just overwrites
#     it with identical content — safe to run on every deploy.
#   - Needs root to write /etc/cron.d. Run as root, or as a sudoer (the script
#     self-elevates with sudo for the file write only). `/deploy` runs it inside
#     a block that already has sudo.
#   - Path-portable. Absolute paths are derived from this script's location.
set -euo pipefail

# Repo root = two levels up from database/cron/install-cron.sh
REPO_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)"
CRON_FILE="/etc/cron.d/cow-maintenance"

# The job must run as the human user that owns the checkout (writable logs/,
# docker group access) — NOT root, even when this script is invoked under sudo.
# Deriving it from the repo dir's owner is robust to being run via `sudo bash …`.
CRON_USER="$(stat -c '%U' "$REPO_DIR")"

# The cron line redirects output here; make sure the dir exists (logs/ is gitignored).
mkdir -p "$REPO_DIR/logs"

# /etc/cron.d format differs from a user crontab: every job line carries a USER
# column between the schedule and the command. The schedule lives HERE — this is
# the editable source of truth for WHEN the job runs. HH:01 so the 4 AM local-day
# boundary has definitely ticked over for any timezone whose rollover is on the hour.
#
# Two jobs, ordered by minute so the second sees the first's writes:
#   :01  expire-stale-streaks.sql — debit inactive users + decay their OCCUPANTS (pure SQL).
#   :02  prune-dangling-templates — remove templates that decay left empty + weakly attached.
#        This is the TypeScript adjacency fixpoint (impractical in plpgsql), run as COMPILED JS
#        inside the backend container (the prod image has no tsx/devDeps). It reads
#        users.lastPenaltyDate to target exactly the users the :01 job just penalized.
read -r -d '' CONTENT <<EOF || true
# /etc/cron.d/cow-maintenance — managed by database/cron/install-cron.sh (do not edit by hand).
# Source of truth lives in the vocabulary-app repo; edit there + redeploy.
# Hourly inactivity-penalty maintenance — see docs/STREAK_EXPIRATION_CRON.md
1 * * * * $CRON_USER /usr/bin/docker exec -i cow-postgres-prod psql -U cow_user -d cow_db < $REPO_DIR/database/cron/expire-stale-streaks.sql >> $REPO_DIR/logs/streak-expire.log 2>&1
2 * * * * $CRON_USER /usr/bin/docker exec cow-backend-prod node dist/scripts/night-market/prune-dangling-templates.js >> $REPO_DIR/logs/prune-templates.log 2>&1
EOF

# /etc/cron.d is root-owned; elevate only for the write. cron auto-detects the
# new file — no service reload needed. File must be root-owned and 0644 or cron
# ignores it.
SUDO=""; [ "$(id -u)" -ne 0 ] && SUDO="sudo"
printf '%s\n' "$CONTENT" | $SUDO tee "$CRON_FILE" >/dev/null
$SUDO chown root:root "$CRON_FILE"
$SUDO chmod 644 "$CRON_FILE"

echo "Installed $CRON_FILE (job runs as '$CRON_USER'):"
cat "$CRON_FILE"
