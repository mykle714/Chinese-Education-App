# Backfill Staleness & Cost-to-Patch Analysis

Report, per backfill enrichment script, how many dictionary-entry (det) rows are
**out of date** (never run, or stamped below the script's current version), then
estimate the **cost to patch the gap** at today's model prices. Read-only: this
skill analyzes and estimates — it does not run any backfill or write to the DB.

Use when the user asks "how out of date are the dictionaries", "which backfills
need re-running", "what would it cost to re-enrich", or similar.

## How staleness is tracked

Each det table (`dictionaryentries_zh`, `dictionaryentries_es`) has an
`enrichmentLog` jsonb column (migration 68): `{ "<scriptId>": { ranAt, version } }`.
A script stamps its row **only when it writes a change** (via `stampEntries` in
`server/scripts/backfill/run-log.js`) — the "unchanged" path does not stamp. So:

- **stale** = stamped at a version **below** the script's current `SCRIPT_VERSION`
  → logic changed since; genuinely re-runnable.
- **missing** = no stamp at all → **ambiguous**: never ran, ran as a no-op, OR
  ran before stamping existed. A missing stamp is NOT proof it never ran.

Report `stale` and `missing` as separate columns; never collapse them.

## 0. Machine check

Read `amIOnTheProdMachine.md`. This skill only reads, so either machine is safe,
but note which DB you are analyzing (dev and prod have separate `enrichmentLog`
histories and separate `server/logs/backfill-runs.jsonl`).

## 1. Collect each script's current SCRIPT_VERSION

The scripts live in `server/scripts/backfill/{chinese,spanish}/` (plus the
language-agnostic `server/scripts/backfill/backfill-icons.js`). The `enrichmentLog`
key is `"chinese/<name>"` / `"spanish/<name>"`, except icons which stamps as
`"backfill-icons"`.

```bash
cd /home/cow/server/scripts/backfill
for d in chinese spanish; do for f in "$d"/*.js; do
  v=$(grep -oE "SCRIPT_VERSION *= *[0-9]+" "$f" | grep -oE "[0-9]+" | head -1)
  [ -n "$v" ] && echo "$d/$(basename "${f%.js}")|$v"
done; done
grep -oE "SCRIPT_VERSION *= *[0-9]+" backfill-icons.js | grep -oE "[0-9]+" | head -1 | sed 's/^/backfill-icons|/'
```

Scripts with no `SCRIPT_VERSION` / no `initRunLog` do not stamp — exclude them.

## 2. Staleness query (per table, per cohort)

Build a `VALUES` list of `(scriptKey, currentVersion)` from step 1 and run this
against the matching table. Default cohort is `discoverable = TRUE` (the rows that
actually get AI-enriched); pass `--all` intent to drop that filter. Swap
`dictionaryentries_zh` + the `chinese/` keys for `_es` + `spanish/` keys.

```sql
WITH cur(script, ver) AS (VALUES
 ('backfill-icons',1),
 ('chinese/backfill-parts-of-speech',2),
 ('chinese/backfill-long-definitions',11),
 ('chinese/backfill-example-sentences',2),
 ('chinese/backfill-process-definitions-array',3)
 -- … one row per script from step 1 …
),
pop AS (SELECT "enrichmentLog" AS log FROM dictionaryentries_zh
        WHERE language='zh' AND discoverable=TRUE)
SELECT c.script, c.ver AS cur_v,
  COUNT(*) FILTER (WHERE (p.log -> c.script) IS NULL)                              AS missing,
  COUNT(*) FILTER (WHERE (p.log #>> ARRAY[c.script,'version'])::int <  c.ver)      AS stale,
  COUNT(*) FILTER (WHERE (p.log #>> ARRAY[c.script,'version'])::int >= c.ver)      AS current
FROM cur c CROSS JOIN pop p
GROUP BY c.script, c.ver
ORDER BY (COUNT(*) FILTER (WHERE (p.log -> c.script) IS NULL)
        + COUNT(*) FILTER (WHERE (p.log #>> ARRAY[c.script,'version'])::int < c.ver)) DESC;
SELECT COUNT(*) AS cohort_total FROM dictionaryentries_zh WHERE language='zh' AND discoverable=TRUE;
```

Run via `docker exec -i cow-postgres-local psql -U cow_user -d cow_db < query.sql`
(the heredoc must be piped with `-i`; a bare `-c` with a multi-statement heredoc
silently produces no output).

### Interpreting "missing"

Before calling a script's `missing` rows "needs running," sanity-check whether the
script even applies to those rows — several are conditional and legitimately N/A:

| Script | Legit reason its stamp can be absent |
|---|---|
| `dictionary-breakdown` | only multi-char words get a breakdown (single chars are NULL) |
| `pinyin-ucolon` | only fires on words containing `ü` |
| `expand-abbreviations` | only fires when an abbreviation is present |
| `particles-and-classifiers` | writes the `pct` table, only for particle/classifier words |
| `word-forms` | writes `{}` when no English forms apply |

A populated target column with no stamp = the script ran before stamping existed
(the log under-records); confirm by checking the column, not just the log.

## 3. Cost-to-patch estimate

Token usage + cost per run is logged to `server/logs/backfill-runs.jsonl` by
`run-log.js` (instruments `anthropic.messages.create`). **Recompute cost yourself
with the corrected price table below — do not trust historical `estimatedCostUsd`
in old log lines if they predate the pricing fix.**

Current Anthropic list prices (per 1M tokens) — **verify against the `claude-api`
skill / platform.claude.com before quoting, prices drift:**

| Model | input | output | cacheWrite (5m) | cacheRead |
|---|--:|--:|--:|--:|
| claude-opus-4-8 | $5 | $25 | $6.25 | $0.50 |
| claude-sonnet-4-6 | $3 | $15 | $3.75 | $0.30 |
| claude-haiku-4-5 | $1 | $5 | $1.25 | $0.10 |

(These mirror `PRICING_PER_MTOK` in `run-log.js` — if that table is wrong, fix it
there too; an Opus rate of `15/75` is the old Opus-3 price and is a bug.)

**Per-entry cost** is the missing piece (the log records per-*run*, not per-entry).
Derive it the reliable way: run the target script in `--spot-check` (no writes) or
`--words=<2-3 representative words>` on a few entries, read the fresh log line, and
compute corrected cost ÷ entries. Then:

```
patch_cost(script) ≈ per_entry_cost × (stale + applicable missing)
```

Aggregate the per-model tokens from a log line like this:

```bash
docker exec -i cow-backend-local node -e '
const P={"claude-opus-4-8":{i:5,o:25,cw:6.25,cr:0.5},"claude-sonnet-4-6":{i:3,o:15,cw:3.75,cr:0.3},"claude-haiku-4-5":{i:1,o:5,cw:1.25,cr:0.1}};
let d="";process.stdin.on("data",c=>d+=c).on("end",()=>{const r=JSON.parse(d.trim().split("\n").pop());let c=0;
for(const[m,u]of Object.entries(r.usageByModel||{})){const p=P[m];if(!p)continue;
 c+=(u.input*p.i+u.output*p.o+u.cacheWrite*p.cw+u.cacheRead*p.cr)/1e6;}
console.log(r.script,"calls:",r.apiCalls,"corrected $"+c.toFixed(4),"| words:",r.words);});' < /home/cow/server/logs/backfill-runs.jsonl
```

### Prompt caching changes the estimate

The AI scripts cache their static instruction prefix in a `system` block
(`cachedSystem` in `run-log.js`). When caching is active, uncached input per call
drops to a few hundred tokens and the prefix is billed at 0.1× (cacheRead). Two
consequences for the estimate:

- A re-run over many entries is far cheaper on the **input** side than the raw
  per-call token count suggests — measure per-entry cost from a multi-entry run so
  the cache-read economics are reflected, not a single cold call.
- Caching only triggers for a static prefix **above ~1k tokens** (empirically: a
  1,247-token prefix cached; smaller ones silently don't). Scripts with tiny
  prompts (`hsk-level`, `classifier`, `particles`, `word-forms`, `vernacular-score`)
  do not cache — their cost is just input × price, no cache discount.
- Opus retry/chooser calls in the multi-agent scripts are **not** cached (and often
  dominate cost on hard entries), so caching dents the Sonnet hot path more than the
  total. Don't over-credit caching on retry-heavy scripts (`long-definitions`).

## 4. Output

Present, per language:

1. A staleness table: `script | cur_v | missing | stale | current`, cohort total
   noted, sorted by `missing+stale` desc.
2. A short interpretation grouping scripts into **genuinely stale** (version bumped,
   re-runnable), **missing-but-N/A** (conditional scripts), and **current**.
3. A cost-to-patch table: `script | out-of-date count | est. $`, with the per-entry
   basis stated and a caching caveat. Flag it as an **estimate** and recommend a
   `--spot-check` to confirm before any mass re-run.

End by reminding: re-running scripts only touches rows whose target column is
NULL/eligible unless the script re-processes by version — confirm each script's
selection query before assuming a plain re-run will refresh stale-version rows
(many select `WHERE <col> IS NULL`, so stale-but-populated rows need the column
nulled first). And these are DB writes — on dev they're safe; syncing to prod is a
separate `/data-deploy` step.
