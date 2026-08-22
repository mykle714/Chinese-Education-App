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
