#!/usr/bin/env bash
#
# Unattended launcher for /oracle-backfill.
#
# LAYER: data-enrichment (backfill) invocation shim — the cron-side sibling of
# run-ppe.sh (which shims a single script; this shims a whole round).
#
# WHY THIS EXISTS: the oracle answerer is a Claude session, not a headless process
# (server/scripts/backfill/run-log.js, "ORACLE MODE" — the export/apply phases bracket
# a model authoring answers into oracle-answers.jsonl). So "keep the backfill running"
# cannot be a plain `node foo.js` cron entry; it has to start a `claude -p` session.
# It also cannot be a CLOUD scheduled agent: run-ppe.sh reaches the DB at
# 127.0.0.1:5432, which cow-postgres publishes on loopback only.
#
# CONCURRENCY: every invocation takes an exclusive, non-blocking flock. A round that
# overruns its tick simply causes the next tick to exit 0 without starting a second
# session — the lock, not the schedule, is what guarantees one worker per shard.
#
# Note the throughput cost: a dropped tick is DROPPED, not queued, so a round running
# 61 minutes costs the whole following hour. Solo throughput is therefore capped at
# one round per hour and falls off sharply once the median round approaches 60 min.
# Measure it before assuming the account budget is what limits enrichment: sum the
# start/finish pairs in the run log for a duty cycle, and compare against `seven_day`
# utilization at the end of the week (see .claude/commands/oracle-backfill.md §6b).
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
#   ORACLE_LANGS=zh oracle-cron.sh # restrict the round to one language (default: both)
#   DRY_RUN=1 SHARD=0/3 oracle-cron.sh   # verify wiring; no session, no PPE writes
#
# BUDGET
#   A round is skipped (exit 0) when any active plan cap is at or above ITS OWN
#   threshold. The two caps are gated separately because they fail in different
#   currencies (see the budget gate below):
#     ORACLE_MAX_UTILIZATION         (default 75%) — the weekly caps. Spend past the
#       weekly cap silently bills extra-usage credits rather than erroring, so the
#       gate keeps a wide margin.
#     ORACLE_MAX_UTILIZATION_SESSION (default 99%) — the five-hour window. Overrunning
#       it only gets requests refused until the window resets, so a solo backfill may
#       run it to the edge.
#   Either set to 0 parks the cron without editing the crontab.
#   ORACLE_GATE_FAIL_ESCALATE (default 3) is how many CONSECUTIVE unexpected gate
#   failures (stale credential, unreachable endpoint) it takes before the script
#   complains on stderr. At-the-cap skips are not failures and never count.
#   ORACLE_TOKEN_MIN_TTL (default 600s) is how much life the on-disk OAuth token must
#   have left before the gate will use it; below that it is refreshed first.
#
#   A capped round then SLEEPS to that cap's reset (oracle-park-until.$SLUG) rather
#   than re-reading usage every tick — see PARK-UNTIL below. Delete that file to force
#   an early re-read; changing either threshold discards it automatically.
#
# CRONTAB (hourly; the lock makes over-scheduling harmless)
#   PATH=/home/michael/.nvm/versions/node/v22.22.0/bin:/usr/local/bin:/usr/bin:/bin
#   0 * * * * SHARD=0/3 /home/michael/vocabulary-app/server/scripts/backfill/oracle-cron.sh
#   0 * * * * SHARD=1/3 /home/michael/vocabulary-app/server/scripts/backfill/oracle-cron.sh
#   0 * * * * SHARD=2/3 /home/michael/vocabulary-app/server/scripts/backfill/oracle-cron.sh
#
# DISCORD STATUS PINGS (optional)
#   Set DISCORD_WEBHOOK_URL in the repo-root .env (same file that carries
#   POSTGRES_PASSWORD; gitignored). Empty/unset = no-op, script behavior is
#   otherwise identical. Notifies on: parked (budget cap/auth/error — only on the
#   transition in and out, not every tick while parked), manifest-drift abort,
#   missing-binary abort, gate-failure escalation, and every round finishing
#   (with its exit code and any new server/logs/oracle-concerns.md lines).
#
# Referenced by: .claude/commands/oracle-backfill.md
set -euo pipefail

REPO_ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/../../.." && pwd)"
LOG_DIR="$REPO_ROOT/server/logs"
mkdir -p "$LOG_DIR"

# ── Discord status updates ───────────────────────────────────────────────────
# DISCORD_WEBHOOK_URL lives in the repo-root .env (same file run-ppe.sh sources
# for POSTGRES_PASSWORD) so it stays out of git and off the process's argv/ps
# listing. Optional: an unset/empty URL makes discord_notify() a silent no-op,
# so this script works identically before the webhook is configured.
if [[ -f "$REPO_ROOT/.env" ]]; then
  set -a; . "$REPO_ROOT/.env"; set +a
fi

# The .env also carries ANTHROPIC_API_KEY for the direct-SDK backfill scripts
# (backfill-icons.js etc.) — but `claude -p` below prefers an API key over the
# OAuth subscription session whenever both are present, so sourcing it here would
# silently bill this hourly round against pay-as-you-go API usage instead of the
# subscription the budget gate below is actually checking. Unset it for this
# process only; the other scripts still get it by sourcing .env themselves.
unset ANTHROPIC_API_KEY

# discord_notify <message>: best-effort POST to the webhook. A short timeout plus
# a swallowed exit code mean a Discord outage or bad URL never fails or hangs a
# backfill round — this is a side channel, not part of the pipeline's guarantees.
discord_notify() {
  [[ -n "${DISCORD_WEBHOOK_URL:-}" ]] || return 0
  local msg="$1"
  curl -sS -m 10 -X POST "$DISCORD_WEBHOOK_URL" \
    -H "Content-Type: application/json" \
    -d "$(python3 -c 'import json,sys; print(json.dumps({"content": sys.argv[1][:1900]}))' "$msg")" \
    >/dev/null 2>&1 || true
}

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

# ── language restriction (optional) ─────────────────────────────────────────
# ORACLE_LANGS, if set, is a comma-separated subset of {zh,es} — e.g. "zh" to pause
# es on this worker without touching the skill's default (both languages) or any
# other worker's crontab line. Empty/unset = unrestricted, the historical behavior.
ORACLE_LANGS="${ORACLE_LANGS:-}"
if [[ -n "$ORACLE_LANGS" ]]; then
  LANG_INSTRUCTION="Restrict this round to language(s): $ORACLE_LANGS only — do not select or work any other language's scope (§3/§3b/§4), even if that language's backlog is nonempty."
else
  LANG_INSTRUCTION=""
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
# "command not found" buried in a round that already took a PPE backup.
for bin in claude flock docker npx; do
  if ! command -v "$bin" >/dev/null 2>&1; then
    echo "[$(date -uIs)] $SLUG: ABORT — '$bin' not found on PATH ($PATH)" >> "$RUN_LOG"
    discord_notify "🔴 oracle-cron ($SLUG) ABORT: '$bin' not found on PATH"
    exit 1
  fi
done

# LAST_STATUS_FILE tracks the last *notified* skip/park reason so a multi-hour
# CAP park doesn't ping Discord every single tick — only the transition into and
# out of a parked state is a status change worth a message.
LAST_STATUS_FILE="$LOG_DIR/oracle-last-status.$SLUG"

# ── budget gate: never spend extra-usage credits ─────────────────────────────
# The plan's weekly cap is NOT a hard stop. Once `seven_day` hits 100%, requests
# keep succeeding and bill against pay-as-you-go extra-usage credits (real dollars)
# — round 530 promoted 12/12 at 100% weekly utilization without any error. So the
# only thing standing between an hourly cron and an unbounded credit bill is this
# check.
#
# Fail CLOSED: an unreadable usage endpoint skips the round. A missed round costs an
# hour of throughput; a wrong guess costs money. The ONE exception is an expired access
# token (HTTP 401), which is retried once after a forced refresh — see TOKEN FRESHNESS
# below. Failing closed on that was costing whole days of throughput for no budget
# reason at all.
#
# THE THRESHOLD IS PER CAP GROUP, because the two caps fail in completely different
# currencies:
#
#   weekly  (weekly_all, weekly_scoped) — ORACLE_MAX_UTILIZATION, default 75.
#     Overrunning this costs REAL DOLLARS: requests past 100% keep succeeding and bill
#     against pay-as-you-go extra-usage credits. A round takes ~30 min, so starting at
#     99% would cross the cap mid-manifest and finish on credits — the gate can only
#     refuse to *start*, it cannot stop a round in flight. Hence a wide margin.
#     Lowered from the original 95 default on 2026-08-28.
#
#   session (the five-hour window)      — ORACLE_MAX_UTILIZATION_SESSION, default 99.
#     Overrunning this costs only THROUGHPUT: at the five-hour boundary requests are
#     genuinely refused, and the window resets on its own a few hours later. There is
#     no credit spillover to protect against, so holding the session window back to 75%
#     was pure waste — a solo backfill may run it right to the edge. Raised to 99 on
#     2026-08-28.
#
# Either variable set to 100 spends its cap out fully and accepts the consequences
# (credit spillover on weekly; a mid-round refusal wall on session); either set to 0
# parks the cron entirely without touching the crontab.
# TOKEN FRESHNESS: the usage endpoint is authenticated with the OAuth access token
# that Claude Code keeps in ~/.claude/.credentials.json. That token has a ~8h TTL and
# is refreshed ONLY by a live Claude Code session — nothing on a quiet PPE box
# refreshes it on a schedule. So a passive read of that file eventually sends an
# expired bearer token and gets a 401, and because the gate fails closed that 401
# silently parked the cron for hours at a time (8 of 52 ticks over 2026-08-22..24,
# while the plan had budget to spare). A 401 is therefore treated as SELF-HEALABLE
# rather than as a budget signal: we spend one trivial `claude -p` turn to make Claude
# Code refresh the credential through its own supported path, then re-read usage once.
#
# 429 IS THE SAME FAILURE WEARING A DIFFERENT STATUS CODE. This script is the only
# caller of the usage endpoint in the repo, and it calls it at most twice an hour, so a
# genuine volume rate limit is implausible. What actually produces a 429 here is
# repeated *auth failure* after the access token lapses. On 2026-09-18 both shards took
# a 401, failed their refresh probe, and then got 429 on every tick for nine hours — a
# stretch that ended the instant an interactive session refreshed the credential. 429 is
# therefore classified RETRY alongside 401 rather than as an opaque ERR, which is what
# had been suppressing the self-heal path (ERR does not probe).
#
# Better still, do not wait for the failure: ORACLE_TOKEN_MIN_TTL (default 600s) makes
# the gate read `expiresAt` out of the credentials file FIRST and refresh pre-emptively
# when the token is expired or about to be. That matters more now that a capped round
# sleeps to its reset (see PARK-UNTIL): a two-day weekly park guarantees the token is
# stale by the time the cron wakes, so without a proactive refresh every park would end
# in a wasted 401/429 tick.
#
# PARK-UNTIL: a cap verdict carries the binding cap's `resets_at`, and both cap groups
# are fixed windows rather than rolling ones — so once a cap parks the round there is
# nothing a subsequent read can discover before that timestamp. The reset epoch is
# stamped into oracle-park-until.$SLUG and every tick before it exits 0 with no network
# call at all. A weekly park is ~50 ticks, i.e. ~50 pointless authenticated reads that
# can only cost throttle headroom. The stamp also records the thresholds it was written
# under, so raising/lowering ORACLE_MAX_UTILIZATION* discards the park immediately
# instead of leaving the operator's change inert until the reset.
#
# We deliberately do NOT perform the OAuth refresh grant here. That would mean writing
# ~/.claude/.credentials.json by hand while a real session may be writing it too, and
# refresh tokens rotate on use — losing that race on the PPE machine logs the box out
# of Claude entirely. A throughput bug does not justify that blast radius.
#
# Known hole: if the plan is genuinely exhausted, the refresh probe is itself a real
# (tiny) request and bills a handful of tokens to credits. Accepted — the gate exists
# to stop a ~30-minute round, not single tokens — but it does mean the
# "never spend credits" invariant is approximate rather than absolute.
#
# ESCALATION: a fail-closed gate is silent by construction, which is exactly how the
# 401 block went unnoticed for hours. Unexpected failures (auth, unreachable,
# malformed payload) increment a counter and shout on stderr once it reaches
# ORACLE_GATE_FAIL_ESCALATE (default 3). An at-the-cap skip is NOT counted, because
# the weekly cap can legitimately hold the cron down for most of a day.
MAX_UTIL="${ORACLE_MAX_UTILIZATION:-75}"                 # weekly caps (dollars)
MAX_UTIL_SESSION="${ORACLE_MAX_UTILIZATION_SESSION:-99}" # five-hour window (throughput only)
GATE_FAIL_STATE="$LOG_DIR/oracle-gate-failures.$SLUG"
GATE_FAIL_ESCALATE="${ORACLE_GATE_FAIL_ESCALATE:-3}"
PARK_FILE="$LOG_DIR/oracle-park-until.$SLUG"
# The thresholds a park was written under. A park is only honoured while they still
# hold, so an operator retuning either cap takes effect on the next tick.
PARK_GATES_NOW="$MAX_UTIL/$MAX_UTIL_SESSION"

# ── park-until: skip ticks that cannot learn anything new ────────────────────
# Both cap groups are fixed windows, so between a cap verdict and its `resets_at`
# there is no reading to be had — the percentage cannot fall. Exit before the network
# call rather than re-asking ~50 times across a weekly park. See PARK-UNTIL above.
if [[ -s "$PARK_FILE" ]]; then
  IFS=$'\t' read -r PARK_EPOCH PARK_GATES PARK_REASON < "$PARK_FILE" || true
  NOW_EPOCH="$(date +%s)"
  if [[ "$PARK_GATES" != "$PARK_GATES_NOW" ]]; then
    echo "[$(date -uIs)] $SLUG: park discarded — thresholds changed ($PARK_GATES → $PARK_GATES_NOW)" >> "$RUN_LOG"
    rm -f "$PARK_FILE"
  elif [[ "$PARK_EPOCH" =~ ^[0-9]+$ ]] && (( NOW_EPOCH < PARK_EPOCH )); then
    echo "[$(date -uIs)] $SLUG: SKIP — parked until $(date -uIs -d "@$PARK_EPOCH") ($PARK_REASON)" >> "$RUN_LOG"
    exit 0
  else
    echo "[$(date -uIs)] $SLUG: park expired — re-reading usage" >> "$RUN_LOG"
    rm -f "$PARK_FILE"
  fi
fi

# park_until <epoch> <reason>: stamp the park, with sanity bounds. A reset already in
# the past (clock skew, or a cap still reading high just after its window rolled) and
# an implausibly distant one are both ignored — the tick simply falls back to the
# historical behaviour of re-reading next hour rather than sleeping on a bad number.
park_until() {
  local epoch="$1" reason="$2" now
  now="$(date +%s)"
  [[ "$epoch" =~ ^[0-9]+$ ]] || return 0
  (( epoch > now )) || return 0
  (( epoch <= now + 8 * 86400 )) || return 0   # nothing legitimately parks past a week
  printf '%s\t%s\t%s\n' "$epoch" "$PARK_GATES_NOW" "$reason" > "$PARK_FILE"
  echo "[$(date -uIs)] $SLUG: parking until $(date -uIs -d "@$epoch") — no further usage reads before then" >> "$RUN_LOG"
}

# refresh_credential <why>: spend one trivial `claude -p` turn so Claude Code refreshes
# ~/.claude/.credentials.json through its own supported path. Default permission mode
# on purpose (NOT bypassPermissions like the round below) — cron has no TTY, so the
# probe cannot take a tool action even if the model tried to. haiku keeps it cheap.
# The probe's output goes to RUN_LOG rather than /dev/null: when this fails it is the
# only evidence of WHY, and discarding it is what made the 2026-09-18 lockout opaque.
refresh_credential() {
  echo "[$(date -uIs)] $SLUG: refreshing OAuth credential ($1)" >> "$RUN_LOG"
  timeout 120 claude -p 'Reply with the single word: ok' --model haiku >> "$RUN_LOG" 2>&1
}

# token_fresh_for <seconds>: succeeds when the on-disk access token is still valid that
# far ahead. Purely a local file read — no network, no cost. An unreadable or
# shapeless credentials file counts as NOT fresh so the probe runs and produces a real
# diagnostic, rather than letting the gate discover it as an opaque HTTP failure.
token_fresh_for() {
  python3 - "$1" <<'PY'
import json, os, sys, time
try:
    creds = json.load(open(os.path.expanduser("~/.claude/.credentials.json")))
    expires_at = float(creds["claudeAiOauth"]["expiresAt"]) / 1000.0
except Exception:
    raise SystemExit(1)
raise SystemExit(0 if expires_at - time.time() >= float(sys.argv[1]) else 1)
PY
}

# read_usage: echoes exactly one classified verdict line.
#   OK    <summary>  — under the cap, safe to start a round
#   CAP   <detail>   — at/over the cap; the gate working as designed. Carries the
#                      binding cap's reset as `(resets_epoch=<unix>)` for PARK-UNTIL.
#   RETRY <detail>   — HTTP 401 or 429, i.e. the on-disk access token is stale and a
#                      refresh probe is worth one turn (see TOKEN FRESHNESS above)
#   ERR   <detail>   — unreachable, malformed creds, or unreadable payload
# CAP/ERR reasons keep their historical wording so existing log greps still match.
read_usage() {
  python3 - "$MAX_UTIL" "$MAX_UTIL_SESSION" <<'PY' 2>&1 || true
import datetime, json, os, sys, urllib.error, urllib.request

max_util_weekly  = float(sys.argv[1])
max_util_session = float(sys.argv[2])

# Which threshold governs a given cap. A cap we do not recognise is billed at the
# WEEKLY (conservative) threshold on purpose: an unknown limit might be one that
# spills onto credits, and the cheap mistake is skipping a round.
def threshold_for(group, kind):
    if (group or kind or "").startswith("session"):
        return max_util_session
    return max_util_weekly

try:
    creds = json.load(open(os.path.expanduser("~/.claude/.credentials.json")))
    token = creds["claudeAiOauth"]["accessToken"]
    req = urllib.request.Request(
        "https://api.anthropic.com/api/oauth/usage",
        headers={"Authorization": f"Bearer {token}",
                 "anthropic-beta": "oauth-2025-04-20"},
    )
    data = json.load(urllib.request.urlopen(req, timeout=20))
# HTTPError is caught before Exception on purpose: 401/429 are a stale credential the
# caller can fix by forcing a refresh, whereas a timeout or malformed payload is not
# worth retrying and must stay a hard skip. 429 sits with 401 rather than with the
# other HTTP failures because at two calls an hour it cannot be a volume limit — see
# the TOKEN FRESHNESS comment for the 2026-09-18 nine-hour lockout it caused.
except urllib.error.HTTPError as exc:
    if exc.code in (401, 429):
        # A Retry-After, when the server sends one, bounds how long the caller should
        # wait if even the post-refresh read is still refused.
        retry_after = (exc.headers.get("Retry-After") or "").strip()
        hint = f" (retry_after={retry_after})" if retry_after.isdigit() else ""
        print(f"RETRY access token rejected (HTTP {exc.code} {exc.reason}) — stale credential{hint}")
    else:
        print(f"ERR usage endpoint unreadable (HTTP {exc.code}: {exc.reason})")
    raise SystemExit(0)
except Exception as exc:                      # network, malformed creds
    print(f"ERR usage endpoint unreadable ({type(exc).__name__}: {exc})")
    raise SystemExit(0)

# `limits[]` is the authoritative list — it names every active cap (session,
# weekly_all, per-model weekly_scoped) with a normalized percent. The legacy
# five_hour/seven_day objects are kept as a fallback for older payload shapes.
# Each cap is measured against ITS OWN threshold, so a five-hour window at 90% no
# longer parks the cron on the weekly cap's margin.
caps, pcts = [], []                            # caps: (kind, pct, threshold)
for lim in data.get("limits") or []:
    if not lim.get("is_active"):
        continue
    pct = lim.get("percent")
    if pct is None:
        continue
    kind = lim.get("kind", "?")
    pcts.append(f"{kind}={pct:g}%")
    caps.append((kind, float(pct), threshold_for(lim.get("group"), kind)))

if not caps:                                   # no limits[] — fall back
    for key, group in (("five_hour", "session"), ("seven_day", "weekly")):
        obj = data.get(key) or {}
        pct = obj.get("utilization")
        if pct is None:
            continue
        pcts.append(f"{key}={pct:g}%")
        caps.append((key, float(pct), threshold_for(group, key)))

if not caps:
    print("ERR usage payload carried no readable limit")
    raise SystemExit(0)

summary = " ".join(pcts)
gates = f"session {max_util_session:g}% / weekly {max_util_weekly:g}%"
# The binding cap is the one furthest past (or closest to) its own threshold — a
# plain max() over percent would let a lenient session reading mask a weekly one.
kind, pct, thresh = max(caps, key=lambda c: c[1] - c[2])
if pct >= thresh:
    # The binding cap's reset drives PARK-UNTIL, so look it up in whichever shape the
    # payload used: `limits[]` keys on `kind`, while the legacy fallback's `kind` IS
    # the top-level key ("five_hour"/"seven_day"). The old code only searched
    # `limits[]`, so a fallback payload silently parked without a reset timestamp.
    resets_at = ""
    for lim in data.get("limits") or []:
        if lim.get("kind") == kind and lim.get("resets_at"):
            resets_at = lim["resets_at"]
    if not resets_at:
        resets_at = (data.get(kind) or {}).get("resets_at") or ""
    resets = f", resets {resets_at}" if resets_at else ""
    # Emitted as a trailing machine-readable field rather than by reformatting the
    # line, so the caller can regex it out while existing log greps keep matching.
    epoch = ""
    if resets_at:
        try:
            epoch = f" (resets_epoch={int(datetime.datetime.fromisoformat(resets_at).timestamp())})"
        except ValueError:
            epoch = ""
    print(f"CAP {kind} at {pct:g}% >= {thresh:g}% [{summary}]{resets}{epoch}")
else:
    print(f"OK [{summary}] under {gates}")
PY
}

# Refresh BEFORE the read when the token is already expired or nearly so. Cheaper than
# discovering it as a 401/429, and it is what keeps a multi-day park from waking up
# into a stale credential.
TOKEN_MIN_TTL="${ORACLE_TOKEN_MIN_TTL:-600}"
if ! token_fresh_for "$TOKEN_MIN_TTL"; then
  refresh_credential "access token expired or within ${TOKEN_MIN_TTL}s of expiry" || true
fi

BUDGET="$(read_usage)"

# One retry, and only for 401/429 — both of which mean "this credential is stale".
# The probe's job is purely to make Claude Code notice and refresh it; the reply is
# discarded. A still-rejected read after the refresh is a real problem (revoked login,
# or an actual throttle), so it degrades to ERR and, when the server named a
# Retry-After, parks for that long instead of re-probing every tick.
if [[ "$BUDGET" == RETRY* ]]; then
  echo "[$(date -uIs)] $SLUG: usage read rejected (${BUDGET#RETRY }) — forcing a token refresh" >> "$RUN_LOG"
  if refresh_credential "usage read rejected"; then
    RETRY_HINT="$BUDGET"
    BUDGET="$(read_usage)"
    if [[ "$BUDGET" == OK* ]]; then
      echo "[$(date -uIs)] $SLUG: token refreshed; usage readable again" >> "$RUN_LOG"
    elif [[ "$BUDGET" == RETRY* ]]; then
      if [[ "$RETRY_HINT" =~ retry_after=([0-9]+) ]]; then
        park_until "$(( $(date +%s) + BASH_REMATCH[1] ))" "usage endpoint throttled (Retry-After)"
      fi
      BUDGET="ERR usage read still rejected after a token refresh (${BUDGET#RETRY })"
    fi
  else
    BUDGET="ERR token refresh probe failed — credential likely needs an interactive 'claude auth login'"
  fi
fi

if [[ "$BUDGET" != OK* ]]; then
  # Strip whichever verdict prefix is present so the log keeps its historical
  # "SKIP — <reason>" shape.
  REASON="${BUDGET#CAP }"; REASON="${REASON#RETRY }"; REASON="${REASON#ERR }"
  echo "[$(date -uIs)] $SLUG: SKIP — $REASON" >> "$RUN_LOG"

  # Only ping Discord on the transition INTO a parked state, not every tick
  # while parked — a multi-hour CAP park would otherwise spam a message per hour.
  if [[ "$(cat "$LAST_STATUS_FILE" 2>/dev/null || true)" != "$BUDGET" ]]; then
    echo "$BUDGET" > "$LAST_STATUS_FILE"
    discord_notify "⏸️ oracle-cron ($SLUG) parked: $REASON"
  fi

  if [[ "$BUDGET" == CAP* ]]; then
    # Being at the cap is the gate succeeding, not failing — clear any failure streak.
    rm -f "$GATE_FAIL_STATE"
    # Sleep to the binding cap's reset instead of re-asking hourly. Absent an epoch
    # (an older payload shape, or an unparseable timestamp) this is a no-op and the
    # next tick reads usage as before.
    if [[ "$BUDGET" =~ resets_epoch=([0-9]+) ]]; then
      park_until "${BASH_REMATCH[1]}" "$REASON"
    fi
  else
    FAILS=$(( $(cat "$GATE_FAIL_STATE" 2>/dev/null || echo 0) + 1 ))
    echo "$FAILS" > "$GATE_FAIL_STATE"
    if (( FAILS >= GATE_FAIL_ESCALATE )); then
      # stderr so cron surfaces it (mail/journal) instead of burying it in RUN_LOG.
      echo "⚠️  oracle-cron ($SLUG): budget gate has failed $FAILS ticks in a row — the backfill is parked and is NOT budget-limited. Last: $REASON" >&2
      echo "[$(date -uIs)] $SLUG: ⚠️ ESCALATION — $FAILS consecutive gate failures" >> "$RUN_LOG"
      discord_notify "🔴 oracle-cron ($SLUG): budget gate has failed $FAILS ticks in a row — parked, and NOT actually budget-limited. Last: $REASON"
    fi
  fi
  exit 0
fi
# A usable reading means any failure streak is over. If we were parked, this
# tick is the resume transition — worth its own ping.
rm -f "$GATE_FAIL_STATE"
if [[ -s "$LAST_STATUS_FILE" ]]; then
  discord_notify "▶️ oracle-cron ($SLUG) resumed (was parked: $(cat "$LAST_STATUS_FILE"))"
  rm -f "$LAST_STATUS_FILE"
fi

# ── preflight the manifest ───────────────────────────────────────────────────
# Script-ahead-of-manifest drift makes the planner under-report stale rows, so an
# unattended round would quietly enrich the wrong set. Read-only; exits non-zero on drift.
if ! "$REPO_ROOT/server/scripts/backfill/run-ppe.sh" \
      scripts/backfill/check-manifest-sync.js >> "$RUN_LOG" 2>&1; then
  echo "[$(date -uIs)] $SLUG: ABORT — manifest/SCRIPT_VERSION drift. Fix before running." >> "$RUN_LOG"
  discord_notify "🔴 oracle-cron ($SLUG) ABORT: manifest/SCRIPT_VERSION drift — a script is ahead of its manifest entry. Fix before the next tick."
  exit 1
fi

# DRY_RUN=1 verifies a cron install end-to-end — lock, shard parsing, manifest
# preflight, per-worker paths — WITHOUT starting a session or writing to PPE.
if [[ -n "${DRY_RUN:-}" ]]; then
  echo "DRY_RUN $SLUG: preflight passed; would start a round with"
  echo "  shard      : ${SHARD:-<none>}"
  echo "  langs      : ${ORACLE_LANGS:-<unrestricted>}"
  echo "  prompts    : ${BACKFILL_ORACLE_PROMPTS:-<default>}"
  echo "  answers    : ${BACKFILL_ORACLE_ANSWERS:-<default>}"
  echo "  resume     : $ORACLE_RESUME_FILE"
  echo "  notes      : $ORACLE_NOTES_FILE"
  echo "  lock       : $LOCK"
  echo "  log        : $RUN_LOG"
  echo "  budget     : $BUDGET (gates: session ${MAX_UTIL_SESSION}% / weekly ${MAX_UTIL}%)"
  echo "  token ttl  : $(token_fresh_for "$TOKEN_MIN_TTL" && echo "fresh (>${TOKEN_MIN_TTL}s)" || echo "stale/expiring — would refresh first")"
  echo "  park file  : $PARK_FILE $( [[ -s "$PARK_FILE" ]] && echo "(active)" || echo "(none)" )"
  exit 0
fi

ROUND_START="$(date -uIs)"
echo "[$ROUND_START] $SLUG: starting oracle round" >> "$RUN_LOG"

# Snapshot the concerns log's line count so the finish notification can report
# only what THIS round dropped (§3c of the skill), not the file's whole history.
CONCERNS_FILE="$LOG_DIR/oracle-concerns.md"
CONCERNS_BEFORE=$(wc -l < "$CONCERNS_FILE" 2>/dev/null || echo 0)

# ── run the round ────────────────────────────────────────────────────────────
# --permission-mode bypassPermissions: cron has no TTY to approve tool calls, and the
# skill is explicitly written for autonomous operation ("Do not confirm the word batch
# with the user"). The pipeline's own guardrails are what hold here: validators must
# pass, validatedClause protects human-reviewed fields, promote-discoverable re-asserts
# the completeness bar inside its UPDATE, and backup-det.sh dumps det every round.
cd "$REPO_ROOT"
claude -p "/oracle-backfill

Autonomous cron round ($SLUG). $SHARD_INSTRUCTION
${LANG_INSTRUCTION:+$LANG_INSTRUCTION
}Write any parked-run state to $ORACLE_RESUME_FILE and run notes to $ORACLE_NOTES_FILE
instead of the skill's default paths — a parallel worker owns those.
Stop cleanly at the end of one round; do not start a second. A round ends ONLY where
skill section 6c says it does: the planner re-run over this batch's own word list
returns 0 prompts across 0 scripts, or a budget cap parked you (write the resume note
first), or a section 6 guardrail tripped. A clean 'Updated: N' apply is not
convergence — it usually creates the next link's work." \
  --permission-mode bypassPermissions \
  >> "$RUN_LOG" 2>&1 || RC=$?
RC=${RC:-0}

# `|| RC=$?` rather than a bare call: under `set -e` a failing round (budget
# exhausted, session error) would abort the script here and never record WHY.
# A failed round is safe to retry — incomplete rows simply stay discoverable=FALSE
# and the flock releases on exit — but the log has to say it happened.
echo "[$(date -uIs)] $SLUG: round finished (exit $RC)" >> "$RUN_LOG"

# New oracle-concerns.md lines (§3c drops: slurs / explicit-sexual content) since
# this round started, quoted in full so a status ping is enough to review them
# without opening the file — capped so one pathological round can't flood Discord.
CONCERNS_AFTER=$(wc -l < "$CONCERNS_FILE" 2>/dev/null || echo 0)
CONCERNS_NEW=""
if (( CONCERNS_AFTER > CONCERNS_BEFORE )); then
  CONCERNS_NEW=$(tail -n "$((CONCERNS_AFTER - CONCERNS_BEFORE))" "$CONCERNS_FILE" | head -10)
fi

# Per-word clustering-backfill results written THIS round (both languages), read
# straight from the DB rather than parsed out of the session's own prose — the
# `enrichmentLog` timestamp is the authoritative "did cluster-definitions touch
# this row" signal (see the skill's §5 validatedClause check for the same pattern).
# 127.0.0.1: the host cannot resolve the docker-network hostname "postgres" that
# $DB_HOST holds after sourcing .env — same override run-ppe.sh applies.
CLUSTER_RESULTS=""
if [[ -n "${POSTGRES_PASSWORD:-}" ]] && command -v psql >/dev/null 2>&1; then
  CLUSTER_RESULTS=$(PGPASSWORD="$POSTGRES_PASSWORD" psql -h 127.0.0.1 -p 5432 \
      -U "${DB_USER:-cow_user}" -d "${DB_NAME:-cow_db}" -qtA -F$'\t' -c "
    SELECT word1, \"definitionClusters\"::text
      FROM dictionaryentries_zh
     WHERE language = 'zh'
       AND (\"enrichmentLog\" #>> '{chinese/backfill-cluster-definitions,ranAt}')::timestamptz >= '${ROUND_START}'::timestamptz
    UNION ALL
    SELECT word1, \"definitionClusters\"::text
      FROM dictionaryentries_es
     WHERE language = 'es'
       AND (\"enrichmentLog\" #>> '{spanish/backfill-cluster-definitions,ranAt}')::timestamptz >= '${ROUND_START}'::timestamptz
    ORDER BY 1
  " 2>>"$RUN_LOG" | python3 -c '
import sys, json
lines = []
for row in sys.stdin:
    row = row.rstrip("\n")
    if not row:
        continue
    word, clusters_json = row.split("\t", 1)
    try:
        clusters = json.loads(clusters_json) if clusters_json else []
    except (json.JSONDecodeError, TypeError):
        continue
    senses = "; ".join(
        f"[{c.get("reading", "?")}] {c.get("sense", "?")} (v={c.get("frequencyScore", "?")})"
        for c in clusters
    )
    lines.append(f"{word}: {senses}" if senses else f"{word}: (no clusters)")
print("\n".join(lines[:8]))
if len(lines) > 8:
    print(f"...+{len(lines) - 8} more — see oracle-cron.{sys.argv[1]}.log")
' "$SLUG") || CLUSTER_RESULTS=""
fi

if [[ "$RC" -eq 0 ]]; then
  MSG="✅ oracle-cron ($SLUG) round finished (exit 0)"
else
  MSG="🔴 oracle-cron ($SLUG) round FAILED (exit $RC) — see $RUN_LOG"
fi
if [[ -n "$CLUSTER_RESULTS" ]]; then
  MSG="$MSG
Clustering results this round:
$CLUSTER_RESULTS"
fi
if [[ -n "$CONCERNS_NEW" ]]; then
  MSG="$MSG
Content-policy drops this round:
$CONCERNS_NEW"
fi
discord_notify "$MSG"

exit "$RC"
