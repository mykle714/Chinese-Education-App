# Gloss Confusability — keeping same-meaning cards off one game board

**Status:** Phase 1 **BUILT** (2026-08-22, no migration). Phase 2 **DESIGN ONLY — nothing
built, no tables created, no models downloaded.** The phase-2 tables in § 5 were
**CONFIRMED 2026-08-22** and may be created when phase 2 is built. Every open design
question in § 10 was answered the same day; § 9 carries the residual risks.

**Build status: DESIGN ONLY, deliberately parked (2026-08-22).** Phase 1 ships and covers
1,235 real word pairs; phase 2 is decision-complete except **C13/Q11** and is not queued. The
validation harness that produced § 8i lives at `server/scripts/gloss-probe/` — the model pins
and `templateVersion` there are the only things that decay while this sits.

**Owner doc for:** the rule that no game may show two cards meaning the same thing at the
same time, and the offline pipeline that would decide what "the same thing" means.

**Read first:** [GAMES_FEATURE.md](./GAMES_FEATURE.md) § "No two cards may share a dd in one
round" (the shipped rule and its three enforcement points),
[DEFINITION_MAPPING.md](./DEFINITION_MAPPING.md) (dd = form #3),
[DEFINITION_CLUSTERS.md](./DEFINITION_CLUSTERS.md) (senses).

---

## 1. The problem

Every game shows its cards **simultaneously**. A flashcard shows one card at a time, so two
entries that display the same English are harmless there. On a game board they are not: a
prompt naming that English has two answers that look correct and only one that scores. It
reads as the game being broken, not as a hard puzzle.

Two tiers of the same problem:

| Tier | Example | Status |
| --- | --- | --- |
| **Identical dd** | 高兴 / 开心 → both "happy"; eight discoverable words → "to get angry" | **Fixed** (phase 1) |
| **Near-identical dd** | 一下 "a little" / 一点 "a bit"; 有点 / 有一点 / 有点儿 | **Not fixed** (phase 2, this doc) |

### Measured, on the live dev corpus (2026-08-22)

Discoverable zh only — the words games can actually serve:

| | |
| --- | --- |
| Discoverable zh det rows | 4,224 (6,072 sense clusters) |
| Distinct dd strings among them | 5,169 |
| dd strings shared by **more than one word** | **635** |
| Words involved in an exact-dd collision | **1,234** (29% of the discoverable corpus) |
| Word pairs caught by the phase-1 guard | **1,235** |

Worst offenders: `"to get angry"` (8 words), `"thing"` (8), `"intention"` (7), `"reason"`
(7), `"time"` (7), `"place"` (6), `"god"` (6), `"expert"` (6).

So the phase-1 guard was load-bearing, not theoretical.

---

## 2. Phase 1 — what is built

`ddCollisionKey` (`server/utils/definitions.ts`) resolves an entry's dd through
`resolveDisplayDefinition` (so the learner's `selectedSense` is honored) and normalizes
case, collapsed whitespace and a trailing period. Two cards collide iff their keys are
equal. Empty keys never collide.

Enforced at three server-side chokepoints — every game's round is assembled server-side,
so the guard lives where cards are *chosen*, not in rendering:

| Chokepoint | Covers | Symbol |
| --- | --- | --- |
| Game pool | Bubble Match, Match Speed, Speed Reading, Hydra | `OnDeckVocabService.getGameVocabPool` → `takenDds` in `drain` |
| Word Search grid | Word Search | `OnDeckVocabService.getWordSearchGrid` → `takenDds` in `drain` |
| Memory Map spawn | Memory Map | `MemoryMapService.spawnInto` → `takenDds` |

Partial refills seed `takenDds` from the dds of the cards the caller is keeping, via
`OnDeckVocabService.fetchDdKeys` over the `exclude` id list. **No client change was needed
and none should be added** — `exclude` is the wire contract, dd resolution is the server's
job.

**Phase 2 does not replace any of this.** It swaps the *key*: `takenDds` becomes a set of
meaning-group ids instead of dd strings, and exact-dd equality survives as the degenerate
case (identical strings always land in the same group). The three chokepoints, the seeding,
and the empty-key rule are unchanged.

---

## 3. Why not the obvious approaches

Recorded because each one looks right until it is costed.

### 3a. word2vec — wrong model class
A per-word lookup table: no phrase handling, no sense awareness. Our dds are phrases —
"to get angry", "measure word", "a little". A sentence-embedding model handles them
natively. *(This was the original proposal; rejected 2026-08-22.)*

### 3b. A vector per det row — wrong granularity
dd resolves through the learner's `selectedSense`, so one det row shows **different English
to different learners**. A row-level vector compares text nobody is looking at. The vector
must be a property of the **dd string**, which additionally dedupes for free (635 dd keys
are shared across multiple words) and lets zh and es share one English vector space.

### 3c. Raw cosine threshold — the antonym trap
**This is the core technical hazard of the whole feature.** Bi-encoder cosine measures
*relatedness*, not *synonymy*, because it is trained on co-occurrence: "big"/"small",
"buy"/"sell", "Monday"/"Tuesday", "left"/"right" all sit at high cosine. Those are exactly
the contrast pairs a vocabulary game exists to teach. A naive threshold bans the most
valuable discrimination practice in the app.

Worse, the failure is **invisible** — nobody notices a board that quietly never puts 大 and
小 together.

> Evaluation framing worth knowing: **WordSim-353** measures relatedness (antonyms score
> *high*); **SimLex-999** measures similarity (antonyms score *low*, by design). Judge any
> approach against the SimLex notion, never generic STS.

### 3d. An LLM judging each candidate pair — does not scale
Costed at full det (§ 4 numbers): ~2.5M cross-encoder-equivalent judgments.

| | LLM (batched, cheap model) | NLI cross-encoder, local GPU |
| --- | --- | --- |
| Cost | **~$555** | **$0** |
| Wall clock | hours | 10–104 min (model-dependent) |
| Re-run on corpus growth | pays again | free |

Rejected on cost and on the fact that it re-bills forever.

### 3e. Lexical gloss overlap — cheap but wrong-shaped
"A's dd appears anywhere in B's gloss list" finds **1,203 additional pairs** with zero
infrastructure. Tempting, but it has real false positives because it compares text that is
**not on screen**: 一 (dd = `"one" radical in chinese characters`) is flagged against 都
(dd = `all`) merely because 一's gloss list also contains "all". The bug is confusion of
*displayed strings*; this rule measures synonymy of *words*. Not adopted as the primary
signal. Could still serve as a recall booster feeding § 4 step 3.

### 3f. pgvector — not needed
Not installed on the image (`cube` and `pg_trgm` are; `vector` is not). The runtime
comparison universe is one round's candidate list (≤500 rows already in memory), and the
phase-2 design reduces the runtime artifact to **one integer per gloss** — no vector math in
the request path at all. Installing pgvector would mean changing the Postgres image on prod
for zero gain. *Revisit only if "find similar words" ever becomes a user-facing feature.*

---

## 4. Phase 2 architecture — the offline pipeline

The insight that makes it affordable: **the model is frozen and never trained.** There is no
network to update. What grows is the corpus.

Second insight: **the accurate model is not the one that scales, so use both.** A
bi-encoder is O(n) and precomputable but cannot see antonymy; a cross-encoder can, but is
O(pairs). Standard retrieve-and-rerank: the bi-encoder is a cheap *recall* filter that makes
the expensive *precision* model affordable.

```
BI-ENCODER (cosine)                    CROSS-ENCODER (NLI)
  encode("big")   -> [...]               [CLS] big [SEP] small [SEP]
  encode("small") -> [...]                          |
        cosine = high                      full cross-attention
                                                    |
  never sees them together              {entail, neutral, CONTRADICTION}
```

### The six steps

| # | Step | Output | Incremental? |
| --- | --- | --- | --- |
| 1 | Extract distinct dd keys from det (`ddCollisionKey`) | key set | ✅ set-diff |
| 2 | Bi-encoder embed new keys | vectors | ✅ per-string |
| 3 | ANN index (hnswlib/faiss **in the job**, not Postgres); top-k neighbours above a cosine cut | candidate pairs | ✅ see below |
| 4 | NLI cross-encoder scores each candidate, **both directions** | 3-way probabilities | ✅ frozen model ⇒ cached verdicts stay valid |
| 5 | WordNet antonym veto (single-word glosses) | cannot-link edges | ✅ deterministic |
| 6 | Constrained clustering → `meaningGroupId` | one int per gloss | ⚠️ **no** — see § 7 |
| 7 | Upsert the gloss table | runtime artifact | ✅ |

**Step 3 is incremental** because pair discovery is symmetric: querying outward from each
*new* gloss finds every (new, old) and (new, new) pair, and (old, old) pairs were found on a
previous run. hnswlib supports `add_items` without a rebuild.

### Step 4 in detail — the framing problem

NLI models expect sentences; bare glosses are out of distribution. Each pair must be
templated into premise/hypothesis:

| A | B | Premise / hypothesis | Expected |
| --- | --- | --- | --- |
| big | small | "The word means big." / "The word means small." | **contradiction** |
| a little | a bit | "The word means a little." / "The word means a bit." | **entailment** |
| to get angry | to be furious | … | entailment |

**Template wording measurably shifts results and must be tuned on real glosses, not
assumed.** The template is part of the cache key (§ 7).

NLI is directional; synonymy is symmetric. Run both ways and combine:

| Signal | Relation | Proposed action |
| --- | --- | --- |
| Mutual entailment | paraphrase | **block** (same meaning group) |
| One-way entailment | hypernym/hyponym (*dog* → *animal*) | **IGNORED** (§ 10 Q2, 2026-08-22) — not a suppression. *dog* and *animal* are distinguishable, and under a hard rule (§ 6) every extra suppression costs board size |
| Contradiction either way | antonym / contrast | **cannot-link**, never suppress, even at cosine 0.9 |

```
confusable(A,B) = min(P_entail(A→B), P_entail(B→A)) > τ_syn
                  AND max(P_contra(A→B), P_contra(B→A)) < τ_contra
```

### Step 6 — why one integer beats a pair table

At full det a pair table would be 1–3M rows plus a per-round join. Instead, cluster the
confusability graph offline and store **one `meaningGroupId` per gloss**. The runtime rule
becomes exactly the phase-1 guard with a different key:

> no two cards in a round may share a `meaningGroupId`

O(1) equality, no vectors at request time, no pair table, no pgvector.

Must-link edges come from mutual entailment; **cannot-link edges from contradiction +
WordNet** — which is what keeps *big* and *small* in different groups despite being cosine
neighbours.

> ⚠️ **Similarity is not transitive.** Single-linkage chains
> (*a little* ~ *a bit* ~ *somewhat* ~ *rather* …). Use average-linkage or HDBSCAN, never raw
> connected components.

**Constrained clustering, decided 2026-08-22 (§ 10 Q9).** Contradiction and WordNet antonyms
become **hard cannot-link edges**, not merely absent must-links. The distinction matters for
**transitive** merges: *big* and *small* may never be linked directly — the cross-encoder
should score them low on mutual entailment — but they can still land in one group by chaining
through a shared neighbour. A must-link-only clustering has no way to stop that; cannot-link
does. This is the machinery that makes § 8g's "big and small must be in different groups
*after clustering*, not merely below threshold as a pair" checkable.

**Max group size is an ALARM, not an action, at first (§ 10 Q8).** Every rebuild logs any
group over the cap together with its members, and **never auto-splits**. You cannot choose a
sensible cap or splitting rule without seeing the real size distribution (§ 8g); acting on a
guessed number would hide the very data needed to pick it. Revisit once there is a
distribution to look at — the splitting design (recursive split at the weakest edge) stays on
the shelf.

### Sizing (measured ratios: 1.44 clusters/row, 85% of clusters yield a distinct dd)

| | Today (clustered) | Full det (226k rows) |
| --- | --- | --- |
| Distinct dd strings | 14,557 | ~277,000 |
| All pairs (never enumerated) | 106M | **38.5 billion** |
| ANN top-20 candidates, ×2 directions | 131,012 | 2,497,405 |
| Embedding tokens | — | ~0.93M → **cents** |
| Vector storage @256d | — | 284 MB f32 / **71 MB int8** |

Cross-encoder wall clock on the dev box (RTX 3050 4GB, fp16; **throughput estimated, not
measured**):

| Model | Today | Full det | |
| --- | --- | --- | --- |
| MiniLM-L6 (22M) | ~1 min | ~10 min | fast, weakest NLI |
| DeBERTa-v3-small (44M) | ~2 min | ~35 min | balance |
| **DeBERTa-v3-base (184M)** | **~5 min** | **~104 min** | **CHOSEN 2026-08-22** — best NLI accuracy |

All one-time, $0, re-runnable. **Decision: DeBERTa-v3-base.** Rebuilds are rare and offline,
so accuracy is worth more than wall clock. Record the exact hub revision in `modelRevision`
(§ 5) — the size class is the decision, the revision is the reproducibility contract.

### Where the job runs

**Not in the backend container** — it is musl/Alpine and will not take torch (the same glibc
constraint that has bitten this project before). The pipeline is an **offline job** on the
host in a venv, or in a throwaway `python:3.12` container. Node never sees Python; the only
interface is the gloss table.

Which machine, and how the result reaches prod: **§ 5a**.

## 5. Data model — CONFIRMED 2026-08-22

Three tables, **approved 2026-08-22** (§ 10 Q5), split by **where they live**. This split is what makes § 5a work: prod
receives one small flat table and never sees a vector or a model.

**Deliberately not columns on det**: keying by the dd string (not a det id) means zh and es
share one space, repeated glosses dedupe, and — critically — a cluster backfill that rewrites
a gloss produces an unseen key rather than a stale vector on a row (§ 7 self-healing). det is
untouched, so `/data-prod-to-dev` and the det deploy path do not change.

### Dev-only build artifacts — NEVER deployed

```
gloss_vectors
  glossKey        text PRIMARY KEY   -- output of ddCollisionKey
  embedding       bytea              -- int8-quantized, dims in modelRevision meta
  modelRevision   text
  updatedAt       timestamptz

gloss_pair_verdicts                  -- cached cross-encoder output
  glossKeyA       text               -- lexicographically ordered pair
  glossKeyB       text
  cosine          real
  pEntailAb       real               -- RAW PROBABILITIES, never booleans (§ 7)
  pEntailBa       real
  pContra         real
  wordnetAntonym  boolean
  modelRevision   text
  templateVersion text
  PRIMARY KEY (glossKeyA, glossKeyB)
```

These exist only on the machine that runs the pipeline. They are large (71 MB of vectors,
~1.25M verdict rows at full det) and are pure build cache.

### The deployed artifact — the ONLY table prod needs

```
gloss_meaning_groups
  glossKey        text PRIMARY KEY
  meaningGroupId  integer NOT NULL   -- indexed; the runtime lookup
  builtAt         timestamptz
  modelRevision   text               -- provenance, so prod can answer "why grouped?"
  templateVersion text
  corpusSnapshot  text
```

~277k rows of (text, int) at full det — roughly 15–20 MB. No vectors, no models, no torch.

## 5a. Where the pipeline runs, and how the table reaches prod

**Prod does not need a GPU. Prod never runs a model.** The runtime read is a hash lookup
against `gloss_meaning_groups`; nothing at request time touches an embedding.

**The build runs on the dev box** (RTX 3050) and its output is pushed up. This makes
`gloss_meaning_groups` **the one table whose source of truth is DEV**, inverting the app-wide
rule that prod is authoritative.

That inversion is safe here, and only here, because the table is **derived data**: a pure
function of (det corpus, model revision, template version, thresholds). No user ever writes
it, nothing on prod authors it, and losing it costs nothing but a rebuild.

### Why skew is safe in both directions

Dev's det is a `/data-prod-to-dev` pull and will lag prod. Both failure modes degrade
harmlessly:

| Skew | Effect |
| --- | --- |
| Prod has a discoverable word dev never saw | no group id → **no constraint** (§ 6 rule 1). Falls back to phase-1 exact-dd |
| Dev has a gloss prod does not | orphan row, never looked up |

Neither can produce a *wrong* suppression — only a missing one. That is the property that
makes a dev-authored table acceptable.

### Push requirements

1. **Single-table scope.** A dedicated script that writes `gloss_meaning_groups` and
   nothing else. It must be structurally incapable of touching det — the deleted
   `/data-deploy` skill was removed for good reason (see
   [DATA_DEPLOYMENT_GUIDE.md](./DATA_DEPLOYMENT_GUIDE.md) and the 2026-07-02 incident).
2. **Atomic replace.** `TRUNCATE` + `COPY` **inside one transaction**, so live readers see
   the previous snapshot until commit. Never a piecemeal upsert against a live table.
3. **Stamp provenance** on every row (`modelRevision`, `templateVersion`, `corpusSnapshot`)
   so a grouping on prod can always be traced to the build that produced it.
4. **Commit the pipeline to the repo.** The dev box becomes load-bearing for *updates*; the
   scripts must not live in someone's home directory. Any machine with a GPU must be able to
   reproduce the table.
5. **Rollback is `DROP`/`TRUNCATE`.** With the table empty the app degrades to phase-1
   behaviour with no code change. Cheapest possible escape hatch — prefer it to debugging a
   bad push in place.

> ⚠️ **The trap a future agent will fall into.** `/data-prod-to-dev` pulls reference tables
> **down** from prod. If `gloss_meaning_groups` is ever added to that skill's table list, a
> routine dev refresh will overwrite dev's freshly-computed groups with prod's copy of what
> dev sent up — a silent circular sync. **This table must be explicitly excluded from
> `/data-prod-to-dev`, and the exclusion commented with the reason.**

### If the dev box is unavailable

Increments are small enough to run on prod CPU in a pinch (a day's growth is ~1k–22k
cross-encoder passes — minutes, not hours). Only a **full rebuild** genuinely wants the GPU,
and full rebuilds happen only on a deliberate model or template change.

## 6. Runtime integration

No new chokepoints. The three sets in § 2 change key type:

- `OnDeckVocabService.getGameVocabPool` — `takenDds: Set<string>` → also a
  `takenGroups: Set<number>`, loaded for the candidate list in one batched lookup.
- `OnDeckVocabService.getWordSearchGrid` — same, and it must **release** a group id when the
  substring de-dup loop evicts a word, exactly as it releases a dd key today.
- `MemoryMapService.spawnInto` — **unchanged. Memory Map does NOT adopt phase 2** (§ 10 Q3,
  2026-08-22). It keeps the phase-1 exact-dd guard only.

  *Why:* a placement is durable, so a later re-cluster could retroactively put two
  already-placed words in one group, and every remedy is bad — evicting deletes a learner's
  reading progress, grandfathering leaves the map permanently wrong. Exact-dd equality has no
  such problem: it is a property of the strings, not of a model that gets rebuilt. Memory Map
  opts out of the whole class of problem rather than managing it.

### The rules that must survive

1. **No group id ⇒ no constraint.** A gloss with no row (never embedded, or added since the
   last run) must never block a card. The guard degrades to phase-1 behaviour.
2. **Exact-dd stays hard.** Identical strings always share a group, so phase 1 is preserved
   automatically.
3. **Near-miss suppression is HARD by default** (§ 10 Q1, 2026-08-22) — a same-group card is
   never admitted, and the board simply comes up short. The rationale is that **lending is the
   fallback**: the last fill tier draws from the whole dictionary, which has far more room to
   find a non-colliding card than the learner's own deck does.
4. **…except where lending is unavailable, where it degrades to SOFT** (§ 10 Q1b). Lending
   does *not* run in two cases, and there a hard rule has no rescue path:

   | Case | Guard in code | Behaviour |
   | --- | --- | --- |
   | Collection-restricted round (deck / builtin) | `opts.collection` set | **soft** — admit a same-group card rather than shorten the board |
   | Partial refill on a non-rolling-supply surface | `opts.need` set and not `opts.lendOnRefill` | **soft** |
   | Everything else | — | **hard** |

   Implement this as one predicate next to the existing `mayLend` computation in
   `getGameVocabPool`, so the two can never drift apart — if a future change makes a case
   lendable, it must automatically become hard again. Word Search follows the same rule via
   its own `!collection` lending branch.

---

## 7. Keeping it up to date — operator instructions

> Written for when phase 2 exists. Nothing below is runnable today.

### What grows, and how the job notices

`/mark-discoverable` adds discoverable rows daily. There is **no `discoverableAt` column**
(`dictionaryentries_zh."createdAt"` is *import* time — 114,202 rows are all stamped
2026-02), so growth cannot be detected by timestamp.

**Do not add one.** The job asks *"which dd keys exist in det but not in `gloss_vectors`?"* —
a set-diff. This needs no schema change and is **self-healing**: if an enrichment backfill
rewrites a gloss, the new string is simply an unseen key, and the orphaned old key can be
garbage-collected on the periodic rebuild.

### Cadence

| Job | When | Cost | What it does |
| --- | --- | --- | --- |
| **Incremental** | on the tail of `/mark-discoverable`, or nightly | **seconds** | steps 1–5 for new keys, then union-find merge into existing groups |
| **Re-cluster** | weekly, or when max group size crosses the cap | **seconds** (no inference) | step 6 in full, over cached verdicts |
| **Full rebuild** | only on a deliberate model/template change | 10–104 min | everything |

Measured increment cost:

| New discoverable/day | New dds | CE passes | DeBERTa-base | Embed cost |
| --- | --- | --- | --- | --- |
| 10 | 12 | 221 | 1 s | ~$0 |
| 50 | 61 | 1,103 | 3 s | ~$0 |
| 200 | 245 | 4,413 | 11 s | $0.00002 |
| 1,000 | 1,226 | 22,065 | 55 s | $0.00008 |

The incremental job **must be idempotent and must never block `/mark-discoverable`**. Run it
as a separate step whose failure is logged, not fatal — a word shipping briefly without a
group id is harmless (§ 6 rule 1), whereas a failed embedding call blocking the enrichment
pipeline is not.

### Why step 6 is the only non-incremental step — and why that is fine

Adding one gloss can **merge two existing groups**. Union-find handles that incrementally in
O(α(n)), but it **only ever merges, never splits**, so chaining drift accumulates
monotonically. The corrective is the weekly full re-cluster — which is pure graph work over
cached verdicts with **zero model inference**, and takes seconds even at 277k nodes /
1.25M edges.

### Two rules that keep maintenance cheap

1. **Cache raw probabilities, never booleans.** With `pEntailAb`/`pEntailBa`/`pContra`
   stored, retuning τ is a SQL re-derivation — free and instant. Cache a boolean verdict
   instead and every threshold experiment costs a full re-judge. This is the difference
   between tuning being a 10-second loop and an afternoon.
2. **Pin both models by revision hash**, recorded in `modelRevision` alongside every verdict,
   and version the template in `templateVersion`. A moved hub tag would otherwise silently
   change verdicts underneath you. A rebuild must always be a decision, never drift.

### What forces which re-run

| Change | Re-runs | Cost |
| --- | --- | --- |
| Threshold τ | step 6 only | **free** |
| Cosine cut | steps 3–6 (vectors survive) | minutes |
| Premise/hypothesis template | steps 4–6 (full re-judge) | 10–104 min |
| Embedding or NLI model version | everything | 10–104 min |

### Validation — run this every time, not once

Maintain two lists as a **permanent regression test**, both drawn from real det data:

- **must-block** — real collisions (*a little* / *a bit*, 有点 / 有一点, *to get angry* /
  *to be furious*)
- **must-not-block** — contrast pairs the app exists to teach (*big* / *small*, *buy* /
  *sell*, *Monday* / *Tuesday*, *left* / *right*)

**Tune to favour BLOCKING — recall on must-block over precision** (§ 10 Q4, revised
2026-08-22 after § 8i). Superseding the earlier balanced-F1 target: a **false negative** (a
confusable pair reaching one board) is the original bug and is visible to players, while a
**false positive** (a fine pair wrongly separated) costs contrast practice and board size.
Some false positives are acceptable; missed blocks are not.

**But "not too strict" is enforced structurally, not by the threshold** — see the cannot-link
brake in § 4. Being liberal on must-link is safe precisely *because* contradiction + WordNet +
the numeral guard can veto it.

Report both rates on every rebuild and record them alongside `modelRevision` /
`templateVersion`, so a regression is at least *visible* even though it does not fail the
build. Watch the must-not-block rate especially: that failure is silent in production (a
board that quietly never teaches 大 vs 小), and under the hard rule of § 6 a wrong block has
no fallback. If it drifts, revisit the balance — the tuning target is a decision, not a law.

---

## 8. Validation matrix — what to test once it is wired up

**First run: the probe (§ 10 Q7), 2026-08-22** — a throwaway venv on the dev box, CPU-only
torch, running this matrix against the real discoverable corpus before any pipeline is built.
Its purpose is to settle C1: does an NLI cross-encoder separate synonymy from contrast **on
Chinese-dictionary glosses**? Results are recorded in § 8i. The harness is committed at
`server/scripts/gloss-probe/` with a README covering how to re-run it and which models are
pinned.

Thereafter, run every case below on **every** rebuild, not once. Each row is `A | B → expected`. The
examples are pulled from the live discoverable corpus unless marked *generic*.

### 8a. Must-block — true confusability (precision)

| A | B | Note |
| --- | --- | --- |
| 高兴 "happy" | 开心 "happy" | exact-dd; phase 1 already catches. **Regression guard: phase 2 must never be weaker than phase 1** |
| 一下 "a little" | 一点 "a bit" | the canonical near-miss this feature exists for |
| 有点 / 有一点 / 有点儿 | each other | morphological variants (erhua, optional 一) |
| 上火 "to get angry" | 动气 "to get angry" | one of 8 words sharing this dd |
| *generic* "to go" | "go" | bare vs to-infinitive |
| *generic* "a few" | "few" | determiner noise |

### 8b. Must-NOT-block — contrast pairs (recall; the invisible failure)

Tracked and reported, **not a build gate** (§ 10 Q4 chose balanced tuning). Still the more
dangerous list: a wrongly-blocked pair silently removes the discrimination practice the app
exists to provide, and under § 6's hard rule it has no fallback. A jump in this rate is the
signal to revisit the tuning target.

| Class | Examples |
| --- | --- |
| Antonyms | big/small, buy/sell, open/close, hot/cold |
| Directional pairs | left/right, up/down, **come/go** (来/去 is a core teaching pair) |
| Co-hyponyms | Monday/Tuesday, red/blue, mother/father, cat/dog |
| Numbers | one/two — **一 and 二 must be able to share a board** |

### 8c. ⚠️ Templated gloss families — the dominant out-of-distribution risk

**This is the case most likely to break the whole approach, and it is specific to a
dictionary corpus — MNLI contains nothing like it.** These glosses are near-identical
*lexically* but denote *distinct entities*, so a bi-encoder scores them ~0.95 and they will
dominate the top-k candidate lists far out of proportion to their share of the corpus.

| Family | Real examples | Distinct dds today | Expected |
| --- | --- | --- | --- |
| `surname X` | 加 "surname Jia", 周 "surname Zhou", 金 "surname Jin" | 8 | **must NOT block** — different surnames |
| `classifier for X` | 方 "classifier for square things", 名 "classifier for people", 出 "classifier for dramas, plays, operas etc" | 29 | **judgement call** — genuinely ambiguous, see below |
| `X district of Y city` | 城区, 城西区, 三重 | 12 | **must NOT block** — different places |
| gloss contains Han + numbered pinyin | 城西区 "…西寧市\|西宁市[Xi1 ning2…" | 60 | must not crash; verdict should be low-confidence |
| encyclopedic (>70 chars) | 名家 "School of Logicians of the Warring States Period…" | 34 | boilerplate must not dominate the score |

~143 of 5,263 distinct dds today (2.7%) — but **this share grows sharply with the corpus**,
since CC-CEDICT-derived data is dense with surnames and place names. At full det expect
well into double digits.

> **`surname Jia` vs `surname Zhou` is the single best diagnostic in the corpus.** Cosine
> will say ~0.97; the correct answer is "not confusable". If the cross-encoder gets this
> right, that is strong evidence the approach works at all. If it gets it wrong, the
> bi-encoder/cross-encoder split has bought nothing and the design needs rethinking.

**Decision (2026-08-22, § 10 Q6): no prefix special-casing. The model decides.** These
families get no exemption; whatever the cross-encoder says stands. The reasoning is that a
hand-maintained prefix list is another thing to keep current, and we would rather learn what
the model actually does here than pre-empt it.

**This makes § 8c a measurement, not a settled case.** If the families come back wrongly
grouped — 加 "surname Jia" suppressed against 周 "surname Zhou" — **the decision reopens**,
and the fallback is what was declined here: detect the family by prefix and either exempt it
outright or compare only the discriminating tail. Report per-family rates separately from the
overall F1 so this stays visible rather than being averaged away.

`classifier for X` is the ambiguous one even if the model behaves: "classifier for square
things" and "classifier for people" *are* distinguishable on the tail, but a skimming player
may not distinguish them. Whatever the model returns for that family, eyeball it before
accepting.

### 8d. Hypernym / hyponym — observation only (§ 10 Q2 answered: ignore)

| A | B |
| --- | --- |
| dog | animal |
| rose | flower |
| 车 "vehicle" | 汽车 "car" |

Hypernyms are **not** suppressed (§ 10 Q2), so these are not pass/fail cases. They are still
worth running as a **health check on the mutual-entailment rule itself**: expect one-way
entailment, and confirm `P_entail(A→B) ≠ P_entail(B→A)`. If the asymmetry does not show up,
the model is not distinguishing direction and the `min(...)` in § 4's rule is not doing what
it claims — which would quietly turn hypernyms back into blocks.

### 8e. Robustness and degenerate inputs

- empty gloss → empty key, never collides (phase-1 contract)
- punctuation-only / single-character glosses
- identical strings → trivially the same group (they collapse to one key)
- the longest gloss in the corpus → no truncation crash, no token-limit error
- a gloss appearing in **both** zh and es → shared group is inert (rounds are single-language)

### 8f. Template sensitivity

Run 8a–8d under **2–3 different premise/hypothesis templates**. Verdicts should be stable.
**If verdicts flip on template wording, the thresholds are fitting the template rather than
the semantics** — treat that as a red flag, not a tuning opportunity.

### 8g. Clustering behaviour — settles § 10 Q4

- group-size distribution; inspect the largest groups by hand
- hunt the chain explicitly: *a little* ~ *a bit* ~ *somewhat* ~ *rather* ~ *slightly*
- verify cannot-link held: **big and small must be in different groups** after clustering,
  not merely below threshold as a pair
- count groups that swallowed a whole templated family (8c) — a strong smell

### 8h. System-level, not model-level — how hard the hard rule bites

§ 10 Q1 chose **hard**, so this is no longer a soft/hard experiment but a **budget check**.
Replay real learner libraries through `getGameVocabPool` with the constraint on and measure:

- how often a board comes up **short**, by surface and by library size;
- how often the shortfall is rescued by **lending** (the stated rationale for hard) versus
  left short;
- the two **soft-exception** paths of § 6 rule 4 — collection-restricted rounds and
  non-rolling-supply refills — where no rescue exists;
- **Hydra specifically**, whose `strictBuckets` requests already come back short by design and
  which will therefore compound.

If lending turns out not to rescue as reliably as assumed, that reopens § 10 Q1.

### 8i. Probe results — C1 answered, 2026-08-22

**Setup.** Throwaway install on the dev box, CPU-only torch. Bi-encoder
`sentence-transformers/all-MiniLM-L6-v2`; NLI `MoritzLaurer/DeBERTa-v3-base-mnli-fever-anli`
(the § 10 Q10 model class); template `"The word means {}."` = templateVersion **v1**. Gold set
of 39 pairs, most drawn from the live discoverable zh corpus.

#### Headline: C1 is answered YES — and § 3c is confirmed empirically

| Signal | must-block range | must-not-block range | best accuracy | margin |
| --- | --- | --- | --- | --- |
| **Cosine** (bi-encoder) | 0.47 – 1.00 | 0.27 – 0.87 | **82%** at τ=0.79 | **−0.40 → OVERLAP, no threshold works** |
| **Mutual entailment** (NLI) | 0.94 – 1.00 | 0.00 – 0.00 | **100%** | **+0.94 → clean separation** |

The inversion that kills cosine, in one line: **Monday/Tuesday sits at 0.87 while
thing/object — a real synonym pair — sits at 0.47.** No threshold can order those correctly.
The cross-encoder scores them 0.00 and 0.97.

#### § 8c templated families — the predicted failure did NOT happen

All nine real pairs scored `entail 0.00 / contra 0.98–1.00`, i.e. correctly **not**
suppressed:

- `surname Jia` / `surname Ming` / `surname Zhou` / `surname Jin`
- `classifier for square things` / `classifier: layer` / `classifier for dramas, plays…`
- `Cheng District…` / `Chengxi district of Xining` / `Sanchong, a district of New Taipei`

This was flagged as "the case most likely to break the whole approach" and as the single best
diagnostic in the corpus. It passes. **§ 10 Q6 (no prefix special-casing) is vindicated — do
not add the exemption list.** C12 can be downgraded to routine monitoring.

#### § 8e robustness — no failures

225-char encyclopedic gloss, gloss containing Han + numbered pinyin, and identical strings all
scored sensibly with no truncation or tokenizer error.

#### The real distribution is harder than the gold set

Judging the **400 highest-cosine real pairs** (cos 0.85–1.00 — everything a retriever would
surface):

- **10 pairs were the same `ddCollisionKey`** (case-only, `God`/`god`). **Harness lesson that
  is a real pipeline requirement: step 1 must dedupe on `ddCollisionKey` output, not raw dd
  strings**, or candidate slots are spent on pairs phase 1 already merges.
- Of the 390 genuine candidates, NLI blocks **43%** — meaning **57% of what a cosine
  threshold would have blocked are false positives the cross-encoder correctly rescues**
  (`Chengdong district` vs `Chengxi district`, `left-hand side` vs `right-hand side`,
  `Dongming County` vs `Dongping County`).
- **τ is insensitive** across a wide range: 0.2→49%, 0.3→46%, 0.5→43%, 0.8→39%. Threshold
  tuning is not where the risk lives.

#### ⚠️ The one real gap: a 115-pair grey band that § 4's rule misses

115 of 390 pairs are **neither synonym nor antonym** under the § 4 rule — low mutual
entailment *and* low contradiction — so they are currently **allowed**. Inspecting them:

- **88% are one-way entailment ≥ 0.8** — precisely the relation § 10 Q2 decided to ignore.
- **70% are lexically contained** (one gloss inside the other).

Examples the current rule would let onto the same board:

| A | B | A→B | B→A | contained |
| --- | --- | --- | --- | --- |
| Congress | US Congress | 0.01 | 0.99 | yes |
| radio station | this radio station | 0.27 | 0.99 | yes |
| to meet | to meet together | 0.15 | 0.99 | yes |
| city district | district | 0.98 | 0.00 | yes |
| Haidong | Haidong City | 0.04 | 0.98 | yes |
| chicken | chicken meat | — | high | yes |
| east | east side | — | high | yes |

**Why the rule misses them:** NLI measures *logical entailment*, but the product question is
*display confusability*. "chicken" does not strictly entail "chicken meat" (a live chicken is
not meat) — logically correct, and useless to a player looking at two cards.

**Why Q2's reasoning was still sound, and what changed:** Q2 was decided on *taxonomic*
hypernymy (dog/animal, rose/flower) where the semantic gap is wide and the pair genuinely is
distinguishable. The real corpus is dominated instead by *specialization* — same head, added
modifier — which is not distinguishable on a board. **Lexical containment cleanly separates
the two cases:** `dog` is not contained in `animal`, but `east` is contained in `east side`.

**RESOLVED (§ 10 Q11, 2026-08-22): adopt a LIBERAL must-link behind a HARD brake.**

```
block(A,B) =  ( mutual_entailment > 0.3            # tau lowered from 0.5; 0.3 is the knee
                OR contained(A, B) )               # free string test, no extra inference
              AND NOT cannot_link(A, B)

cannot_link(A,B) =  max_contradiction >= 0.5       # fires on 27% of real candidates
                    OR wordnet_antonym(A, B)
                    OR numeral_mismatch(A, B)      # see below
```

The asymmetry is deliberate and matches § 7's revised tuning target: **be generous about what
counts as confusable, and rely on the brake to prevent over-blocking.** Measured on the 390
real candidate pairs of § 8i, this blocks 259 (66%) versus 169 (43%) today. τ below 0.3 buys
nothing (260 at τ=0.2).

**`numeral_mismatch` — the one gap the brake had.** 万 "ten thousand" / 千 "thousand" scored
contradiction **0.11**, so neither the NLI veto nor WordNet caught it, and containment *does*
match ("thousand" ⊂ "ten thousand") — it would have been wrongly blocked. Numerals are a
contrast class that must never be separated, so they get a deterministic guard:

> Fire when **both** glosses contain a numeral/quantity token **and the sets differ**.

Both-sides-non-empty matters. `o'clock` / `one o'clock` has an empty set on one side, so the
guard stays out of the way and the pair is correctly blocked. Carry a small synonym map
(`one ≈ single`, `half ≈ 0.5`) or `a single cent` / `one cent` will be spuriously exempted —
a minor, acceptable miss if not.

> ⚠️ **Consequence for clustering.** A liberal must-link over a transitive clustering makes
> groups grow fast: at 66% of top-20 neighbours linking, an average gloss joins ~13 others
> before any chaining. **This promotes the § 10 Q8 size alarm from diagnostic to load-bearing**
> — it is now the main early warning that the liberal rule has over-merged. Expect to need
> tighter linkage than a first guess, and check § 8g's largest groups before trusting a run.

## 9. Outstanding concerns

| # | Concern | Status |
| --- | --- | --- |
| **C1** | ~~Premise unvalidated.~~ **ANSWERED 2026-08-22 by the § 8i probe: YES.** Cosine tops out at 82% with overlapping ranges; NLI separates cleanly (+0.94 margin, 100%). Templated families pass. Residual gap is the 115-pair grey band → C13. *Original text:* **the core premise is unvalidated** — nobody has measured whether an NLI cross-encoder separates *big/small* from *a little/a bit* **on Chinese-dictionary glosses**. MNLI is news/fiction prose; `"classifier for square things"` and `"surname Zhou"` are far out of distribution. **Accepted as a known unknown (2026-08-22)** — the decision is to build it and find out which cases work, using the § 8 matrix. § 8c is where it is most likely to fail. | Accepted, test per § 8 |
| **C2** | ~~Deployment path unresolved.~~ **RESOLVED 2026-08-22**: prod needs no GPU (it never runs a model); the build runs on dev and pushes `gloss_meaning_groups` up. That table's source of truth is **dev**, inverting the app-wide rule — safe because it is derived data and skew can only cause a *missing* suppression, never a wrong one. See § 5a for the push requirements and the `/data-prod-to-dev` exclusion trap. | Resolved |
| **C3** | ~~Tables unconfirmed.~~ **RESOLVED 2026-08-22** — all three approved as specced (§ 5). | Resolved |
| **C4** | ~~Soft vs hard unresolved.~~ **RESOLVED 2026-08-22** — **hard**, on the rationale that lending is the fallback; **soft only where lending cannot run** (§ 6 rule 4). | Resolved |
| **C5** | ~~Hypernym policy.~~ **RESOLVED 2026-08-22** — ignored; only mutual entailment suppresses. | Resolved |
| **C6** | ~~Memory Map retroactive merges.~~ **RESOLVED 2026-08-22** — Memory Map does not adopt phase 2 at all; it keeps the phase-1 exact-dd guard. The problem is avoided rather than managed. | Resolved |
| **C7** | ~~Linkage + cap unchosen.~~ **PARTLY RESOLVED 2026-08-22** — average-linkage or HDBSCAN with **cannot-link constraints** (Q9); the size cap is **alarm-only** (Q8) until § 8g yields a distribution. The cap *number* and any splitting rule remain open by design. | Open by design |
| **C8** | Co-hyponyms (*Monday/Tuesday*, *red/blue*) may return `neutral` rather than `contradiction`. Neutral is correctly "not confusable" under § 4's rule (entailment is not high), so the pair is not suppressed — **but neutral produces no cannot-link edge**, so co-hyponyms remain merge-able by chaining in a way antonyms are not. Watch § 8g for co-hyponym families landing in one group. | Watch in § 8b, § 8g |
| **C9** | WordNet is English-only. Harmless — glosses are English for both languages — but the veto has no Spanish-specific coverage. A zh gloss and an es gloss can share a group, which is inert because rounds are single-language. | Accepted |
| **C10** | Study Challenge word sets compose rounds outside the three chokepoints. Not wired to games yet, but when it is, it needs the same key — and a client-side composer would need a `ddCollisionKey` twin. | Tracked in GAMES_FEATURE.md |
| **C11** | ~~Hard rule × balanced tuning.~~ **CHANGED 2026-08-22** — tuning now favours blocking (Q4 revised), so the risk inverts: the exposure is no longer wrongly-blocked contrast pairs slipping past a balanced threshold, but the liberal must-link over-merging groups. Watch the § 8g size alarm rather than the must-not-block rate. *Original:* **hard rule × balanced tuning is the riskiest combination.** Balanced tuning (Q4) accepts some wrongly-blocked contrast pairs; the hard rule (Q1) gives those blocks no fallback; and the failure is invisible in production. Individually defensible, compounding together. **Mitigation:** § 7 reports the must-not-block rate every rebuild, and § 8b flags a jump as the trigger to revisit the tuning target. | Open — monitor |
| **C12** | ~~Templated-family risk carried.~~ **LARGELY CLEARED 2026-08-22** — § 8i shows all nine real surname/classifier/district pairs correctly allowed (contra 0.98–1.00). Keep per-family reporting as routine monitoring. *Original:* no special-casing (Q6) means the § 8c risk is carried, not mitigated. Concentrated in `surname X` / `X district of Y city`, which grow as a share of the corpus. **Mitigation:** report per-family rates separately so they are not averaged away; the prefix-exemption fallback stays on the shelf. | Open — monitor |

| **C13** | ~~The § 8i grey band.~~ **RESOLVED 2026-08-22** by the liberal-must-link + brake rule (§ 8i, Q11). Residual known false positives are accepted per the revised Q4 (e.g. `East and West Germany`/`West Germany`, `east`/`east and west`). | Resolved |
| **C14** | **The liberal rule was never re-measured end to end.** § 8i's 259/390 is a recount over cached scores, not a fresh run — and it was never validated against the § 8a/8b gold set, so the must-not-block rate under the NEW rule is unknown. Cheap to close: re-run `server/scripts/gloss-probe/` with the rule applied. | **Open — do before building** |
| **C15** | **An STS cross-encoder was never tried.** § 8i showed NLI is excellent at contradiction but mediocre at graded synonymy, since it asks logical entailment rather than display confusability. A paraphrase/STS model for the must-link half (keeping NLI for cannot-link) might beat containment outright. Not blocking — the liberal rule is adequate — but it is the obvious next experiment if grouping quality disappoints. | Open — future |

## 10. Question log

- **Q1 — soft or hard?** **HARD.** Rationale: lending is the fallback — the last fill tier
  draws from the whole dictionary, not the learner's deck.
- **Q1b — but lending does not always run.** Correction raised during the decision: lending
  is skipped for collection-restricted rounds and for non-rolling-supply partial refills.
  **Answer: degrade to SOFT in exactly those two cases** (§ 6 rule 4), hard everywhere else.
- **Q2 — hypernyms?** **IGNORE.** Only mutual entailment suppresses.
- **Q3 — retroactive merges on Memory Map?** **Do not apply phase 2 to Memory Map at all.**
  It keeps the phase-1 exact-dd guard.
- **Q4 — tuning bias?** ~~Balanced (F1).~~ **REVISED 2026-08-22 after § 8i: favour BLOCKING.**
  False negatives (the original bug, visible) are worse than false positives (lost contrast,
  bounded by the brake). "Not too strict" is enforced by cannot-link, not by τ.
- **Q5 — tables?** **Approved as specced** — all three (§ 5).
- **Q6 — templated gloss families (`classifier for X`)?** **Let the model decide** — no
  prefix special-casing. § 8c becomes a measurement; failure reopens it. See C12.
- **Q7 — where does the job run?** Build on dev (the GPU box), push `gloss_meaning_groups` to
  prod; prod needs no GPU and runs no model. See § 5a. **The C1 probe runs first**, in a
  throwaway venv on the dev box.
- **Q8 — max group size cap?** **Alarm only** — log oversized groups and their members, never
  auto-split, until § 8g provides a real size distribution.
- **Q9 — cannot-link constraints?** **Yes, constrained clustering.** Contradiction + WordNet
  antonyms are hard cannot-link edges, because they are what prevents *transitive* merges.
- **Q10 — which cross-encoder?** **DeBERTa-v3-base**, pinned by hub revision. Validated in § 8i.
- **Q11 — the § 8i grey band (C13).** **ANSWERED 2026-08-22: liberal must-link (τ=0.3 OR
  containment) behind a hard cannot-link brake, plus a numeral guard.** Full rule in § 8i.
  This partly reverses Q2 for the *specialization* case while leaving taxonomic hypernymy
  (dog/animal) alone, as Q2 intended.

## 11. Dependencies

**Code this doc describes:** `server/utils/definitions.ts` → `ddCollisionKey`,
`resolveDisplayDefinition`; `server/services/OnDeckVocabService.ts` → `getGameVocabPool`,
`getWordSearchGrid`, `fetchDdKeys`; `server/services/MemoryMapService.ts` → `spawnInto`;
`server/dal/implementations/MemoryMapDAL.ts` → `getUnplacedCandidates`.

**Docs that depend on this one:** [GAMES_FEATURE.md](./GAMES_FEATURE.md) § "No two cards may
share a dd in one round" (the shipped rule), [WORD_SEARCH_GAME.md](./WORD_SEARCH_GAME.md)
§ 1b, [MEMORY_MAP_GAME.md](./MEMORY_MAP_GAME.md) § 2.1 "Two words never read the same",
[DEFINITION_MAPPING.md](./DEFINITION_MAPPING.md) (dd derived key).
