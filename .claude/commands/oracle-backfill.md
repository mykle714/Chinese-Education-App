# Oracle Backfill — run the enrichment pipeline with a local answerer

Run the `/mark-discoverable` enrichment pipeline **without spending API credit**:
answer every prompt yourself instead of letting `anthropic.messages.create` do it,
and keep going until the Max-plan 5-hour session budget is spent.

Same pipeline, same prompts, same validators, same DB writes — only the *answerer*
changes. This is NOT a shortcut around any of the pipeline's checks.

> ⚠️ **Writes directly to PRODUCTION.** The old dev → prod data-deploy review gate is
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
this plan). Note `resets_at` — it is the boundary of the *current* window, **not the
end of the run**. A run spans as many windows as it takes; at ~75% you park and wait
for the reset rather than finishing (§6a). Size the round you start next against the
time left in the window: near the boundary, prefer parking over starting a batch that
will be interrupted mid-manifest.

`resets_at` is `null` when utilization is 0 (no window is open yet); the window opens
on the next request and runs five hours from there.

> 🛑 **The weekly cap is a spend boundary, not a rate limit — and it does not error.**
> Read `limits[]`, not just `five_hour`: it lists every active cap (`session`,
> `weekly_all`, per-model `weekly_scoped`) with a normalized `percent`. **`weekly_all`
> at 100% does not refuse requests.** If `extra_usage.is_enabled` is true, work past the
> cap silently bills pay-as-you-go credits — real dollars — and every request keeps
> succeeding exactly as before. Between 2026-08-22 and 2026-08-23, 26 unattended rounds
> ran at `seven_day` = 100%, each one correctly *reporting* the reading and then
> concluding the endpoint must be wrong because nothing was failing. It was not wrong.
>
> So: **a 100% weekly reading is a hard stop, and the only signal you will get.** Park
> (§6a) and wait for `resets_at`. Do not treat "requests still succeed" as permission to
> continue — that is the failure mode, not the all-clear. `oracle-cron.sh` enforces the
> same rule at launch (its budget gate refuses to start a round at or above
> `ORACLE_MAX_UTILIZATION`, default 75% as of 2026-08-28, lowered from 95%), but it can only refuse to *start*; a round that
> crosses the cap mid-manifest can only be stopped by you. That gate reads
> `~/.claude/.credentials.json`'s access token, which expires (~8h TTL) and is refreshed
> only by a live session — on a quiet box the gate will otherwise 401 and fail closed
> for hours with the plan under-utilized. It now retries once via a throwaway
> `claude -p` probe on a 401 before skipping, and escalates on stderr after
> `ORACLE_GATE_FAIL_ESCALATE` (default 3) consecutive non-cap failures.

3. **Check for a parked run**: if the resume note exists (`$ORACLE_RESUME_FILE` when
   set — a parallel/cron worker owns its own; otherwise `server/logs/oracle-resume.md`),
   a previous
   window parked mid-run (§6a). Read it and continue *that* run — its batch, its
   script in flight, its accumulated report notes — instead of planning a fresh
   round. Delete the file once its batch is promoted and its notes are folded into
   your working notes for §7.
4. **Do not confirm the word batch with the user.** The planner curates and ranks
   every batch (§3/§3b); invoking this skill is standing authorization to enrich
   whatever it selects, for the whole run. Take the first batch and go straight to
   §2 → §4 — no pre-write check-in, no per-round batch approval.
5. **Never ask the user anything, ever, during a round.** This includes
   `AskUserQuestion` and any other interactive check-in. This skill runs unattended;
   there is nobody present to answer. Every situation that might tempt a question —
   including a slur or explicit-sexual-content batch (§3c) — has a scripted
   drop-and-log resolution instead. If you find yourself about to phrase a question,
   that is a sign the situation belongs in §3c or the §6 stop-condition list, not in
   a prompt to the user.

## 2. Back up prod det — every run, no exceptions

```bash
server/scripts/backfill/backup-det.sh <short-label>
```

Dumps `dictionaryentries_zh`, `dictionaryentries_es`, `validations` to
`server/backups/det-<ts>-<label>.sql.gz`. Record the path — it goes in the report.
**Do not proceed if this fails.**

## 3. Plan the round — which scripts, which rows

**Do not run a fixed script list.** Ask the planner, which reads the authoritative
manifests (`server/scripts/backfill/shared/lib/requiredScripts.js` —
`REQUIRED_SCRIPTS_ZH` / `REQUIRED_SCRIPTS_ES`, selected by `--lang`) — the same source
of truth the on-first-sort lazy-enrichment worker uses:

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
- **Opt-in steps** (`optional: true`): excluded from the plan *and* from the promotion
  bar unless asked for. Today this is `backfill-icons` only — the one step that must
  reach an external paid API (icons8), which an oracle run cannot answer locally. **The
  default is to skip it**: a word ships with `iconId` NULL and every surface that reads
  it degrades gracefully. Include it only on explicit instruction, and then pass
  `--with-icons` to **both** the planner and `promote-discoverable.js` (the planner alone
  only adds it to the plan; the promoter alone only adds it to the bar).

The manifest's `version` is hand-synced to each script's `SCRIPT_VERSION` (see its
header). If you bump a `SCRIPT_VERSION`, bump the manifest too — in **both** manifests
if the script is language-shared (`backfill-icons`) — or the planner will under-report.
**Verify sync before a long run** (read-only, no DB, exits non-zero on drift):

```bash
server/scripts/backfill/run-prod.sh scripts/backfill/check-manifest-sync.js
```

Drift where the *script* is ahead of the manifest is the dangerous direction: rows
stamped at the older version read as current, so the planner never re-runs them.

For **new** words, take the planner's candidates directly (no user check-in) and
follow `/mark-discoverable` §A1 → A1.5 (**do not skip the cedict most-popular-reading
check**) → A2 before enriching. For es use §B1–B2.

> **Never bypass a script's own row selection.** Even when the planner names a
> script, that script re-derives its own `doneGate` — pass `--words=` and let it
> decide. Never hand-pick rows around a gate.

### 3b. When the discoverable backlog runs dry → ship new words

`--discoverable` eventually returns "nothing pending". **That is not the end of the
run** — it is a switch of scope, and §6 still applies. ~113k zh rows have never been
enriched at all, so there is always work. Switch to:

```bash
server/scripts/backfill/run-prod.sh scripts/backfill/oracle-plan.js --new --limit=25
```

**One bar, not two.** A row is either fully enriched and `discoverable`, or it is
invisible — the intermediate `sortable` flag (migration 110) was **dropped by
migration 144**, along with `promote-sortable.js` and the `--unsortable` scope. Do not
look for a cheap two-step path to put a card in front of learners; there isn't one any
more. A `--new` batch goes through the **whole** manifest.

For zh the planner **curates and ranks** the `--new` batch, and this matters more than
it looks: the corpus will never be enriched in full, so the ordering decides which
slice learners actually get. It filters to Han-only 1–4 char headwords with real
definitions (no `%` / `110` / `A片` / `surname X` stubs) and orders by a corpus-derived
character-commonness score (`CHAR_FREQ_CTE` — a character's score is how many headwords
contain it; a word scores as its rarest character). Without it, id order serves up
鳚/鹮/丂; with it, 大人 / 大学 / 市区 / 国. **Do not hand-pick around this filter** —
take the batch the planner gives you. (es gets no such filter — see §4.)

**Then run the two phases of the round, in this order:**

1. **Enrich** — every script the planner named, in its order, export→author→apply per §4.
2. **Promote** — never with hand-written SQL:
   ```bash
   server/scripts/backfill/run-prod.sh scripts/backfill/promote-discoverable.js --words=<batch>            # dry run
   server/scripts/backfill/run-prod.sh scripts/backfill/promote-discoverable.js --words=<batch> --apply
   ```
   It re-derives the bar (`buildCompletePredicate`: every applicable manifest step
   stamped at manifest version, **plus** `difficulty BETWEEN 1 AND 6`) and re-asserts it
   inside the `UPDATE`, so a half-finished batch cannot be flagged. Rows it prints as
   `✗ not ready` name their own blocker — re-run that step, never force the flag.

If the session ends mid-batch nothing is inconsistent: incomplete rows simply stay
`discoverable = FALSE`, and a later `promote-discoverable.js --limit=N` (no `--words`)
sweeps up every row that already cleared the bar.

**Promotion is deliberately the LAST act of the round, not the first.** Setting the
flag up front (the `/mark-discoverable` §A2 order) is only safe under that skill's
own end-to-end verification; here, a row flagged before its steps land would ship a raw
cedict gloss to the dictionary, reader and flashcard surfaces.

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
before examples; POS + frequency-score before clusters). Re-run the planner after
a round to pick up steps unblocked by the previous one (e.g. `classifier` becomes
applicable only once `partsOfSpeech` exists).

**Spanish plans the same way** — pass `--lang=es` to the planner and to every script
path below (`scripts/backfill/spanish/…`). `REQUIRED_SCRIPTS_ES` is the es manifest,
so applicability, version-staleness and approval protection all behave exactly as they
do for zh:

```bash
server/scripts/backfill/run-prod.sh scripts/backfill/oracle-plan.js --lang=es --discoverable --limit=50
server/scripts/backfill/run-prod.sh scripts/backfill/oracle-plan.js --lang=es --new --limit=25
```

Four es-specific things to know:

- **The zh `--new` curation/ranking is zh-only.** For es the planner applies no
  headword-quality filter and no commonness order (see the fourth bullet below), so an
  es `--new` batch must be eyeballed before you author a single prompt.
- **There is no es `parts-of-speech` step.** `partsOfSpeech` is a by-product of
  `spanish/backfill-cluster-definitions`, which replaced the old row-materializing
  `spanish/backfill-parts-of-speech.js` (deleted, migration 123).
- **Always `--dry-run` the clusterer first** and review the printed clusters
  (`[frequency] sense (pos gender): glosses`) before the export/apply cycle.
- **`--new` does not filter junk headwords for es** — the head of the Wiktionary import
  is punctuation and abbreviations (`&`, `&c.`, `'tamo'`). §B1 requires confirming the
  word list with the user anyway; do that before authoring a single prompt.

**es target selection (no planner):** the goal is to backfill the *whole* table, so
**any incomplete entry is a suitable target** — there is no curated batch to wait on.
Work in this priority order, falling through as each drains:

1. **Incomplete discoverable rows first** — already-shipped es rows missing any of
   `longDefinition` / `exampleSentences` / `vernacularScore` (or `partsOfSpeech`).
   These are live to learners *now* with holes, so healing them is the highest value:
   ```sql
   SELECT id, word1, pos FROM dictionaryentries_es
   WHERE language='es' AND discoverable
     AND ("partsOfSpeech" IS NULL OR "longDefinition" IS NULL
          OR "exampleSentences" IS NULL OR "vernacularScore" IS NULL)
   ORDER BY word1;
   ```
   Run only the steps whose column is null (each script's `doneGate` also skips the
   rest), in §B3 order.
2. **Then new rows, in any order** — pick non-discoverable rows to enrich and ship.
   Follow §B1 (inspect POS/gender senses, flag junk/vulgar/rare senses to drop) →
   §B2 (set `discoverable` on the canonical id) → §B3 full pipeline. Prefer common,
   clean headwords; drop any word whose only sense is vulgar/explicit or unresolvably
   rare rather than shipping it (note dropped words for the report).

For es a row is either incomplete-discoverable, a new candidate, or done — the same
two-state model zh now uses.

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
`⚠ CLUSTER REVIEW <word> (id=…)` line in the run report (§7); those are self-flagged
uncertain senses and they feed the downstream example sentences.

### 3c. Content policy — slurs and sexual content

Never author a sense, definition, or example sentence for:

- **A slur or derogatory epithet** (ethnic, racial, national, or otherwise) as a
  word's primary or only sense — e.g. an ethnic slur that has no other meaning.
- **Explicit sexual content** — a sense whose gloss/example would need to describe
  sex acts or genitalia explicitly rather than clinically.

This is a **drop, not a pause**: remove the word from the batch, do not write
anything for it, and continue authoring the rest of the batch normally (this is the
same mechanic §6 already describes for "an explicit or invalid sense" — slurs and
sexual content are the two concrete cases of it). Do not ask the user whether to
proceed (§1.5).

Two cases do **not** count as a drop, and should be authored normally with standard
dictionary treatment (neutral, clinical definition; an explicit "derogatory/offensive"
or "vulgar" register label where the source data supports one; never used approvingly
in an example sentence):

- A word whose primary sense is ordinary and only a secondary/rare sense is a slur or
  vulgar — enrich the primary sense, drop only the offending sense from the cluster.
- Standard clinical/journalistic vocabulary for sex, sexuality, or the sex industry
  (e.g. terms that appear in law or media-rating contexts) — these are ordinary
  dictionary headwords, not "explicit sexual content" in the sense above.

**Log every drop** — append one line per dropped word to
`server/logs/oracle-concerns.md` (gitignored, append-only, never `rm`'d — this file
accumulates across every run) in the form:

```markdown
- [<UTC timestamp>] <word> (<script/promptId if applicable>): dropped — <slur|explicit-sexual>, <one-line reason>
```

This file is the mechanism for surfacing judgment calls without pausing the run — the
user reviews it periodically instead of being asked in the moment. It is separate
from and precedes the §7 run report (which is written once, at the very end of a
run, and may be much later); logging here is what makes the finding visible in the
meantime.

**Also add the word to the exclusion file** —
`server/scripts/backfill/shared/oracle-excluded-words.json` (committed, keyed by
`zh`/`es`) — with `{word1, reason, droppedAt}`. `oracle-plan.js` reads this file and
excludes every listed `word1` from `--new` (and general) scope queries. Without this
step the word simply wins the commonness ranking again next round, gets dropped
again, and burns a batch slot for nothing — this happened for five words
(阿三/小日本/台巴子/老黑/日人民报) across dozens of rounds from 2026-08-24 onward
before the exclusion file existed. `oracle-concerns.md` stays the append-only
*history* of why; this file is the planner's live exclusion *set* — both are
required, not one or the other. Do not remove an entry unless the underlying det
row's `definitions` actually changed such that the drop reason no longer applies.

## 5. Verify

Run `/mark-discoverable` §A4 (zh) / §B4 (es) verification SQL. Every newly
discoverable row must have non-null `partsOfSpeech`, `longDefinition`,
`exampleSentences`, `frequencyScore` (+ zh `breakdown`, `classifier`, `difficulty`).

Confirm no reviewed field moved:

```sql
SELECT val.field, val.action, d.word1
FROM validations val JOIN dictionaryentries_zh d ON d.id = val."entryId"
WHERE val.action IN ('approve','flag') AND d."enrichmentLog" IS NOT NULL
  AND (d."enrichmentLog" #>> '{chinese/backfill-example-sentences,ranAt}')::timestamptz > '<run start>';
```

Any hit means a guard is missing — stop and report it.

After a §3b round, also confirm no row was flagged beyond what it earned — every
`discoverable` row must carry a usable level:

```sql
-- MUST be 0
SELECT count(*) AS discoverable_without_level
FROM dictionaryentries_zh
WHERE language = 'zh' AND discoverable
  AND (difficulty IS NULL OR difficulty NOT BETWEEN 1 AND 6);
```

Non-zero means something set `discoverable` outside `promote-discoverable.js` /
`/mark-discoverable` — a CLAUDE.md violation. Stop and report it.

## 6. Loop — running to exhaustion is MANDATORY

**The purpose of this skill is to consume the session budget. Do not stop early.**
Keep looping §3 → §5 with a fresh batch, **across session windows**, until a §6
guardrail trips or the user stops you. That is the *only* successful end state.

> **A window boundary is not an ending.** `five_hour.utilization` reaching ~75%, or
> `resets_at` passing, means *this five-hour window* is spent — not the run. The
> corpus is ~113k unenriched zh rows deep; no single window can finish it, so
> treating the boundary as a finish line ends the run at an arbitrary point that has
> nothing to do with the work. At the boundary you **park and resume** (§6a), you do
> not write the report and hand back.

Work is drawn in this priority order, falling through when a scope is exhausted:
**(1)** `--discoverable` refresh/heal on shipped rows → **(2)** §3b `--new`: take a
curated batch through the whole manifest and promote it to `discoverable`. There is no
third state where the loop has nothing to do.

There is no discretion here. In particular, **none of the following is a reason to
stop or to pause for approval** — note the finding, keep going, and put it in the
final report:

- The backlog is large, or the burn rate implies many more rounds.
- You found a bug, an inefficiency, or work that will need redoing (e.g. unstamped
  rows). Record it; do not stop to fix it, and do not stop to ask whether to fix it.
- You want to check in, summarize progress, or confirm the batch. Batches are never
  confirmed with the user (§1.4); invoking the skill authorizes the whole run.
- Quality self-doubt about authoring and reviewing your own answers. That tension is
  inherent to oracle mode and is disclosed in the report — it is not a stop condition.
- A round finished cleanly and it feels like a natural place to hand back. It isn't.
- **The session window ended, or is about to.** Go to §6a, not to §7.
- **`--discoverable` reports nothing pending.** The refresh backlog draining is a
  *scope change*, not an ending: drop to §3b and start shipping new words (~113k zh
  rows have never been enriched). "Out of work" is only ever true if §3b's `--new`
  plan is *also* empty — which, at oracle pace, it will not be.
- A batch is blocked on content you decline to author (an explicit or invalid sense,
  including a slur or explicit-sexual-content word — §3c). Drop those specific words
  from the batch, log them to `server/logs/oracle-concerns.md` (§3c), and continue
  with the rest — do not let a handful of unanswerable rows end the run, and do not
  ask the user about them.

**Only these stop the loop** (all are guardrails, and each ends the run — report why):

1. The flat-usage check below leaves you actually believing something is wrong.
2. The §2 backup failed, or a fresh one cannot be taken when required.
3. Evidence a validator-approved/flagged field was overwritten (§5).
4. The user interrupts, or the **conversation** actually ends (context exhausted, the
   user closes the session). Note what this does *not* include: the five-hour
   **window** rolling over. That is §6a, and the loop survives it.

Re-check §1 and compare `five_hour.utilization` against the previous round.

> 🛑 **Flat-usage check — flat utilization is a prompt to think, not an automatic halt.**
> In oracle mode *you* are the answerer, so sustained work must consume session budget.
> If utilization does not rise after a round that wrote rows, stop and ask whether
> something is actually wrong. **Halt only if you conclude it is.** You are expected to
> reason about the number rather than react to it.
>
> **The thing this is watching for** is answers coming from outside this session — most
> plausibly a code path that bypassed the `messages.create` wrapper and hit the real API
> on `ANTHROPIC_API_KEY`. That is what a halt is *for*. Before halting, check it directly:
> is `ANTHROPIC_API_KEY` actually absent from the environment, repo-root `.env`, and
> `server/.env.docker`? Did the round's prompts appear in `oracle-prompts.jsonl` and get
> answered from `oracle-answers.jsonl`? If the answer path is provably yours, flat
> utilization is not evidence of the failure this check exists to catch.
>
> **Benign explanations you may accept**, when they fit the run's own history:
> - `five_hour.utilization` is an **integer percentage** (`limit_dollars`/`used_dollars`
>   are null on this plan). At a burn rate of ~1 point per 25–30 words, a whole round can
>   land inside a single point. Compare against the run's established points-per-round
>   before treating a flat reading as an anomaly — one flat round after a steady climb is
>   ordinary; look for a rise across **two** consecutive rounds instead.
> - The round was small, or spent most of its effort on re-runs and convergence passes
>   rather than fresh authoring.
>
> **What should actually worry you:** utilization flat across several rounds of real
> authoring, or flat while the burn rate had been visibly faster, or flat alongside any
> sign that an answer arrived without you writing it. Then halt and report.
>
> Two structural backstops make the bad case unlikely but neither is sufficient alone:
> oracle mode clobbers `ANTHROPIC_API_KEY` with a placeholder so a bypassing call fails
> 401 rather than spending, and `usage` on oracle replies is zeroed so no spend can be
> booked. Weigh those in when judging.
>
> Either way, **record the flat reading and your reasoning in the run report** — whether
> you halted or kept going.

If the **highest active limit** in `limits[]` (session *and* weekly — §1.2) is < ~75%,
return to §3 with a fresh batch **immediately** — do not write the report, do not
summarize, do not hand back. At ~75% on any of them, go to §6a. The run ends only
when a guardrail above trips.

> Note the asymmetry: the flat-usage check is the one stop condition that asks for
> judgment, and the judgment it asks for is *whether to stop*. Everything else in §6
> pushes toward continuing. A flat reading you have explained is a reason to keep
> going, not a reason to pause and check in.

### 6a. Crossing the window boundary — park, wait, resume

At ~75% utilization the window is effectively spent. Note the asymmetry between the two
caps: near the **five-hour** boundary requests do eventually start being refused, but at
the **weekly** boundary they do not — with extra usage enabled you can author straight
through it onto credits (§1.2), so nothing external will stop you. Park on either. The
run does not end there — it **pauses**. Three steps:

**1. Park the current batch cleanly.** Do not abandon mid-script. Either finish the
script in flight and stop before starting the next, or stop where you are — both are
safe, because an incomplete row simply stays `discoverable = FALSE` and a later
`promote-discoverable.js --words=<batch>` picks it up once its steps land. What is
*not* safe is leaving `server/logs/oracle-answers.jsonl` ambiguous: it is the run's
memory across the gap, so leave it intact (append-only, last-line-wins) and never
`rm` it at a boundary. Only `oracle-prompts.jsonl` is per-script disposable.

**2. Write the resume note** to `$ORACLE_RESUME_FILE` if that variable is set, else
`server/logs/oracle-resume.md` (gitignored scratch,
overwritten each boundary). This is the *only* prose allowed before §7, and it is for
you, not the user — keep it terse:

```markdown
# Oracle run — parked <UTC timestamp>, resumes <resets_at>
Batch: <the exact --words= list>
Scripts done: tones, numbered-pinyin, …
Script in flight: backfill-example-sentences (apply reported Failed : 4 — the
  per-sentence label link for 点字/高音 still needs authoring)
Scratch files: $SP/zhbatch4.txt, $SP/zhsent4.py, …
Carry to the §7 report: <cluster-review flags, dropped words, findings so far>
```

The report notes accumulated so far live here too. Everything §7 asks for must
survive the gap — a boundary that loses the run's findings has cost more than the
budget it saved.

**3. Wait out the window, then resume.** Compute the seconds to `resets_at` and sleep
them out in a **background** shell command; when it exits you are re-invoked and the
run continues:

```bash
# background this; on exit, resume at §1 → §2 → §3 with a fresh batch
python3 -c "
import json,urllib.request,os,time,datetime
tok=json.load(open(os.path.expanduser('~/.claude/.credentials.json')))['claudeAiOauth']['accessToken']
r=urllib.request.Request('https://api.anthropic.com/api/oauth/usage',
  headers={'Authorization':'Bearer '+tok,'anthropic-beta':'oauth-2025-04-20'})
ra=json.load(urllib.request.urlopen(r))['five_hour']['resets_at']
if not ra: raise SystemExit('no open window')
d=(datetime.datetime.fromisoformat(ra)-datetime.datetime.now(datetime.timezone.utc)).total_seconds()
print('sleeping', int(d)+60); time.sleep(max(0,d)+60)"
```

On resume: **re-check §1** (utilization should read ~0 and `resets_at` may be `null`
until the first request opens the new window), **take a fresh §2 backup** — every
window is a new run for backup purposes, no exceptions — read
the resume note (`$ORACLE_RESUME_FILE` if set), and pick the parked batch back up at the script it
names. Then keep looping §3 → §5 as before.

If the wait cannot be bridged (the conversation ends first, the context runs out),
that *is* stop condition 4 — write the §7 report from the resume note before the
session dies if you have the budget for it, and otherwise leave the resume note as
the handoff. A later invocation of this skill should read
the resume note (`$ORACLE_RESUME_FILE` if set) first and continue that run rather than starting a
fresh one.

## 6b. Unattended and parallel rounds

`server/scripts/backfill/oracle-cron.sh` runs one round with no human present. The
answerer is a Claude session, so this is a `claude -p '/oracle-backfill'` invocation,
not a headless node process — and it must run **on the prod box**, because
`run-prod.sh` reaches the DB at `127.0.0.1:5432` (published on loopback only). A
cloud scheduled agent cannot do this.

Every invocation takes a non-blocking `flock`. A round that overruns its tick makes
the next tick exit 0 rather than starting a second session, so over-scheduling is
harmless — the lock, not the cron expression, guarantees one worker per shard. It
also preflights `check-manifest-sync.js` and **aborts on drift**, because a manifest
behind its script makes the planner under-report stale rows and an unattended round
would silently enrich the wrong set.

### Running workers in parallel

Concurrent rounds collide in two places, and both must be handled:

1. **Batch selection.** Every planner scope is a deterministic `ORDER BY … LIMIT N`
   with no claim or lease, so two workers get **byte-identical batches** and race the
   same rows. Fix: `oracle-plan.js --shard=k/N`, which partitions candidates by
   `id % N`. Sharding is used rather than a lease because a round spans many separate
   `npx tsx` processes over ~20 minutes — Postgres advisory locks release between
   scripts and would protect nothing, and a lease column would need a migration. Each
   shard still applies the full commonness `ORDER BY` inside its own slice, so every
   worker stays at the frequency frontier.
2. **Shared scratch files.** `oracle-prompts.jsonl` / `oracle-answers.jsonl` are
   overridable via `BACKFILL_ORACLE_PROMPTS` / `BACKFILL_ORACLE_ANSWERS` (honored in
   `run-log.js`); the parked-run note (§6a) and the run notes are single fixed paths
   by default. `oracle-cron.sh` namespaces all four per shard automatically.

`SHARD=k/N oracle-cron.sh` wires both together. Per-row DB writes are then disjoint,
since every script is `--words=` scoped to its own batch.

⚠️ **Parallelism does not create capacity.** All workers draw on the same account
budget, so N workers spend the same weekly pool N times faster. Check `seven_day`
utilization in §1.2 before adding workers — if it is near 100%, more workers buy
nothing.

## 7. Write the run report — required, and ONLY at the end

**Do not write the report until a §6 guardrail has ended the run.** The report is the
final act of the whole run, not a per-round — or **per-window** — artifact. Writing
one mid-run burns budget on prose instead of enrichment and tempts you to treat it as
a stopping point, and a window boundary is exactly the moment that temptation looks
most reasonable. At a boundary you write the terse resume note (§6a step 2) and
nothing else. Carry per-round notes there and write this document once, covering
every round of every window the run spanned.

Write `docs/oracle-runs/oracle-run-<UTC-timestamp>.md` covering:

- **Session budget**: one row per window the run spanned — window start/end,
  utilization before/after, rounds completed in it, and how long the §6a park lasted.
  State plainly which guardrail ended the run.
- **Backup**: path from §2, plus the restore command.
- **Words**: every word newly marked discoverable (id + pronunciation), and every
  already-discoverable row refreshed and why (null column vs `--stale`).
- **`--new` rounds (§3b)**: every word promoted to `discoverable` (id + level assigned),
  every word the promoter rejected with its printed blocker, and the corpus counters
  before/after (`discoverable` vs corpus total). Note which words were left
  un-promoted for a later round, and why.
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
- **Content-policy drops**: how many words this run dropped per §3c (slur /
  explicit-sexual), pointing at `server/logs/oracle-concerns.md` for the detail
  rather than repeating every line.

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
