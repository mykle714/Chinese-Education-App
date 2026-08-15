# Diagnostics Pull (prod client telemetry → local dev)

Bring production's real-user client diagnostics down to a dev box so they can be
analyzed locally: interaction-latency telemetry (`client-perf-*.jsonl`) and
front-end crash records (`client-error-*.jsonl`).

This is what answers **"what is actually slow in prod"** — Tier 1 item 4 of
[REACT_NATIVE_MIGRATION.md](../../docs/REACT_NATIVE_MIGRATION.md), the step that
clears decision gate 1. What the records mean:
[CLIENT_PERF_DIAGNOSTICS.md](../../docs/CLIENT_PERF_DIAGNOSTICS.md).

> ⚠️ **This is NOT a database pull, and that is the whole reason it is its own
> skill.** The diagnostics sinks write append-only JSONL to the prod **host
> filesystem** (`~/vocabulary-app/server/logs/`). There is no table, so
> [`/data-pull`](./data-pull.md)'s `pg_dump` machinery does not reach any of it.
> Reaching for that skill here is the most likely mistake.

Like [`/data-pull`](./data-pull.md) and [`/template-pull`](./template-pull.md),
the transport is a **git commit**, because there is no cross-machine SSH on this
project. That constraint is what forces the scrubbing step below.

---

## ⚠️ FIRST: Which machine are you on?

Read [amIOnTheProdMachine.md](../../amIOnTheProdMachine.md) (gitignored, present on
every machine). This pull has **two halves that run on two different machines**,
and you can only run the half for the machine you are on:

- **On PROD** → you are the **SOURCE**. Run [Step 0](#step-0--is-the-pipeline-even-deployed)
  and the [Prod half](#prod-half--source) yourself, then hand the user the
  [Local half](#local-half--target) as one copy-pasteable block.
- **On DEV/local** → you are the **TARGET**. Hand the user Step 0 + the Prod half
  to run on the server; once they confirm the push landed, run the Local half
  yourself.

---

## Step 0 — Is the pipeline even deployed?

**Do this before anything else.** The perf sink may not be live on prod at all.

```bash
ls -la ~/vocabulary-app/server/logs/client-perf-*.jsonl 2>/dev/null | tail -5
ls -la ~/vocabulary-app/server/logs/client-error-*.jsonl 2>/dev/null | tail -5
wc -l ~/vocabulary-app/server/logs/client-perf-*.jsonl 2>/dev/null | tail -1
```

| Result | Meaning | Do |
|---|---|---|
| Files, non-trivial line counts | Live and collecting | Continue to the Prod half |
| `server/logs` exists, no `client-perf-*` | Endpoint deployed, **no traffic** or clients not reporting | Stop. Check that `initPerfDiagnostics()` runs in the prod build (`src/main.tsx`, gated to `MODE === 'production'`) |
| No `server/logs` at all | **Not deployed** | Stop and report that. `/deploy` first, then let it collect for a few days before a pull is worth anything |

> 🛑 **Do not fabricate a conclusion from an empty pull.** "No data" and "no
> problem" produce identical analyzer output and mean opposite things. Report
> which one you actually observed.

---

## 🔒 Privacy — why there is a script and not a `cp`

Every perf batch record carries **`ip`**, stamped from `x-forwarded-for` by
`server/routes/diagnosticsRoutes.ts`. Error records carry stacks that may retain
identifiers despite client-side scrubbing.

Since the only transport is a git commit, **raw logs must never be committed** —
publishing user IPs into git history is not undone by deleting the file later.
`server/scripts/export-diagnostics-bundle.ts` strips `ip`, drops any line it
cannot parse (an unparseable line is one that cannot be *proven* scrubbed), and
gzips the result.

**Always use the script. Never `cp` or `gzip` the logs by hand.**

---

## Prod half — SOURCE

```bash
cd ~/vocabulary-app
git pull origin main

# Strip IPs, gzip, write into the committed bundle path. --days bounds the window.
npx tsx server/scripts/export-diagnostics-bundle.ts --days 30 --out database/diagnostics

ls -lh database/diagnostics/
git add database/diagnostics/
git commit -m "data: refresh prod client-diagnostics bundle (IP-stripped)"
git push origin main
```

**Report the record counts the script prints** — the local half verifies against them.

Flags: `--days N` (default 30), `--out DIR`, `--logs DIR` (defaults to
`$DIAGNOSTICS_LOG_DIR`, else `server/logs`), `--dry-run`.

---

## Local half — TARGET

```bash
cd <local repo>              # e.g. ~/vocabulary-app on the dev box
git pull origin main

mkdir -p server/logs
gunzip -c database/diagnostics/client-perf-*.jsonl.gz  > server/logs/client-perf-prod-import.jsonl
gunzip -c database/diagnostics/client-error-*.jsonl.gz > server/logs/client-error-prod-import.jsonl 2>/dev/null || true
wc -l server/logs/client-perf-prod-import.jsonl        # == the prod record count

cd server
npx tsx scripts/analyze-client-perf.ts
npx tsx scripts/analyze-client-perf.ts --path /flashcards/decks
npx tsx scripts/analyze-client-perf.ts --min 500
```

⚠️ `analyze-client-perf.ts` reads **every** `client-perf-*.jsonl` in the log dir,
so the import needs no flag — but that also means **local dev records mix into the
same report**. Clear or rename any local ones first, or the prod picture is
contaminated with laptop timings.

---

## Reading the result

| Telemetry shows | Cause | Would React Native fix it? |
|---|---|---|
| Long tasks / blocked main thread | JS work | ❌ follows you across |
| Slow paint, fine JS | WebView rendering | ✅ yes |
| Slow startup, fine steady-state | Bundle size | ✅ — but so does code splitting, far cheaper (already done: entry chunk 2,229 kB → 436 kB) |

⚠️ **Check the date range before trusting any `%` column.** Records written before
the tap-census change are threshold-filtered and skew percentages upward — see
CLIENT_PERF_DIAGNOSTICS.md.

⚠️ **This data cannot answer the scale question.** No real user has 1,000
pedestrians, so prod telemetry says nothing about the Night Market target. That
needs the **dev load test** — REACT_NATIVE_MIGRATION.md action item 4a — to be run
once this pipeline is confirmed live, so both data sets share one analyzer and one
metric shape.

---

## Cleanup

The bundle is a point-in-time diagnostic, not a data set to maintain. Delete
`database/diagnostics/` once the question is answered.

Note the source files are retained on prod for only
`DIAGNOSTICS_LOG_RETENTION_DAYS` (default **30**), so a pull is not a substitute
for asking the question promptly.

---

## Important Notes

- **Never commit raw diagnostics JSONL.** Records carry client IPs. Always go
  through `server/scripts/export-diagnostics-bundle.ts`.
- **Never write these files back to prod.** The import is read-only analysis;
  prod's `server/logs/` is an append-only sink owned by the running container.
- **Direction is prod → local only.**
- **Not `/data-pull`.** That skill is Postgres tables (`icons8`, det zh/es,
  `validations`) and shares nothing with this one but the git transport.
- Full context: `docs/CLIENT_PERF_DIAGNOSTICS.md` (record shapes, what dominates
  what), `docs/REACT_NATIVE_MIGRATION.md` (why item 4 matters, and the dev load
  test that must follow it).
