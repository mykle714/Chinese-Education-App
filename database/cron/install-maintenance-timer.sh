#!/usr/bin/env bash
#
# Install the prod maintenance schedule as a systemd USER timer.
#
# Why this exists: the *SQL logic* (expire-stale-streaks.sql) has always been
# git-tracked, but the *schedule* used to live only in the prod user's crontab —
# untracked and un-deployable. This script makes the schedule a reviewable,
# diffable artifact in the repo and lets `/deploy` install it the same way it
# ships code: edit the templates here, commit, deploy.
#
# ── Why a systemd user timer (and not /etc/cron.d, which this replaced) ────────
#   - NO SUDO, EVER. `/etc/cron.d` is a dead end for an unprivileged deploy on two
#     counts: the directory is root-owned (you cannot create a file in it), and
#     `man 8 cron` requires the files themselves be root-owned and not group- or
#     other-writable, so chown-ing your way in does not work either. That forced
#     an interactive sudo password into every deploy, and in practice the step got
#     skipped (see docs/oracle-runs/oracle-run-20260720T1003Z.md). A user unit
#     lives in ~/.config/systemd/user, which the deploying user already owns.
#   - Same isolation the cron.d drop-in was chosen for: the server hosts other
#     projects, and this project owns exactly two unit files of its own. Editing
#     or removing them cannot disturb another project's schedule.
#   - Ordering is real, not hoped for. See the comment in the .service template.
#   - Overlapping runs are impossible (a service is a singleton), which removes
#     the "tuple concurrently updated" race the two cron lines could hit.
#
# Requires LINGERING to be enabled for the user, or user units only run while the
# user is logged in. This is the ONE thing that needs root, it is a one-time
# machine setup step (not per-deploy), and it is already enabled on prod. The
# script checks and tells you the exact command if it is ever turned off.
#
# Design notes:
#   - PROD ONLY. Dev is intentionally left clean (run the SQL by hand with
#     `psql -f` when testing). See docs/STREAK_EXPIRATION_CRON.md.
#   - Idempotent. It rewrites both unit files and re-enables the timer, so
#     re-running just converges on the same state — safe on every deploy.
#   - Path-portable. Absolute paths are derived from this script's location and
#     substituted into the unit templates for __REPO_DIR__.
set -euo pipefail

# Repo root = two levels up from database/cron/install-maintenance-timer.sh
REPO_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)"
UNIT_DIR="${XDG_CONFIG_HOME:-$HOME/.config}/systemd/user"
TIMER_UNIT="cow-maintenance.timer"
SERVICE_UNIT="cow-maintenance.service"

# `systemctl --user` needs to find the user manager's bus. An interactive shell
# already has these set; a non-login context (some CI/agent shells, `sudo -u`)
# may not, so derive them rather than failing with a confusing bus error.
export XDG_RUNTIME_DIR="${XDG_RUNTIME_DIR:-/run/user/$(id -u)}"

if ! systemctl --user is-system-running >/dev/null 2>&1; then
  # is-system-running prints "degraded"/"running" and exits non-zero for degraded,
  # so only treat a hard failure (no bus at all) as fatal.
  if ! systemctl --user show-environment >/dev/null 2>&1; then
    echo "ERROR: cannot reach the systemd user manager for $(id -un)." >&2
    echo "       Is XDG_RUNTIME_DIR correct? (currently: $XDG_RUNTIME_DIR)" >&2
    exit 1
  fi
fi

# The job runs as whoever installs it, so refuse a root install outright: units
# written to root's ~/.config would never run the deploy user's Docker context.
if [ "$(id -u)" -eq 0 ]; then
  echo "ERROR: do not run this with sudo/as root — it installs a USER timer." >&2
  echo "       Run it as the user that owns the checkout ($(stat -c '%U' "$REPO_DIR"))." >&2
  exit 1
fi

# The unit's ExecStart lines redirect into logs/; make sure it exists (gitignored).
mkdir -p "$REPO_DIR/logs" "$UNIT_DIR"

# Render both templates, substituting the absolute repo path.
for unit in "$SERVICE_UNIT" "$TIMER_UNIT"; do
  sed "s|__REPO_DIR__|$REPO_DIR|g" "$REPO_DIR/database/cron/$unit.template" > "$UNIT_DIR/$unit"
done

systemctl --user daemon-reload
systemctl --user enable --now "$TIMER_UNIT"

# ── Post-install checks ───────────────────────────────────────────────────────

# Without lingering the timer silently stops firing once you log out — the exact
# failure that is hardest to notice, so make it loud.
if [ "$(loginctl show-user "$(id -un)" -p Linger --value 2>/dev/null)" != "yes" ]; then
  echo "WARNING: lingering is NOT enabled for $(id -un)." >&2
  echo "         The timer will only run while you are logged in. One-time fix (needs root):" >&2
  echo "           sudo loginctl enable-linger $(id -un)" >&2
fi

# Guard against the schedule being installed twice. Two schedulers firing the same
# SQL in the same minute race on its CREATE OR REPLACE FUNCTION and one run rolls
# back ("tuple concurrently updated"). Both legacy locations are checked; neither
# can be removed from here (one needs root, and silently editing a shared user
# crontab is not this script's business), so report and let the operator remove them.
if [ -f /etc/cron.d/cow-maintenance ]; then
  echo "WARNING: the legacy cron drop-in /etc/cron.d/cow-maintenance still exists." >&2
  echo "         It duplicates this timer. Remove it (needs root):" >&2
  echo "           sudo rm /etc/cron.d/cow-maintenance" >&2
fi
if crontab -l 2>/dev/null | grep -q 'expire-stale-streaks.sql'; then
  echo "WARNING: the legacy line in your USER crontab still exists." >&2
  echo "         It duplicates this timer. Remove it with:  crontab -e" >&2
fi

echo "Installed $UNIT_DIR/$SERVICE_UNIT and $UNIT_DIR/$TIMER_UNIT (runs as '$(id -un)'):"
systemctl --user list-timers "$TIMER_UNIT" --no-pager
