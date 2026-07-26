# Migration & Deployment Runbook — `longDefinition` per (sense, POS)

> Child of [DEFINITION_MAPPING.md](./DEFINITION_MAPPING.md) (form #5). Companion:
> [DEFINITION_CLUSTERS.md](./DEFINITION_CLUSTERS.md).
>
> **Audience: the agent performing this deployment.** Follow the steps in order.
> Everything you need to run is spelled out; where a judgment call is needed, it says
> so and tells you to ask the user. Report back using the template in §11.

---

## 1. What is changing

`dictionaryentries_zh."longDefinition"` changes **shape**, not type:

| | Shape | Written by |
|---|---|---|
| **Before** (script v13) | JSONB **object keyed by POS** — `{"noun": "…", "verb": "…"}` | `chinese/backfill-long-definitions.js` v13 |
| **After** (script v15) | JSONB **array, one element per (sense, POS) pair** — `[{"sense","pos","definition"}, …]` | `chinese/backfill-long-definitions.js` v15 |

Two behavior changes ride along:

1. **The anchor sentence is gone.** v13 opened clean-match definitions with the verbatim
   `"Matches the common English definition for <gloss>."` That read as noise once several
   senses were on screen, and it restated a gloss the learner is already looking at.
2. **Learner surfaces show ONE sense.** The eip Definition tab and both cdps render only
   the sense the card is on (all of that sense's POS blocks). The validator review document
   still shows every pair.

**Spanish (`dictionaryentries_es`) is untouched** — no sense clusters there, so it keeps the
per-POS object and its own script. Do not run the zh backfill against es.

### The one hard ordering rule

> **Deploy the code BEFORE regenerating any data.**

Old code + new data renders garbage: the pre-deploy read boundary
(`longDefObjectToDisplayString`) calls `Object.entries()` on the value, so an array becomes
`"0: [object Object]\n\n1: [object Object]"` in the eip. The reverse is safe — new code
reads the legacy object shape correctly and indefinitely.

---

## 2. What you do NOT have to do

- **No type migration.** The column is already `jsonb` on both det tables (migration 70).
  Verified: `information_schema.columns` reports `jsonb` for `dictionaryentries_zh` and
  `dictionaryentries_es`.
- **No backfill of old rows at deploy time.** Legacy objects keep rendering. Regeneration
  (§7) is a separate, resumable, interruptible step. If you deploy the code and stop, the
  app is fully correct — just not yet sense-aware.
- **No client cache to bust.** The API never ships the raw column; it ships a resolved
  string plus `longDefinitionSenses`. An old cached payload is a plain string and still renders.

### One migration to run: `124-longdefinition-per-sense-comment.sql`

Comment-only (`COMMENT ON COLUMN` for both det tables), idempotent, no data change. It exists
because migration 70's column comment still describes the per-POS object. Run it with the
normal `/deploy` migration step. **Already applied on dev.**

---

## 3. Pre-flight: read this first, then take a census

1. **Read [amIOnTheProdMachine.md](../amIOnTheProdMachine.md).** It decides your role — see
   `/deploy`. On DEV you build/test/commit/push only; on PROD you run the deploy.
2. **Know where prod postgres is.** `server/scripts/backfill/run-prod.sh` (the only supported
   way to run a backfill against prod) talks to `cow-postgres-prod` on `127.0.0.1:5432` and
   needs `POSTGRES_PASSWORD` in the **repo-root `.env`**. At the time this doc was written the
   dev box had only `cow-*-local` containers running, so **the data step (§7) cannot run from
   dev** — it must run wherever `cow-postgres-prod` lives. Confirm with
   `docker ps --format '{{.Names}}' | grep prod` before planning §7.

Census (run against **prod**; substitute your psql invocation):

```sql
SELECT
  count(*) FILTER (WHERE discoverable)                                            AS discoverable,
  count(*) FILTER (WHERE discoverable AND jsonb_typeof("longDefinition") = 'object') AS legacy_per_pos,
  count(*) FILTER (WHERE discoverable AND jsonb_typeof("longDefinition") = 'array')  AS already_per_sense,
  count(*) FILTER (WHERE discoverable AND "longDefinition" IS NULL)                AS missing,
  count(*) FILTER (WHERE discoverable AND "definitionClusters" IS NULL)            AS unclustered_blocked,
  count(*) FILTER (WHERE discoverable AND "partsOfSpeech" IS NULL)                 AS no_pos_blocked
FROM dictionaryentries_zh WHERE language = 'zh';
```

`legacy_per_pos` is your regeneration workload. `unclustered_blocked` and `no_pos_blocked`
are rows the backfill **skips** — handle them in §6. For reference, dev showed
`930 discoverable / 928 legacy / 2 per-sense / 0 unclustered / 0 no-pos`.

Also count the rows that will be **skipped on purpose** (validator-reviewed):

```sql
SELECT count(DISTINCT d.id)
FROM dictionaryentries_zh d
JOIN validations v ON v."dictionaryEntryId" = d.id AND v.field = 'definitions'
WHERE d.language = 'zh' AND d.discoverable;
```

---

## 4. Back up the column before regenerating

Regeneration is destructive per row (`UPDATE … SET "longDefinition" = …`). Take a snapshot
**on prod, immediately before §7**:

```sql
CREATE TABLE IF NOT EXISTS longdefinition_backup_v13 AS
SELECT id, word1, language, "longDefinition", "enrichmentLog"
FROM dictionaryentries_zh
WHERE language = 'zh' AND "longDefinition" IS NOT NULL;

-- Sanity: must equal legacy_per_pos + already_per_sense from the census.
SELECT count(*) FROM longdefinition_backup_v13;
```

Keep the table until the user confirms the new definitions look right; then ask before
dropping it. It is small (text only) and holds no user data.

---

## 5. Deploy the code

Use the **`/deploy` skill** — do not improvise the container commands. Notes specific to this change:

- Migration to apply: **124** (§2). Nothing else.
- Both halves must ship together (single build): server (read boundary, DAL, controller
  ordering) and client (`resolveLongDefinitionForSense`, the two display call sites).
  There is no server-only or client-only intermediate state that works.
- `npm run build` and both typecheck targets (`tsconfig.app.json`, `server/tsconfig.json`)
  were clean at authoring time. If a typecheck fails, stop and report — do not patch around it.

### Smoke test BEFORE touching data

With new code live and **all data still legacy**, confirm the legacy path renders:

1. Open a saved zh card's eip → **Definition** tab. Text must appear, correctly formatted,
   with `pos: …` blocks separated by blank lines for multi-POS words.
2. Open a dictionary lookup cdp for a zh word → Definition box populated.
3. As a validator account, open a "Definitions & Parts of Speech" validation doc and hit
   **Approve**. This must return 200 — that path calls `longDefToDisplayString` on the raw
   column, and a regression there previously produced a 500 on every Approve.

If any of these fail, **stop and roll back the code** (§9). Do not proceed to regeneration.

---

## 6. Prerequisite: clustering must come first

`backfill-long-definitions.js` v15 takes its senses (and the POS list per sense) from
`definitionClusters`, and its WHERE clause requires `definitionClusters IS NOT NULL`,
`jsonb_array_length("definitionClusters") > 0`, and non-empty `partsOfSpeech`. Unclustered
rows are silently not selected — they will keep their legacy object forever if you skip this.

If the census showed `unclustered_blocked > 0`:

```bash
server/scripts/backfill/run-prod.sh scripts/backfill/chinese/backfill-cluster-definitions.js
```

Clustering itself needs `partsOfSpeech` + `frequencyScore` populated first (its
single-definition fast path copies them). If `no_pos_blocked > 0`, run
`backfill-parts-of-speech.js` and `backfill-frequency-score.js` before clustering — this is
the standard order in `/mark-discoverable` §A3 and in `server/scripts/run-discoverable-enrichment.sh`.

**Surface every `⚠ CLUSTER REVIEW` line clustering prints** to the user before continuing —
a wrong sense/reading here propagates into the long definitions you are about to generate.

---

## 7. Regenerate the data

```bash
# Full sweep: NULL rows plus every row stamped below v15 (i.e. all v13/v14 rows).
server/scripts/backfill/run-prod.sh scripts/backfill/chinese/backfill-long-definitions.js --stale

# Preview on a handful first (5 rows, still WRITES — there is no dry-run):
server/scripts/backfill/run-prod.sh scripts/backfill/chinese/backfill-long-definitions.js --stale --spot-check

# Targeted regeneration / re-do of one word (bypasses the discoverable + IS NULL gates):
server/scripts/backfill/run-prod.sh scripts/backfill/chinese/backfill-long-definitions.js --words=坏,说
```

**`--stale` is required.** Without it the WHERE clause is `"longDefinition" IS NULL`, which
matches nothing, and the run will report "Nothing to process" while every row keeps the old shape.

### Cost and time — plan the batching

Measured on dev at v15 (2 words, includes the Opus retry ladder):

| | Observed |
|---|---|
| Wall clock | **~26–31 s per entry** |
| Cost | **~$0.045 per entry** (Sonnet generate+validate, Opus retry/choose/tighten) |

So **~1000 entries ≈ 8 hours and ≈ $45**. Extrapolate from the census, tell the user the
number **before** you start, and get their go-ahead if it exceeds what they expected.

Note the prompt-cache characteristic: the per-entry sense list lives in the cached system
block, so each new word pays a cache **write** rather than getting a cheap read. That is a
known cost regression versus v13 (whose system block was byte-identical across a whole run).
Do not restructure the prompt to fix it during a migration; flag it as follow-up work.

### Interruptions and resumption

The script commits and stamps **per row**, so it is safe to kill and safe to re-run: a
completed row is stamped at v15 and `--stale` will not pick it up again. Prefer running it
inside `tmux`/`nohup` for a long sweep. Re-running after a crash costs nothing extra.

### Rows the run will skip, by design

- **Validator-reviewed rows** (`validations.field = 'definitions'`, approve *or* flag) are
  protected by `validatedClause` and keep their legacy per-POS object. This is correct — human
  review outranks regeneration — and it means a few rows stay non-sense-aware. Report the
  count; converting them requires the user to decide to re-review those words.
- **Unclustered / POS-less rows** — see §6.
- Non-discoverable rows (unless you pass `--words=`).

### Review sweep (required)

The run prints, for any definition that still cites the headword after one automatic repair
pass:

```
⚠ LONGDEF REVIEW <word> (id=…): cites the headword (or a compound containing it) after one repair pass — <sense> (<pos>)
```

Capture every such line and the `Flagged for review: N entries` tally, and surface them to the
user. These are **quality nits, not failures** — the text is written and renders fine. The fix
is a re-run with `--words=<word>` or a hand edit. Rationale in the script header: the LLM
validator/chooser enforce the no-headword-citation rule unreliably, so the check is deterministic.

---

## 8. Verify

**A. Shape census** — `legacy_per_pos` should now be only the intentionally-skipped rows:

```sql
SELECT jsonb_typeof("longDefinition") AS shape, count(*)
FROM dictionaryentries_zh WHERE language = 'zh' AND "longDefinition" IS NOT NULL
GROUP BY 1;
```

**B. Every element well-formed** — must return 0 rows:

```sql
SELECT d.word1, e
FROM dictionaryentries_zh d, jsonb_array_elements(d."longDefinition") e
WHERE jsonb_typeof(d."longDefinition") = 'array'
  AND (e->>'sense' IS NULL OR e->>'definition' IS NULL OR length(e->>'definition') = 0)
LIMIT 20;
```

**C. Every `sense` label joins to a real cluster** — must return 0 rows. Non-zero means the
label drifted and readers will silently fall back to the default sense:

```sql
SELECT d.word1, e->>'sense' AS orphan_sense
FROM dictionaryentries_zh d, jsonb_array_elements(d."longDefinition") e
WHERE jsonb_typeof(d."longDefinition") = 'array'
  AND NOT EXISTS (
    SELECT 1 FROM jsonb_array_elements(d."definitionClusters") c
    WHERE c->>'sense' = e->>'sense')
LIMIT 20;
```

**D. No headword citations** — must return 0 rows (the deterministic guard's invariant):

```sql
SELECT d.word1, e->>'sense', e->>'pos'
FROM dictionaryentries_zh d, jsonb_array_elements(d."longDefinition") e
WHERE jsonb_typeof(d."longDefinition") = 'array'
  AND (e->>'definition') LIKE '%' || d.word1 || '%'
LIMIT 20;
```

**E. No anchor sentences survive in regenerated rows** — must return 0 rows:

```sql
SELECT d.word1
FROM dictionaryentries_zh d, jsonb_array_elements(d."longDefinition") e
WHERE jsonb_typeof(d."longDefinition") = 'array'
  AND (e->>'definition') LIKE 'Matches the common English definition%'
LIMIT 20;
```

**F. UI check (the part SQL cannot prove).** Pick a multi-sense word you regenerated (坏 and
说 are good, and 坏 exercises the two-POS case):

1. flp card → open the eip **Definition** tab. Note the text.
2. Change the sense in the card's sense picker. **The Definition tab text must change with
   it**, without a reload — that is the whole point of shipping every sense to the client
   (`longDefinitionSenses` + `resolveLongDefinitionForSense`). If it does not change, the
   payload is missing `longDefinitionSenses`; report that.
3. For a sense with two parts of speech, both blocks must show, labeled `adjective:` /
   `verb:` and separated by a blank line.
4. Embedded Chinese (rare now) must still render as inline cpcd with a tappable popup.
5. Saved-card cdp and dictionary cdp: same sense-following behavior.
6. Validator Approve on a regenerated word: 200, and the review document lists **every**
   (sense, POS) pair, not just the displayed one.

**G. API spot check** — `GET /api/dictionary/lookup/坏` (authenticated) must return
`longDefinition` as a **string**, plus a `longDefinitionSenses` array. If `longDefinition`
comes back as an array/object, an endpoint is bypassing the enrichment — report it.

---

## 9. Rollback

**Before regeneration (code only):** plain code rollback via `/deploy` on the previous commit.
Nothing to undo in the DB — the comment migration is harmless either way.

**After regeneration:** the old code cannot read the new shape (§1), so you have two options:

1. **Preferred — roll forward.** Keep the new code; fix whatever is wrong in the data by
   re-running the backfill for the affected words (`--words=…`).
2. **Full revert.** Restore the column, then roll the code back:

```sql
UPDATE dictionaryentries_zh d
SET "longDefinition" = b."longDefinition", "enrichmentLog" = b."enrichmentLog"
FROM longdefinition_backup_v13 b
WHERE d.id = b.id;
```

Restoring `enrichmentLog` too is deliberate: it puts the v13 stamp back, so a later `--stale`
run re-does those rows instead of thinking they are current. **Confirm with the user before
running a full revert** — it discards generated content they may have already reviewed.

---

## 10. Known side effects to mention, not fix

- **Lazy enrichment will re-run this step per word.** The manifest version bumped 13 → 15
  (`server/scripts/backfill/shared/lib/requiredScripts.js`), so every discoverable zh row is
  "pending" for long-definitions until regenerated, and the on-first-sort lazy worker
  (`run-lazy-enrichment.js`, [DISCOVER_LAZY_ENRICHMENT.md](./DISCOVER_LAZY_ENRICHMENT.md))
  will heal rows in place as learners encounter them — spending API budget gradually. Doing
  the §7 sweep up front avoids the drip. **Sortability is unaffected**: `PRE_PASS_STEP_IDS`
  is only `process-definitions-array` + `hsk-level`, so no row gets demoted by the bump.
- **`definitionsApproved` is not invalidated.** Reviewed rows are skipped, so their stored
  approval still matches their (unchanged) content. Regenerated rows had no approval to lose.
- **Game/word-search payloads carry the raw column.** `OnDeckVocabService.getGameVocabPool`,
  `getWordSearchGrid`, and `getCategoryCounts` select `DICT_COLS` without calling
  `enrichLongDefinitionMetadataBatch`, so `longDefinition` rides along un-normalized (an array
  now, an object before). Pre-existing, and nothing renders it there — but if a future surface
  displays a long definition from one of those payloads it must call the enrichment first.
- **Stale fresh-install schema files.** `database/deploy/01-schema.sql` and
  `database/init/04-dictionary-schema.sql` still declare `"longDefinition" TEXT`. Existing
  installs are fine (migration 70 converted them, migration 124 only re-comments), but a
  brand-new install created from those files would get a TEXT column and store the JSON as a
  string, which the read boundary would pass through verbatim as visible JSON. **Ask the user
  before editing those files** — they are outside this change's scope and may be stale for
  other reasons too.
- **Dev/prod drift.** Dev already holds a few v15 rows (坏, 说) from testing. After the prod
  sweep, `/data-pull` brings dev in line with prod.

---

## 11. Report back to the user

Include:

1. Census before/after — legacy vs per-sense counts, and how many rows were skipped for each
   reason (validator-reviewed / unclustered / no POS).
2. Actual cost and wall-clock spent, versus the estimate you gave up front.
3. Every `⚠ LONGDEF REVIEW` line, and every `⚠ CLUSTER REVIEW` line if you ran clustering.
4. Verification results A–G, naming any that did not come back clean.
5. Whether `longdefinition_backup_v13` still exists and your recommendation on dropping it.
6. Anything from §10 you noticed in practice.

---

## Code this doc depends on

| Concern | Code |
|---|---|
| Generation | `server/scripts/backfill/chinese/backfill-long-definitions.js` (v15; `buildSlots`, `parseDefArray`, `headwordCitations`, `repairHeadwordCitations`, `finalizeDefinition`, `REVIEW_MARKER`) |
| Read boundary | `server/utils/definitions.ts` (`resolveLongDefinition`, `longDefEntriesForSense`, `joinSenseEntries`, `longDefToDisplayString`, `resolveSelectedCluster`) |
| Payload build | `server/dal/implementations/DictionaryDAL.ts` (`mapRowToEntity`, `enrichLongDefinitionMetadataBatch`, `segmentLongDefinitionTexts`) |
| Sense-pick ordering on lookup | `server/controllers/DictionaryController.ts` (`lookupTerm` — `selectedSense` must be attached BEFORE the long-def enrichment) |
| Validator document | `server/utils/validationBodyFormat.ts`, `server/services/ValidationService.ts` |
| Client resolution | `src/utils/definitionUtils.ts` (`resolveLongDefinitionForSense`), `src/features/flashcards/FlashcardsLearnPage/InfoCardPanelBody.tsx`, `src/features/flashcards/VocabCardDetailBody.tsx` |
| Pipeline order / versions | `server/scripts/backfill/shared/lib/requiredScripts.js`, `.claude/commands/mark-discoverable.md` §A3, `server/scripts/run-discoverable-enrichment.sh` |
| Migration | `database/migrations/124-longdefinition-per-sense-comment.sql` (and 70, 90, 99, 104 for context) |
