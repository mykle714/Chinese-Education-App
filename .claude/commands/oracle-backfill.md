# Oracle Backfill — run the enrichment pipeline with a local answerer

Run the `/mark-discoverable` enrichment pipeline **without spending API credit**:
answer every prompt yourself instead of letting `anthropic.messages.create` do it,
and keep going until the Max-plan 5-hour session budget is spent.

Same pipeline, same prompts, same validators, same DB writes — only the *answerer*
changes. This is NOT a shortcut around any of the pipeline's checks.

> ⚠️ **Writes directly to PRODUCTION.** The old dev → `/data-deploy` review gate is
> retired; there is no staging copy. Take the backup (§2) every single run.

---

## 0. How the oracle works

Each AI backfill script is three separable parts:

```
buildRequest(row)  ─→  [ ORACLE ]  ─→  handleResponse(row, message)
builds the prompt      answers it      validates + writes to det
```

Normally the middle box is an HTTP call billed to `ANTHROPIC_API_KEY`. Oracle mode
(`server/scripts/backfill/run-log.js`, "ORACLE MODE" block) swaps **only that box**,
at the single `anthropic.messages.create` wrapper every script already routes
through. `handleResponse` — parsing, schema validation, normalization,
`stampEntries`, the `UPDATE` — runs completely unmodified.

**That is the quality gate: an authored answer must survive the exact validators an
API answer would.** Never hand-write `UPDATE dictionaryentries_* SET …` to "fix" a
row the script rejected — a rejected row means the answer was wrong. Per CLAUDE.md
it is illegal to set `discoverable = TRUE` outside this pipeline.

Two phases, keyed by a content hash of `(model, system, messages)`:

| Phase | Env | Effect |
|---|---|---|
| export | `BACKFILL_ORACLE=export` | Serializes each built prompt to `server/logs/oracle-prompts.jsonl`, then unwinds the row via `OracleExportSignal`. **No DB write, no network.** |
| apply | `BACKFILL_ORACLE=apply` | Reads authored answers from `server/logs/oracle-answers.jsonl`, returns them as a real message with zeroed `usage`. Normal validation + write. |

Incompatible with `--batch` (batch results bypass the wrapper). The models named in
the scripts are ignored — you are the answerer regardless.

---

## 1. Preflight

1. Read `amIOnTheProdMachine.md`. This skill is written for the **prod** box.
2. Check session headroom — it decides how many rounds to run:

```bash
TOKEN=$(python3 -c "import json;print(json.load(open('$HOME/.claude/.credentials.json'))['claudeAiOauth']['accessToken'])")
curl -s https://api.anthropic.com/api/oauth/usage \
  -H "Authorization: Bearer $TOKEN" -H "anthropic-beta: oauth-2025-04-20" \
  | python3 -m json.tool | grep -A4 '"five_hour"'
```

`five_hour.utilization` is a **percentage** (the dollar fields are always null on
this plan). Note `resets_at`; budget rounds against the time left; stop at ~95%.

3. Confirm the word batch with the user before the first write of the run.

## 2. Back up prod det — every run, no exceptions

```bash
server/scripts/backfill/backup-det.sh <short-label>
```

Dumps `dictionaryentries_zh`, `dictionaryentries_es`, `validations` to
`server/backups/det-<ts>-<label>.sql.gz`. Record the path — it goes in the report.
**Do not proceed if this fails.**

## 3. Plan the round — which scripts, which rows

**Do not run a fixed script list.** Ask the planner, which reads the authoritative
zh manifest (`server/scripts/backfill/shared/lib/requiredScripts.js`) — the same
source of truth the on-first-sort lazy-enrichment worker uses:

```bash
# refresh/heal work on already-shipped words
server/scripts/backfill/run-prod.sh scripts/backfill/oracle-plan.js --discoverable --limit=50

# candidates to newly ship
server/scripts/backfill/run-prod.sh scripts/backfill/oracle-plan.js --new --limit=25
```

It prints, in dependency order, each script that has real work and the exact
`--words=` list to hand it. It is read-only. Run **only** the scripts it names.

The manifest — not this document — decides what "pending" means:

- **Applicability** (`when`): `dictionary-breakdown` only on multi-char words,
  `process-definitions-array` only on multi-definition rows, `classifier` only on
  nouns. A step is never "missing" on a row it doesn't apply to.
- **Version-aware staleness**: a step is pending when it has **no stamp** or is
  stamped **below** its manifest `version`. So a prompt revision re-triggers *only
  that one script*, never "stale everything" — this is what satisfies "don't
  execute prompts for rows that aren't out of date for that script." Use `--stale`
  on the script when the planner reports version-stale rows.
- **Approval protection**: a step whose validation field a validator approved or
  flagged is never pending, mirroring `validatedClause` in the scripts themselves.
  The planner prints these under `🛡 validator-protected`.

The manifest's `version` is hand-synced to each script's `SCRIPT_VERSION` (see its
header). If you bump a `SCRIPT_VERSION`, bump the manifest too or the planner will
under-report. Verify sync before a long run.

For **new** words, take the planner's candidates to the user, then follow
`/mark-discoverable` §A1 → A1.5 (**do not skip the cedict most-popular-reading
check**) → A2 before enriching. For es use §B1–B2.

> **Never bypass a script's own row selection.** Even when the planner names a
> script, that script re-derives its own `doneGate` — pass `--words=` and let it
> decide. Never hand-pick rows around a gate.

### Guardrails baked into the SQL

- **Approved fields are never overwritten.** Every writer of a validatable column
  (`partsOfSpeech`/`definitions`/`longDefinition`, and `exampleSentences`) ANDs in
  `validatedClause(...)`, excluding rows a validator approved *or* flagged. Do not
  add a script to this loop without confirming it carries that guard.
- **Version stamps stay truthful.** `SCRIPT_VERSION` records which *prompt* version
  produced the value, and the oracle answers that exact prompt — so the stamp is
  honest. `stampEntries` additionally writes `oracle: true` into `enrichmentLog` to
  record *who* answered, so oracle rows stay distinguishable from API rows.

## 4. Run the pipeline

Run the scripts **the planner named, in the order it printed** — manifest order
encodes the hard dependencies (POS before word-forms/long-defs/examples; clusters
before examples; POS + vernacular-score before clusters). Re-run the planner after
a round to pick up steps unblocked by the previous one (e.g. `classifier` becomes
applicable only once `partsOfSpeech` exists).

**Spanish has no manifest** — `requiredScripts.js` is zh-only, so `oracle-plan.js`
cannot plan es. Fall back to the fixed §B3 order there and rely on each script's own
`doneGate`: `split-semicolon-definitions · expand-abbreviations · parts-of-speech
(--dry-run first!) · process-definitions-array · long-definitions ·
example-sentences · vernacular-score`. Flag this asymmetry to the user if es work
becomes routine — an es manifest would be the fix.

Per script, three steps:

```bash
# (1) capture the real prompts — no DB write, no network
rm -f server/logs/oracle-prompts.jsonl
BACKFILL_ORACLE=export server/scripts/backfill/run-prod.sh \
  scripts/backfill/chinese/backfill-hsk-level.js --words=未来,摸脉

# (2) read every prompt and author an answer per promptId (see below)

# (3) feed them back through the untouched validators
BACKFILL_ORACLE=apply server/scripts/backfill/run-prod.sh \
  scripts/backfill/chinese/backfill-hsk-level.js --words=未来,摸脉
```

`run-prod.sh` runs on the host against `cow-postgres-prod` — the prod backend image
ships neither the scripts nor `tsx`, so `docker exec cow-backend-prod` cannot work.

### Authoring answers

Read `server/logs/oracle-prompts.jsonl` in full. Each line is
`{promptId, model, maxTokens, system, messages}` — the **actual** prompt, including
the full system block. Obey it exactly: it carries the output contract (bare token,
strict JSON schema, sentence counts, POS coverage rules).

Write `server/logs/oracle-answers.jsonl`, one line per prompt:

```json
{"promptId":"f61aa7bc5f022af7","text":"HSK4"}
```

`text` is the raw assistant text the script would have received — **no markdown
fences** unless the prompt asks for them; `handleResponse` parses it verbatim.
Answer every prompt, or `apply` errors on the missing one.

Then read the apply output. `FAILED: unusable model output` means the answer did
not satisfy the validator — re-author and re-run apply. Surface every
`⚠ CLUSTER REVIEW <word> (id=…)` line to the user; those are self-flagged uncertain
senses and they feed the downstream example sentences.

## 5. Verify

Run `/mark-discoverable` §A4 (zh) / §B4 (es) verification SQL. Every newly
discoverable row must have non-null `partsOfSpeech`, `longDefinition`,
`exampleSentences`, `vernacularScore` (+ zh `breakdown`, `classifier`, `difficulty`).

Confirm no reviewed field moved:

```sql
SELECT val.field, val.action, d.word1
FROM validations val JOIN dictionaryentries_zh d ON d.id = val."entryId"
WHERE val.action IN ('approve','flag') AND d."enrichmentLog" IS NOT NULL
  AND (d."enrichmentLog" #>> '{chinese/backfill-example-sentences,ranAt}')::timestamptz > '<run start>';
```

Any hit means a guard is missing — stop and report it.

## 6. Loop or stop

Re-check §1 and compare `five_hour.utilization` against the previous round.

> 🛑 **Flat-usage gate — stop the loop if utilization did NOT rise.**
> In oracle mode *you* are the answerer, so a completed round must consume session
> budget. If utilization is unchanged after a round that wrote rows, the answers came
> from somewhere other than this session — the most likely cause is a code path that
> bypassed the `messages.create` wrapper and hit the real API on `ANTHROPIC_API_KEY`.
> **Halt immediately, do not start another round, and report it.** Do not rationalize
> it as rounding: a round of real authoring moves the number.
>
> Two structural backstops make this unlikely but neither is sufficient alone:
> oracle mode clobbers `ANTHROPIC_API_KEY` with a placeholder so a bypassing call
> fails 401 rather than spending, and `usage` on oracle replies is zeroed so no spend
> can be booked. The gate catches whatever those miss.

Otherwise, if utilization < ~95% and time remains before `resets_at`, return to §3
with a fresh batch. Otherwise stop and write the report.

## 7. Write the run report — required

Write `docs/oracle-runs/oracle-run-<UTC-timestamp>.md` covering:

- **Session budget**: utilization before/after, `resets_at`, rounds completed.
- **Backup**: path from §2, plus the restore command.
- **Words**: every word newly marked discoverable (id + pronunciation), and every
  already-discoverable row refreshed and why (null column vs `--stale`).
- **Per script**: prompts exported, answers authored, rows updated, rows rejected by
  the validator — with the reason and how the answer was corrected.
- **A1.5 pronunciation decisions**: readings checked, changed, or deliberately left.
- **Cluster review flags**: every `⚠ CLUSTER REVIEW` line verbatim.
- **Guardrail evidence**: rows excluded by `validatedClause`; confirmation that no
  approved/flagged field was written.
- **A sample of the actual content authored** — several long definitions, example
  sentences, and clusters quoted in full, so the user can judge quality rather than
  take a row count on faith.
- **Anything uncertain**: words whose meaning or reading was unclear, answers that
  needed a retry, and anything a human should double-check.

Be honest about failures and low-confidence answers. A clean-looking report over a
sloppy run is worse than no run at all.

## Notes / references

- Round planner: `server/scripts/backfill/oracle-plan.js` (read-only) over the zh
  manifest `server/scripts/backfill/shared/lib/requiredScripts.js`, shared with the
  on-first-sort worker (`run-lazy-enrichment.js`, docs/DISCOVER_LAZY_ENRICHMENT.md).
- Oracle implementation: `server/scripts/backfill/run-log.js` (ORACLE MODE block,
  `oraclePromptId`, `OracleExportSignal`, `assertOracleCompatible`); export
  accounting in `server/scripts/backfill/shared/lib/runner.js`.
- Prod invocation shim: `server/scripts/backfill/run-prod.sh` (incl. the
  `server/db-config.ts:15` SSL-sentinel override).
- Backup: `server/scripts/backfill/backup-det.sh`.
- Word selection, pipeline order, verification SQL: `.claude/commands/mark-discoverable.md`.
- Validation guard: `docs/DATA_VALIDATION_SYSTEM.md` § "Backfill guard".
- Staleness model: `staleClause()` in run-log.js + the backfill-staleness skill.
