#!/usr/bin/env bash
#
# One-week override of the oracle cron's WEEKLY budget gate.
#
# LAYER: data-enrichment (backfill) operator tool — the write side of the override
# that oracle-cron.sh reads (see its WEEKLY OVERRIDE section).
#
# WHY THIS EXISTS: oracle-cron.sh refuses to start a round once a weekly plan cap
# reaches ORACLE_MAX_UTILIZATION (default 75%). The 25% margin exists for interactive
# use later in the week; when the operator knows they will not need it, this lets them
# hand some or all of it to the backfill for THIS WEEK ONLY. The override expires at
# the weekly cap's own `resets_at`, so the next week automatically starts back at the
# default — there is nothing to remember to undo.
#
# STATE: server/logs/oracle-weekly-override — one line, tab-separated:
#   <percent>  <expires_epoch>  <set_at ISO-8601>  <expires_at ISO-8601>
# Account-wide, not per shard: every worker spends the same weekly pool.
#
# USAGE
#   oracle-weekly-override.sh set <percent>   # 0–100; expires at this week's reset
#   oracle-weekly-override.sh show            # current override + live weekly usage
#   oracle-weekly-override.sh clear           # back to the default immediately
#
# Referenced by: .claude/commands/oracle-weekly-override.md,
#                .claude/commands/oracle-backfill.md (§1.2),
#                server/scripts/backfill/oracle-cron.sh (WEEKLY OVERRIDE)
set -euo pipefail

REPO_ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/../../.." && pwd)"
LOG_DIR="$REPO_ROOT/server/logs"
OVERRIDE_FILE="$LOG_DIR/oracle-weekly-override"
mkdir -p "$LOG_DIR"

# read_weekly: prints "<percent>\t<resets_epoch>\t<resets_at>" for the weekly_all cap.
# weekly_all is THE account-wide weekly pool (weekly_scoped is a per-model sub-cap that
# resets at the same boundary), so its reset is the week boundary the override ends at.
# Falls back to the legacy `seven_day` object for older payload shapes.
read_weekly() {
  python3 - <<'PY'
import datetime, json, os, sys, urllib.request
try:
    creds = json.load(open(os.path.expanduser("~/.claude/.credentials.json")))
    req = urllib.request.Request(
        "https://api.anthropic.com/api/oauth/usage",
        headers={"Authorization": f"Bearer {creds['claudeAiOauth']['accessToken']}",
                 "anthropic-beta": "oauth-2025-04-20"},
    )
    data = json.load(urllib.request.urlopen(req, timeout=20))
except Exception as exc:
    print(f"usage endpoint unreadable ({type(exc).__name__}: {exc})", file=sys.stderr)
    raise SystemExit(1)

pct, resets_at = None, None
for lim in data.get("limits") or []:
    if lim.get("kind") == "weekly_all":
        pct, resets_at = lim.get("percent"), lim.get("resets_at")
if resets_at is None:
    legacy = data.get("seven_day") or {}
    pct, resets_at = legacy.get("utilization"), legacy.get("resets_at")
if not resets_at:
    print("usage payload carried no weekly resets_at", file=sys.stderr)
    raise SystemExit(1)
epoch = round(datetime.datetime.fromisoformat(resets_at).timestamp())
print(f"{pct if pct is not None else '?'}\t{epoch}\t{resets_at}")
PY
}

cmd="${1:-show}"
case "$cmd" in
  set)
    PCT="${2:-}"
    # Integer or decimal in [0, 100]. Above 100 is meaningless — past 100% the plan
    # is already billing credits, and the gate would never fire.
    if ! [[ "$PCT" =~ ^[0-9]+(\.[0-9]+)?$ ]] || ! python3 -c "import sys; sys.exit(0 if 0 <= float('$PCT') <= 100 else 1)"; then
      echo "❌ percent must be a number from 0 to 100, got '${PCT}'" >&2
      exit 1
    fi
    # Fail closed: without the real reset timestamp we cannot bound the override to
    # this week, and an unbounded override is exactly the credit-spend risk the gate
    # exists to prevent.
    if ! WEEKLY="$(read_weekly)"; then
      echo "❌ could not read this week's reset from the usage endpoint — override NOT set." >&2
      echo "   (A stale credential is the usual cause; run any 'claude -p' turn and retry.)" >&2
      exit 1
    fi
    IFS=$'\t' read -r NOW_PCT RESET_EPOCH RESET_AT <<< "$WEEKLY"
    printf '%s\t%s\t%s\t%s\n' "$PCT" "$RESET_EPOCH" "$(date -uIs)" "$(date -uIs -d "@$RESET_EPOCH")" > "$OVERRIDE_FILE"
    echo "✅ weekly gate overridden to ${PCT}% until $(date -uIs -d "@$RESET_EPOCH") (this week's reset)."
    echo "   weekly_all is currently at ${NOW_PCT}%."
    echo "   Any active cap park is discarded on the next cron tick (the threshold changed)."
    ;;
  clear)
    if [[ -e "$OVERRIDE_FILE" ]]; then
      rm -f "$OVERRIDE_FILE"
      echo "✅ override cleared — the weekly gate is back to its default."
    else
      echo "No override was set."
    fi
    ;;
  show)
    if [[ -s "$OVERRIDE_FILE" ]]; then
      IFS=$'\t' read -r O_PCT O_EPOCH O_SET O_EXP < "$OVERRIDE_FILE"
      if (( $(date +%s) < O_EPOCH )); then
        echo "Override: ${O_PCT}% until ${O_EXP} (set ${O_SET})"
      else
        echo "Override: expired at ${O_EXP} (the cron removes it on its next tick) — default applies"
      fi
    else
      echo "Override: none — default applies (ORACLE_MAX_UTILIZATION, 75% unless the crontab sets it)"
    fi
    if WEEKLY="$(read_weekly)"; then
      IFS=$'\t' read -r NOW_PCT RESET_EPOCH RESET_AT <<< "$WEEKLY"
      echo "weekly_all: ${NOW_PCT}% used, resets $(date -uIs -d "@$RESET_EPOCH")"
    fi
    ;;
  *)
    echo "usage: $0 {set <percent>|show|clear}" >&2
    exit 1
    ;;
esac
