# Discover Lazy Enrichment — show every det entry, enrich on first sort

> **STATUS: PARTIALLY IMPLEMENTED** (2026-07-17). Shipped: the `sortable` column
> (migration 110), the discover supply-gate flip to `sortable` (zh), the one-time
> reconciliation that promoted every already-fully-run row to `discoverable`, the
> required-scripts manifest, the per-word step runner (`run-lazy-enrichment.js`), and
> the **request-time, validator-gated triggers** (`LazyEnrichmentService`, fired from
> the cdp lookup + the sort commit — §5) that replaced the standing cron. **Still
> deferred: the Batches-API port** of the AI backfill steps and the corpus pre-pass run
> (§4/§6) — steps run SERIALLY today.
>
> **SCOPE: Chinese (`dictionaryentries_zh`) ONLY.** Spanish is explicitly out of
> scope for this change — the es pipeline differs (no `backfill-hsk-level`
> equivalent writes `difficulty` today) and would be planned separately. Spanish
> discover queries keep gating on `discoverable` (no `sortable` column).
>
> Related: [DISCOVER_FLOW.md](./DISCOVER_FLOW.md) · [SORT_CARDS_REQUIREMENTS.md](./SORT_CARDS_REQUIREMENTS.md) ·
> [`.claude/commands/mark-discoverable.md`](../.claude/commands/mark-discoverable.md) ·
> [VOCAB_ENRICHMENT_IMPLEMENTATION.md](./VOCAB_ENRICHMENT_IMPLEMENTATION.md)

## 1. Goal

Today the discover flows (Sort Cards, Quick Mark, Skipped) only surface the tiny
curated set of **fully-enriched, `discoverable = TRUE`** Chinese entries (148 on
dev). The rest of `dictionaryentries_zh` (~114k rows) is invisible.

We want **every zh det entry to be sortable**, while keeping the expensive
per-word AI enrichment (the 13-step Chinese pipeline) **off the critical path**.
The model is two phases:

1. **Corpus pre-pass** — run the *minimum* backfill on **all** rows so a card can
   appear and render a good face. This doc's cost analysis covers exactly two
   scripts: **`backfill-hsk-level` (difficulty)** and
   **`backfill-process-definitions-array`**.
2. **On-first-sort enrichment** — when a user first sorts a card, enqueue the
   **full remaining backfill suite** for that one word, then promote it to
   `discoverable = TRUE`.

## 2. What actually gates a card in the discover flows

Layer: **service** — `server/services/StarterPacksService.ts`. Every supply query
(`_fetchSupplyRows` `:317`, `listQuickMarkCards` `:448`) applies two hard gates:

| Gate | SQL fragment | Passing rows (dev zh) |
|---|---|---|
| **Curation flag** | `de.discoverable = TRUE` | 148 |
| **Valid level** | `de.difficulty BETWEEN 1 AND 6` (`validPredicate` `:187`) | 832 |

Corpus total: **114,774 zh**. `difficulty` is `NULL` on **113,942** rows — so the
*level* gate, not the `discoverable` flag, is the dominant blocker.

### Field tiers (from `_rowsToDiscoverCards` `:126`)

| Tier | Fields | Coverage (zh) | Role |
|---|---|---|---|
| **1 — must exist to APPEAR** | `difficulty` ∈ 1..6 | 832 / 114,774 | `validPredicate` hard-filter |
| **2 — render the card face** | `word1`, `definitions[0]`, `pronunciation`, `tone` | 114,673–114,772 | already present corpus-wide (cedict import + tone pass) |
| **3 — AI enrichment (eip tabs)** | `vernacularScore`, `breakdown`, `synonyms`, `exampleSentences`, `longDefinition`, `partsOfSpeech`, `wordForms`, `definitionClusters`, `classifier` | ~831 or fewer | nullable, feed flashcard tabs, deferrable |

**Why the pre-pass is these two scripts specifically:**
- **`difficulty`** is Tier-1 — without it the card is filtered out entirely.
- **`process-definitions-array`** upgrades Tier-2 quality: it reorders/prunes the
  raw cedict `definitions` and synthesizes a short (≤20 char) lead gloss. The
  card face shows `definitions[0]`, so this is what makes the surfaced gloss
  clean rather than a long/poorly-ordered raw cedict string.

Everything in Tier 3 is deferred to on-first-sort.

## 3. The `sortable` column — decoupling "showable" from "fully enriched"

`CLAUDE.md` declares it **"illegal"** to set `discoverable = TRUE` outside the
`/mark-discoverable` pipeline, because that flag currently means "fully enriched
and safe to ship." This plan needs cards visible in discover **before** full
enrichment, which conflicts with that meaning. We therefore split the two concepts.

**IMPLEMENTED (migration 110, `database/migrations/110-add-sortable-to-zh.sql`):
`sortable BOOLEAN NOT NULL DEFAULT false` on `dictionaryentries_zh`.**

- **`sortable`** — "level-assigned (`difficulty` ∈ 1..6) + lead gloss cleaned; safe
  to show as a sort card." The pre-pass (§4) will set it TRUE on newly-processed
  rows. **Discover supply queries now gate on `sortable = TRUE` for zh** via the
  `StarterPacksService._supplyGate(language)` helper (returns `de.sortable = TRUE`
  for zh, `de.discoverable = TRUE` otherwise). Wired at `_fetchSupplyRows`,
  `listQuickMarkCards`, and `getProgress`; the `validPredicate` level gate stays.
- **`discoverable`** (unchanged) — still means "fully enriched + data-deployed";
  still gates flashcard/reader/dictionary surfaces and `/data-deploy`.

Migration 110 **backfilled `sortable = TRUE` for existing qualifying rows**
(`discoverable = TRUE OR difficulty BETWEEN 1 AND 6` → 832 rows on dev) and added a
partial index `idx_dictionary_sortable_language (language, difficulty) WHERE sortable`.
Invariant **`discoverable = TRUE ⇒ sortable = TRUE`** is enforced by the backfill and
by the worker's promotion (which sets both).

### 3a. One-time discoverable reconciliation (done 2026-07-17)

**DECIDED: `discoverable` means EXACTLY "forward-manifest-complete" (§5).** The
reconciliation makes the flag agree with the manifest in both directions:

1. **Promote** rows that were fully run but never flagged — 683 non-discoverable rows
   carrying the universal stamp set + valid `difficulty` + populated columns were
   flipped to `discoverable = TRUE` (148 → 831).
2. **Unmark** rows that were flagged but DON'T meet the forward manifest — 558 of those
   831 lacked a stamp for a still-required step (dominated by `process-definitions-array`,
   stamped on only ~99 zh rows, and `example-sentences`). These were flipped back to
   `discoverable = FALSE` **but keep `sortable = TRUE`**, so they still appear as sort
   cards and become lazy-enrichment candidates.

End state (dev): **`discoverable` = 273** (every one PRESENCE-complete), `sortable` = 832.
Rather than a bulk regeneration of the 558, the on-first-sort worker (§5) tops each up
when a user sorts it and re-promotes.

> **Version nuance (added when candidacy went version-aware, §5):** the unmark used a
> PRESENCE bar (script never ran). Under the now version-aware manifest, most of the 273
> `discoverable` rows are *version-stale* on a bumped script (e.g. long-definitions
> v11→v13, example-sentences v2→v6) — on dev only **1 of 273** is fully current-version.
> These were **intentionally NOT unmarked** (that would yank ~272 shipped words from the
> dictionary/reader surfaces). Instead they stay `discoverable` and heal **in place** on
> next sort (the worker's candidacy has no `discoverable = FALSE` filter). So the exact
> invariant is: `discoverable` rows are presence-complete and *converge* to
> version-complete as they are re-sorted — a version bump refreshes, never demotes.

> Zh-only for now (matches the doc scope); an es `sortable` follows if/when es joins.

## 4. Cost analysis — the corpus pre-pass

> **DECISION (2026-07-17): the pre-pass is a single FULL, BATCHED, `--no-critic`
> run** of both scripts over the whole zh corpus. `--no-critic` drops
> `process-definitions-array`'s Pass-2 critic (~half its cost); the independent
> critic look is recovered later by the full pipeline that runs on first sort. See
> §4a for the chosen numbers.

All figures are **real actuals** pulled from `server/logs/backfill-runs.jsonl`
(Sonnet list price $3 in / $15 out per Mtok; the prompt-cache multipliers where
they apply). Per-word rates:

| Script | Model(s) | ~API calls/word | ~tokens/word (in/out) | **$/word (serial, list)** | Source runs |
|---|---|---|---|---|---|
| `backfill-hsk-level` (difficulty) | Sonnet 4.6 | 1 | ~340 / ~6 | **$0.00111** | 49-word: $0.0526/49; stale 683-word: $0.7606/683; single 医生 $0.0011 |
| `process-definitions-array` (with critic) | Sonnet 4.6 (2-pass) + occasional Opus 4.8 | ~1.9 | ~840 / ~145 (+ heavy cacheRead) | **$0.0058** | 49-word runs: $0.2864 & $0.2677 (÷49); 64-id: $0.3952/64 |
| **`process-definitions-array` (`--no-critic`)** | Sonnet 4.6 (Pass-1 + conditional short-gloss) | ~1.2 | — | **~$0.0029** | 5-word spot-check 11→6 calls; steady-state ≈ half the with-critic rate (spot-check $0.0015 is cache-warm-deflated) |

`process-definitions-array` is ~**5×** the cost of `difficulty` because it is a
two-pass Sonnet order/prune + critic, with an occasional Opus retry and a
short-gloss synthesis; multi-sense words cost more (variance is gloss-count driven).

### 4a. Total pre-pass cost (Chinese) — CHOSEN PATH: full, batched, no-critic

The two scripts run over **different row counts**: `hsk-level` needs every row with
a NULL difficulty (**113,942**); `process-definitions-array` only touches rows with
**more than one** definition (**51,153** — single-def words are skipped as there is
nothing to reorder; 63,520 zh rows are single-def).

**Chosen numbers (batched + `--no-critic`):**

| Script | Rows | $/word | **Batched cost** |
|---|---|---|---|
| `hsk-level` (difficulty) | 113,942 | ~$0.00055 (50% of $0.00111) | **~$63** |
| `process-definitions-array` `--no-critic` | 51,153 | ~$0.0029 serial → ~$0.0015–0.0022 batched | **~$75–115** |
| **Total** | | | **~$140–180** |

For reference, the other paths:

| Path | process-defs | Total pre-pass |
|---|---|---|
| **Chosen: batched, no-critic** | ~$75–115 | **~$140–180** |
| batched, with critic | ~$150–230 | ~$215–290 |
| serial, no-critic | ~$148 | ~$274 |
| serial, with critic | ~$297 | ~$423 |

### Levers that cut the number

- **Batches API (50% off) — implemented but never yet used.** The shared runner
  (`scripts/backfill/shared/lib/runner.js`, `runBatched`) fully supports batch
  mode, and `backfill-hsk-level` exposes `--batch` — **but `backfill-runs.jsonl`
  shows 0 real batch runs to date**, so batch pricing/throughput is unproven here.
  `backfill-process-definitions-array` **does not use the shared runner and has no
  `--batch` support** — it must be ported before it can batch (and its 2-pass
  critic means 3 sequential batch rounds, not one; see §6). If both batch,
  difficulty → ~$63 and process-defs → ~$150–230 (51,153 rows), total **~$215–290**.
- **Prompt caching** — `process-defs` already gets large `cacheRead` volumes
  (static system + few-shots cached); the $/word above already reflects that.
  `hsk-level`'s prompt is below the cacheable minimum, so no cache benefit there.
- **Deterministic difficulty** — replacing the Sonnet HSK call with a
  frequency-list (SUBTLEX/cedict-rank) estimate makes the *entire difficulty
  column free and instant*, removing ~$127 and ~50h of runtime. Worth considering
  if exact HSK precision is not required for a *sort* card's level band.

### Throughput (the real constraint)

Serial runtime is the bigger problem than dollars:

| Script | Observed rate | Serial runtime |
|---|---|---|
| `hsk-level` | ~1.66 s/call (stale run: 683 calls / 18m55s) | 113,942 rows → ~**53 hours** |
| `process-defs` | ~6 s/word (49 words / ~5–6 min) | 51,153 rows → ~**85 hours** |

⇒ The pre-pass is **not feasible serially**; it must run via the **Batches API**
(or heavy concurrency). This is the strongest argument for finally exercising
batch mode — and a decision point on whether `process-definitions-array` (which
must first be ported to the shared runner to batch) belongs in the pre-pass at
full-corpus scale or should itself be partially deferred.

## 5. Lazy enrichment — request-time, validator-gated

Layer: **service** — the runtime entry point is
**`LazyEnrichmentService.triggerForWord`** (`server/services/LazyEnrichmentService.ts`),
fired **fire-and-forget** from two request-time trigger points, **both gated to
validator accounts** (`users.isValidator`):

| Trigger | Hook | When it fires |
|---|---|---|
| **on-open** | `DictionaryController.lookupTerm` (after the response) | a validator opens a word's card-detail page — the **eip drill-in link** lands on the cdp, which calls `GET /api/dictionary/lookup/:term` |
| **on-sort** | `StarterPacksService.sortCard` (after the vet upsert) | a validator sorts a card into **Learn Now / Already-Learned** (the `skip` bucket returns early, so it never triggers) |

> **DECIDED (2026-07-17, revised): the standing cron was retired.** Earlier this was a
> cron-style *drain* worker that periodically scanned the derived candidate set. That
> mechanism had no live trigger and no notion of *who* acted, which made "gate to
> validators" awkward. It was replaced by the two request-time triggers above — the
> worker script (`run-lazy-enrichment.js`) survives **only as a manual / bulk backfill
> CLI** (e.g. a one-off re-heal after a big `SCRIPT_VERSION` bump), not as a scheduler.

**Validator gate + why.** All lazy AI spend is bounded to trusted curators: a
non-validator opening or sorting a word is a **no-op**. Validators effectively *prime*
an entry — they are the ones reviewing/curating content (see
[DATA_VALIDATION_SYSTEM.md](./DATA_VALIDATION_SYSTEM.md)), so their engagement is the
natural signal for "spend AI to finish this word."

**Prod caveat.** `triggerForWord` spawns the worker via `npx tsx`, available in **dev**
(`tsx server.ts`). Prod runs compiled `node` with no `tsx`, so the spawn fails
gracefully and the trigger is a **no-op there** — enrichment stays a dev/curation
activity feeding the normal `/data-deploy`, and never mutates prod det rows out-of-band
(consistent with the "illegal to set `discoverable=TRUE` outside `/mark-discoverable`"
rule).

**DECIDED (2026-07-17): no `enrichment_jobs` table.** The "needs enrichment" set is
**derived** from tables/columns we already have — the trigger state cannot be
double-enqueued (one det row per word) and self-heals (a word drops out the moment
it is fully stamped). A per-process `inFlight` set de-dupes concurrent triggers for the
same word. Flow (the candidacy/manifest/`--stale`/approval mechanics below are shared by
both the runtime trigger and the manual CLI):

1. **Candidate predicate** (`buildIncompletePredicate`) — a word needs enrichment when:
   ```
   det.sortable = TRUE
   AND <some applicable, non-approved required script is MISSING
        or stamped BELOW its manifest version>  -- VERSION-incomplete
   ```
   The **runtime trigger** checks this for the ONE word being opened/sorted (plus the
   validator gate) — the acting validator *is* the engagement signal, so no vet-EXISTS
   scan is needed. The **manual CLI** (no live actor) still ANDs in
   `EXISTS (a vet row for word1/language)` to bound a bulk drain to words someone
   engaged with. **Candidacy is VERSION-aware** — a
   version bump makes even an already-shipped word a candidate again, so there is
   **deliberately no `discoverable = FALSE` filter**: a stale `discoverable` row heals
   **in place** (its out-of-date script re-runs and re-stamps; it stays discoverable
   throughout). This is stuck-free because every pipeline script now honors `--stale`.

2. **Completeness = the existing `enrichmentLog` stamps** (migration 68) against the
   **required-scripts manifest** (IMPLEMENTED:
   `server/scripts/backfill/shared/lib/requiredScripts.js`). Every backfill script
   already stamps `det."enrichmentLog" -> {scriptId: {ranAt, version}}` via
   `stampEntries`. The manifest is the ONE ordered list of the zh pipeline's scriptIds
   plus a per-step `when` condition (`always` / `multiChar` / `multiDef` / `nounPos`),
   so conditional steps (breakdown for multi-char, process-defs for
   multi-def, classifier for nouns) are only required where they apply. A word is
   **fully enriched** ⟺ its `enrichmentLog` carries a **current-version** stamp for
   **every applicable required script**. `buildIncompletePredicate(alias)` compiles this to SQL for the
   candidate query; `appliesTo(step,row)`/`isComplete` are the JS twins the worker
   uses. **No new tracking column** — reuse `enrichmentLog`. Each manifest step also
   carries its `version` (= the script's `SCRIPT_VERSION`, kept in sync by hand) and
   its `validationFields`.

   > **Step ids are paths relative to `scripts/backfill/`, not always `chinese/<name>`.**
   > Most steps live under `chinese/`, but the language-shared icon step is the bare id
   > `backfill-icons` (`scripts/backfill/backfill-icons.js`, `--lang=zh|es`). The worker's
   > `scriptPathFor` therefore resolves the id **as given** (`path.join(__dirname, id)`)
   > rather than forcing `basename(id)` into `chinese/`. `backfill-icons` runs after
   > `parts-of-speech` (its icons8 search-term cascade keys off the finalized
   > `definitions[0]`), is `deterministic: true` — no LLM — but is the one step that makes
   > outbound HTTP calls, so an oracle run cannot answer it locally. It stamps even when
   > icons8 returns no match (`iconId` stays NULL), so an unmatchable word still completes
   > and can be promoted.

3. **Runner executes a word's pending steps** — the runtime trigger spawns
   `server/scripts/backfill/run-lazy-enrichment.js --words=<word> --apply --stale` for
   the single triggered word; the same script run without `--words` is the manual/bulk
   drain (selects the next N candidate words, most-recently-sorted first). Either way it
   runs each word's **pending steps** scoped to it (`--words=<word> --stale`),
   **SERIALLY** (one child
   `npx tsx <script>` per step — the Batches-API port is deferred, §6). `pendingSteps`
   is **version-aware and targeted**: a step is pending iff it applies, is not
   approval-protected, and is **missing OR stamped below its manifest `version`** — so a
   bumped script re-runs **only that one script**, never "stale everything". Manifest
   order encodes the `mark-discoverable.md` §A3 constraints (POS → word-forms / long-def
   / example-sentences; vernacular + POS → cluster-definitions → example-sentences).
   **Dry-run by default** (prints candidates + planned commands, writes/spends nothing);
   `--apply` spawns steps and promotes.

   > **Every pipeline script now honors `--stale`** (ORs `staleClause()` into its
   > null-column doneGate) **and drops its `discoverable = TRUE` gate when `--words` is
   > targeted** — so a targeted re-run actually re-processes a populated below-version
   > row AND works on a not-yet-discoverable candidate. (`backfill-vernacular-score` also
   > gained `--words` support, which it lacked.) `process-defs` re-processes multi-def
   > rows regardless (no null gate); its targeted branch also gained the `validatedClause`
   > guard it was missing. Deterministic `tones` / `numbered-pinyin` honor `--stale` too,
   > so a populated-but-unstamped row can be stamped and reach completeness.

4. **Honor validator-approved fields** — IMPLEMENTED at TWO layers. (a) Each content
   script already self-skips approved fields via `validatedClause` (migration 104):
   `process-defs` / `parts-of-speech` / `long-definitions` guard `definitions`;
   `example-sentences` guards `exampleSentence0..2`. (b) The worker mirrors this — the
   manifest's `validationFields` + a `validations` lookup mean `pendingSteps` **never
   runs** an approval-protected step and `isComplete` **never waits** on its stamp. That
   second layer matters: without it, an approved-`definitions` word would have
   `process-defs`/`parts-of-speech`/`long-definitions` self-skip (no stamp) and could
   never reach completeness → never promote. Approve OR flag both protect (matches
   `validatedClause`).

5. **Promote on completion** — after a word's steps run, the worker re-reads its
   stamps and, iff the manifest is satisfied, flips `discoverable = TRUE` (and
   `sortable = TRUE`). The word drops out of the candidate predicate and is eligible
   for the next `/data-deploy`. A step that exits non-zero aborts that word (no
   promotion), leaving it a candidate for the next drain.

Bounding spend: the runtime trigger fires **one word per validator open/sort**, deduped
by the in-process `inFlight` set (concurrent triggers for the same word collapse to one
worker), and gated so **only validators** spend. The manual CLI keeps its per-run word
cap (`--limit`, default 25) for controlled bulk drains. In both cases the trigger is
idempotent table state, not an emitted job, so there is nothing to throttle beyond
these gates.

> The **"required scripts" manifest** (`requiredScripts.js`) is now the single
> authoritative list feeding both the completeness check and the worker's step
> sequence — it replaces what a jobs table's status column would have implied.

## 6. Batch API strategy for the enrichment scripts

**Decision (2026-07-17): always run the AI backfill steps via the Batches API**
(`--batch`), and port every AI step to support it. Latency is a non-concern for
both the corpus pre-pass and the on-first-sort queue (both are async/background).

### Is there a cost con to batching? — No.

Batch is always ≥ as cheap as serial; the margin varies by cache ratio:
- `hsk-level` (no prompt caching, prefix below cacheable minimum) → full **50%** off.
- `process-definitions-array` (heavy `cacheRead` — ~57% of input is cache reads at
  0.1× in serial) → serial already captures most of the cache saving, so the real
  batch win is ~**20–25%**, not 50% (batch prompt caching is best-effort). Still a
  net saving.

The genuine cost of "always batch" is **engineering**, not runtime: multi-pass
scripts don't map onto the runner's one-request-per-row model without a redesign.

### Current batch support (zh pipeline, 13 steps)

| Support | Steps |
|---|---|
| Deterministic (no AI, no batch needed) | `tones`, `numbered-pinyin` |
| AI + already `--batch`-capable | `hsk-level`, `word-forms`, `classifier` |
| AI, needs porting | `dictionary-breakdown`, `process-definitions-array`, `parts-of-speech`, `long-definitions`, `vernacular-score`, `cluster-definitions`, `example-sentences` |

Batch mode itself (`scripts/backfill/shared/lib/runner.js` `runBatched`) is fully
implemented but **has never actually been run** (0 `--batch` runs in
`backfill-runs.jsonl`) — so the first real port also needs a proving run.

### The runner contract (porting template)

A ported script supplies two pure functions to `runBackfill`
(`shared/lib/runner.js:123`):
- `buildRequest(row)` → the `messages.create` params for ONE entry.
- `handleResponse(row, message)` → parse the single message + write the row.

Reference implementation already in the tree:
`scripts/backfill/spanish/backfill-vernacular-score.js` (single Sonnet call/word).

### Per-script porting classification

| Step | Calls/word | Port effort | Notes |
|---|---|---|---|
| `dictionary-breakdown` | 1 | **Mechanical** | mirror the vernacular-score template |
| `vernacular-score` (zh) | 1 | **Mechanical** | near-identical twin already ported for es |
| `parts-of-speech` | multi | **Redesign** | multi-call per word |
| `example-sentences` | multi | **Redesign** | ~988 loc; enforces ≥1 sentence/POS |
| `long-definitions` | multi | **Redesign** | routes through `DictionaryService.generateLongDefinition` (Haiku), not raw `anthropic` |
| `process-definitions-array` | 2-pass + retry | **Redesign** (full) / **near-mechanical** (`--no-critic`) | With critic: Pass-1 + Pass-2 + Sonnet→Opus retry + short-gloss (sequential rounds). **For the pre-pass `--no-critic` collapses this to Pass-1 (one call/row, batchable directly) + a conditional short-gloss round — no cross-pass dependency, so the pre-pass port is easy.** The full critic port is only needed for the on-first-sort suite. |
| `cluster-definitions` | multi-stage | **Redesign** | Stage A–C + `⚠ CLUSTER REVIEW` human-review flags |

### ⚠ The one architecture decision the redesigns need

The runner batches **one request per row**. A 2-pass critic (`process-defs`) or a
multi-stage flow (`cluster-defs`) has request N+1 depend on request N's output, so
it cannot be a single batch. Options:
- **(a) Sequential batch rounds** — submit Pass-1 as a batch, await it, submit
  Pass-2 as a second batch. Preserves fidelity; N batch waits per script.
- **(b) Collapse to one call** — fold the passes into a single prompt. Cheapest/
  simplest to batch, but changes model behavior (loses the critic's independent
  second look) — a quality regression risk that needs spot-check validation.
This choice must be made per multi-pass script before porting it.

### Applying batch in the mark-discoverable skill

Once all steps support `--batch`, `mark-discoverable.md` §A3 should pass `--batch`
on **every** AI step (flip all at once — a mixed serial/batch pipeline is
confusing and gives up the saving). Deterministic steps (`tones`,
`numbered-pinyin`) stay as-is. Human-review flags (`cluster-definitions`) are
still surfaced *after* that step's batch completes and *before* the dependent
`example-sentences` step runs, so batching does not bypass the review checkpoint.

## 7. Decisions & open questions

**Decided & DONE:**
- ✅ **`sortable`** column on `dictionaryentries_zh` (migration 110); discover queries
  gate on it for zh via `_supplyGate`; migration backfilled qualifying rows (§3).
- ✅ **No `enrichment_jobs` table** — candidate set derived from `sortable` /
  `discoverable` / a vet row / `enrichmentLog` stamps; validator-approved fields honored
  via each script's `validatedClause` (§5).
- ✅ **Required-scripts manifest** (`requiredScripts.js`) — ordered scriptIds + per-step
  `when` conditionality; drives both the completeness check and the worker step order (§5).
- ✅ **On-first-sort worker** (`run-lazy-enrichment.js`) — serial, dry-run-default,
  promotes on manifest completion (§5).
- ✅ **Reconciliation** — 683 fully-run rows promoted; 558 presence-incomplete rows
  unmarked (kept `sortable`). End state: `discoverable` = 273 (§3a).
- ✅ **`--stale` on EVERY pipeline script** — all 9 that lacked it now OR `staleClause()`
  into their doneGate AND drop the `discoverable = TRUE` gate when `--words` is targeted
  (so the worker can enrich not-yet-discoverable candidates). `backfill-vernacular-score`
  gained `--words`; `process-defs`'s targeted branch gained the missing `validatedClause`.
- ✅ **Version-aware candidacy + completeness** — `buildIncompletePredicate` / `isComplete`
  / `pendingSteps` all treat a below-manifest-version stamp as pending; the worker's
  candidate query dropped `discoverable = FALSE` so stale shipped rows heal in place (§5).
- ✅ Pre-pass DECISION recorded = full, batched, `--no-critic` run (§4a) — *not yet run*.

**Open:**
1. **Batch port (DEFERRED, out of current scope)** — port `process-definitions-array`
   (`--no-critic`) + the remaining AI steps to the shared runner so the pre-pass and the
   worker can use `--batch`. Until then the worker is serial and the pre-pass is unrun.
2. **Difficulty: AI vs deterministic** — keep the Sonnet HSK call, or derive `difficulty`
   from a frequency list (free/instant)?
3. **Worker infrastructure — RESOLVED (2026-07-17):** retired the standing cron in
   favour of request-time, validator-gated triggers (`LazyEnrichmentService`). The
   worker survives only as a manual/bulk CLI; the single-worker assumption is moot
   (spend is bounded by the validator gate + in-process `inFlight` dedupe, §5).

## 8. Referenced code

- `database/migrations/110-add-sortable-to-zh.sql` — the `sortable` column + backfill + index (§3).
- `server/services/LazyEnrichmentService.ts` — the request-time, validator-gated trigger
  (`triggerForWord`): zh + `isValidator` + manifest-incomplete gate, `inFlight` dedupe,
  fire-and-forget worker spawn, best-effort prod no-op (§5).
- `server/services/StarterPacksService.ts` — `_supplyGate` (`_levelConfig` neighbour),
  supply gates in `_fetchSupplyRows`, `listQuickMarkCards`, `getProgress`; card mapping
  (`_rowsToDiscoverCards`), sort commit (`sortCard`) — fires the **on-sort** trigger (§5).
- `server/controllers/DictionaryController.ts` — `lookupTerm` fires the **on-open**
  trigger after responding (the eip drill-in / cdp lands here) (§5).
- `server/scripts/backfill/shared/lib/requiredScripts.js` — the manifest + `buildIncompletePredicate` / `appliesTo` (§5).
- `server/scripts/backfill/run-lazy-enrichment.js` — the per-word step runner / manual bulk drain (§5).
- `server/scripts/backfill/chinese/backfill-hsk-level.js` — difficulty (Sonnet).
- `server/scripts/backfill/chinese/backfill-process-definitions-array.js` — lead-gloss cleanup.
- `server/scripts/backfill/shared/lib/runner.js` — serial/batch execution engine (`runBackfill`).
- `server/scripts/backfill/spanish/backfill-vernacular-score.js` — reference batch-ported script.
- `server/scripts/backfill/run-log.js` — pricing table, `enrichmentLog` stamps, `validatedClause`.
- `server/logs/backfill-runs.jsonl` — source of the actuals in §4.
- `.claude/commands/mark-discoverable.md` — the pipeline skill whose §A3 steps gain `--batch`.
