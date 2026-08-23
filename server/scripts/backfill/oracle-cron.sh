#!/usr/bin/env bash
#
# Unattended launcher for /oracle-backfill.
#
# LAYER: data-enrichment (backfill) invocation shim — the cron-side sibling of
# run-prod.sh (which shims a single script; this shims a whole round).
#
# WHY THIS EXISTS: the oracle answerer is a Claude session, not a headless process
# (server/scripts/backfill/run-log.js, "ORACLE MODE" — the export/apply phases bracket
# a model authoring answers into oracle-answers.jsonl). So "keep the backfill running"
# cannot be a plain `node foo.js` cron entry; it has to start a `claude -p` session.
# It also cannot be a CLOUD scheduled agent: run-prod.sh reaches the DB at
# 127.0.0.1:5432, which cow-postgres-prod publishes on loopback only.
#
# CONCURRENCY: every invocation takes an exclusive, non-blocking flock. A round that
# overruns its tick simply causes the next tick to exit 0 without starting a second
# session — the lock, not the schedule, is what guarantees one worker per shard.
#
# PARALLEL WORKERS: set SHARD=k/N. Each worker then gets
#   - its own lock file          (never two sessions on the same shard)
#   - its own oracle scratch files (BACKFILL_ORACLE_PROMPTS/_ANSWERS — run-log.js
#     honors both; without this the workers interleave prompts into one file)
#   - its own resume/notes paths (the skill's §1.3 parked-run state is a single fixed
#     path by default, so two parked workers would clobber each other)
# and passes --shard=k/N to oracle-plan.js, which partitions candidates by `id % N`.
#
# USAGE
#   oracle-cron.sh                 # single worker, whole candidate pool
#   SHARD=0/3 oracle-cron.sh       # worker 0 of 3
#   DRY_RUN=1 SHARD=0/3 oracle-cron.sh   # verify wiring; no session, no prod writes
#
# BUDGET
#   A round is skipped (exit 0) when plan utilization is at or above
#   ORACLE_MAX_UTILIZATION (default 95%), because spend past the plan cap silently
#   bills extra-usage credits rather than erroring. See the budget gate below.
#   ORACLE_MAX_UTILIZATION=0 parks the cron without editing the crontab.
#
# CRONTAB (hourly; the lock makes over-scheduling harmless)
#   PATH=/home/michael/.nvm/versions/node/v22.22.0/bin:/usr/local/bin:/usr/bin:/bin
#   0 * * * * SHARD=0/3 /home/michael/vocabulary-app/server/scripts/backfill/oracle-cron.sh
#   0 * * * * SHARD=1/3 /home/michael/vocabulary-app/server/scripts/backfill/oracle-cron.sh
#   0 * * * * SHARD=2/3 /home/michael/vocabulary-app/server/scripts/backfill/oracle-cron.sh
#
# Referenced by: .claude/commands/oracle-backfill.md
set -euo pipefail

REPO_ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/../../.." && pwd)"
LOG_DIR="$REPO_ROOT/server/logs"
mkdir -p "$LOG_DIR"

# ── PATH hardening ───────────────────────────────────────────────────────────
# cron does NOT source a login shell, so an interactive PATH is not available here.
# `claude` installs to ~/.local/bin and `npx`/`node` come from the nvm bin dir; neither
# is on cron's default PATH. Prepending them here (rather than in the crontab PATH= line)
# keeps the script self-sufficient for any caller — cron, systemd, or a bare shell.
NVM_BIN="$(ls -d "$HOME"/.nvm/versions/node/*/bin 2>/dev/null | sort -V | tail -1 || true)"
PATH="$HOME/.local/bin${NVM_BIN:+:$NVM_BIN}:$PATH"
export PATH

# ── shard identity ───────────────────────────────────────────────────────────
# SLUG namespaces every per-worker file. Unsharded runs keep the historical
# paths so a manual `/oracle-backfill` and a cron round share their scratch state.
SHARD="${SHARD:-}"
if [[ -n "$SHARD" ]]; then
  if [[ ! "$SHARD" =~ ^[0-9]+/[0-9]+$ ]]; then
    echo "❌ SHARD must look like k/N (e.g. SHARD=0/3), got '$SHARD'" >&2
    exit 1
  fi
  SLUG="shard-${SHARD//\//-}"
  export BACKFILL_ORACLE_PROMPTS="$LOG_DIR/oracle-prompts.$SLUG.jsonl"
  export BACKFILL_ORACLE_ANSWERS="$LOG_DIR/oracle-answers.$SLUG.jsonl"
  export ORACLE_RESUME_FILE="$LOG_DIR/oracle-resume.$SLUG.md"
  export ORACLE_NOTES_FILE="$LOG_DIR/oracle-run-notes.$SLUG.md"
  SHARD_INSTRUCTION="Pass --shard=$SHARD to every oracle-plan.js invocation this round."
else
  SLUG="solo"
  export ORACLE_RESUME_FILE="$LOG_DIR/oracle-resume.md"
  export ORACLE_NOTES_FILE="$LOG_DIR/oracle-run-notes.md"
  SHARD_INSTRUCTION="This is an unsharded run; do not pass --shard."
fi

LOCK="/tmp/oracle-backfill.$SLUG.lock"
RUN_LOG="$LOG_DIR/oracle-cron.$SLUG.log"

# ── single-flight guard ──────────────────────────────────────────────────────
# -n = fail immediately rather than queueing. Re-exec under the lock so the whole
# session, not just the test, is covered; FD 9 stays held for the process lifetime.
exec 9>"$LOCK"
if ! flock -n 9; then
  echo "[$(date -uIs)] $SLUG: previous round still running (lock held) — skipping tick." >> "$RUN_LOG"
  exit 0
fi

# ── preflight the toolchain ──────────────────────────────────────────────────
# Fail loudly and early. Without this a missing binary surfaces as an opaque
# "command not found" buried in a round that already took a prod backup.
for bin in claude flock docker npx; do
  if ! command -v "$bin" >/dev/null 2>&1; then
    echo "[$(date -uIs)] $SLUG: ABORT — '$bin' not found on PATH ($PATH)" >> "$RUN_LOG"
    exit 1
  fi
done

# ── budget gate: never spend extra-usage credits ─────────────────────────────
# The plan's weekly cap is NOT a hard stop. Once `seven_day` hits 100%, requests
# keep succeeding and bill against pay-as-you-go extra-usage credits (real dollars)
# — round 530 promoted 12/12 at 100% weekly utilization without any error. So the
# only thing standing between an hourly cron and an unbounded credit bill is this
# check.
#
# Fail CLOSED: an unreachable/expired-token usage endpoint skips the round. A
# missed round costs an hour of throughput; a wrong guess costs money.
#
# ORACLE_MAX_UTILIZATION (default 95) is deliberately below 100. A round takes
# ~30 min, so starting at 99% would cross the cap mid-manifest and finish on
# credits — the gate can only refuse to *start*, it cannot stop a round in flight.
# The last ~5% of plan budget is the price of that coarseness. Set it to 100 to
# spend the plan out fully and accept some credit spillover, or to 0 to park the
# cron entirely without touching the crontab.
MAX_UTIL="${ORACLE_MAX_UTILIZATION:-95}"
BUDGET=$(python3 - "$MAX_UTIL" <<'PY' 2>&1 || true
import json, os, sys, urllib.request

max_util = float(sys.argv[1])
try:
    creds = json.load(open(os.path.expanduser("~/.claude/.credentials.json")))
    token = creds["claudeAiOauth"]["accessToken"]
    req = urllib.request.Request(
        "https://api.anthropic.com/api/oauth/usage",
        headers={"Authorization": f"Bearer {token}",
                 "anthropic-beta": "oauth-2025-04-20"},
    )
    data = json.load(urllib.request.urlopen(req, timeout=20))
except Exception as exc:                      # network, 401, malformed creds
    print(f"BLOCK usage endpoint unreadable ({type(exc).__name__}: {exc})")
    raise SystemExit(0)

# `limits[]` is the authoritative list — it names every active cap (session,
# weekly_all, per-model weekly_scoped) with a normalized percent. The legacy
# five_hour/seven_day objects are kept as a fallback for older payload shapes.
worst, pcts = None, []
for lim in data.get("limits") or []:
    if not lim.get("is_active"):
        continue
    pct = lim.get("percent")
    if pct is None:
        continue
    pcts.append(f"{lim.get('kind', '?')}={pct:g}%")
    if worst is None or pct > worst[1]:
        worst = (lim.get("kind", "?"), float(pct))

if worst is None:                              # no limits[] — fall back
    for key in ("five_hour", "seven_day"):
        obj = data.get(key) or {}
        pct = obj.get("utilization")
        if pct is None:
            continue
        pcts.append(f"{key}={pct:g}%")
        if worst is None or pct > worst[1]:
            worst = (key, float(pct))

if worst is None:
    print("BLOCK usage payload carried no readable limit")
    raise SystemExit(0)

kind, pct = worst
summary = " ".join(pcts)
if pct >= max_util:
    resets = ""
    for lim in data.get("limits") or []:
        if lim.get("kind") == kind and lim.get("resets_at"):
            resets = f", resets {lim['resets_at']}"
    print(f"BLOCK {kind} at {pct:g}% >= {max_util:g}% [{summary}]{resets}")
else:
    print(f"OK [{summary}] under {max_util:g}%")
PY
)
if [[ "$BUDGET" != OK* ]]; then
  echo "[$(date -uIs)] $SLUG: SKIP — ${BUDGET#BLOCK }" >> "$RUN_LOG"
  exit 0
fi

# ── preflight the manifest ───────────────────────────────────────────────────
# Script-ahead-of-manifest drift makes the planner under-report stale rows, so an
# unattended round would quietly enrich the wrong set. Read-only; exits non-zero on drift.
if ! "$REPO_ROOT/server/scripts/backfill/run-prod.sh" \
      scripts/backfill/check-manifest-sync.js >> "$RUN_LOG" 2>&1; then
  echo "[$(date -uIs)] $SLUG: ABORT — manifest/SCRIPT_VERSION drift. Fix before running." >> "$RUN_LOG"
  exit 1
fi

# DRY_RUN=1 verifies a cron install end-to-end — lock, shard parsing, manifest
# preflight, per-worker paths — WITHOUT starting a session or writing to prod.
if [[ -n "${DRY_RUN:-}" ]]; then
  echo "DRY_RUN $SLUG: preflight passed; would start a round with"
  echo "  shard      : ${SHARD:-<none>}"
  echo "  prompts    : ${BACKFILL_ORACLE_PROMPTS:-<default>}"
  echo "  answers    : ${BACKFILL_ORACLE_ANSWERS:-<default>}"
  echo "  resume     : $ORACLE_RESUME_FILE"
  echo "  notes      : $ORACLE_NOTES_FILE"
  echo "  lock       : $LOCK"
  echo "  log        : $RUN_LOG"
  echo "  budget     : $BUDGET (gate ${ORACLE_MAX_UTILIZATION:-95}%)"
  exit 0
fi

echo "[$(date -uIs)] $SLUG: starting oracle round" >> "$RUN_LOG"

# ── run the round ────────────────────────────────────────────────────────────
# --permission-mode bypassPermissions: cron has no TTY to approve tool calls, and the
# skill is explicitly written for autonomous operation ("Do not confirm the word batch
# with the user"). The pipeline's own guardrails are what hold here: validators must
# pass, validatedClause protects human-reviewed fields, promote-discoverable re-asserts
# the completeness bar inside its UPDATE, and backup-det.sh dumps det every round.
cd "$REPO_ROOT"
claude -p "/oracle-backfill

Autonomous cron round ($SLUG). $SHARD_INSTRUCTION
Write any parked-run state to $ORACLE_RESUME_FILE and run notes to $ORACLE_NOTES_FILE
instead of the skill's default paths — a parallel worker owns those.
Stop cleanly at the end of one round; do not start a second." \
  --permission-mode bypassPermissions \
  >> "$RUN_LOG" 2>&1 || RC=$?
RC=${RC:-0}

# `|| RC=$?` rather than a bare call: under `set -e` a failing round (budget
# exhausted, session error) would abort the script here and never record WHY.
# A failed round is safe to retry — incomplete rows simply stay discoverable=FALSE
# and the flock releases on exit — but the log has to say it happened.
echo "[$(date -uIs)] $SLUG: round finished (exit $RC)" >> "$RUN_LOG"
exit "$RC"
