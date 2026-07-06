# Definition Clusters (Chinese)

> Child of [DEFINITION_MAPPING.md](./DEFINITION_MAPPING.md) — the index of all
> definition forms across the app and the operations between them. This doc
> covers one form: `definitionClusters`.

Splits a Chinese dictionary entry's flat `definitions` array into **sense
clusters** stored in the `definitionClusters` jsonb column. Many headwords carry
mutually-unrelated meanings (会 = "can" / "will" / "to meet" / "meeting" / the
kuài "to reckon accounts" sense); a single globally-ranked list forces those
senses to interleave. Clustering groups each sense, ranks glosses
prototypical→vernacular **within** the cluster, and scores each cluster's
register **independently**.

## Goal & design rationale

**What we're trying to do:** turn a flat, single-ranked gloss list into a small
set of *learnable senses*, each with its own reading and its own register score,
so a flashcard can show "this word's distinct meanings" instead of one
interleaved blob. Three properties matter:

1. **One reading per cluster.** Heteronyms (会 hui4/kuai4, 得 de2/de5/dei3, 和
   he2/huo2/he4/hu2) never share a cluster — reading is a hard boundary. This
   also lets a future per-reading row split be a pure data migration.
2. **Register is per-cluster, not per-word.** A word-level `vernacularScore` is a
   lie for polysemes: 干 "to do" is vernacular (5) but 干 "shield" is literary
   (1). Each cluster is scored independently.
3. **Granularity by shared *core idea*, decided by a dedicated pass.** A cluster
   groups glosses that mean the same thing; distinct ideas stay apart. Getting
   this granularity right in a single split prompt proved unstable (it either
   over-split or produced incoherent mega-clusters), so granularity is now the
   job of a **separate consolidation pass** (Stage A.5), decoupled from the
   initial split.

**Why two stages (split → merge).** Stage A splits *finely and accurately* —
clean, atomic senses on the correct reading, without fighting over how coarse to
be. Stage A.5 then merges any clusters that are too similar. This split-then-
consolidate shape is far more controllable than one prompt trying to nail
granularity: the split can be precise, and "how coarse" becomes a single tunable
knob (the merge prompt's aggressiveness) that cannot, by construction, cross a
reading boundary. See the evaluation in
[DEFINITION_CLUSTERS_EVAL.md](./DEFINITION_CLUSTERS_EVAL.md).

**Known limits (from evaluation):** the merge pass cannot fix a *wrong* Stage-A
reading (e.g. 干 "trunk" mis-read as gan1 blocks it from rejoining the gan4
"cadre" cluster) — that needs upstream reading validation; and at higher merge
strength it occasionally over-reaches into a small grab-bag (白 "funeral / cold
stare / wrong character"), which surfaces as a review flag.

## Data model

`dictionaryentries_zh."definitionClusters"` — `jsonb`, nullable (NULL = not yet
clustered). Array of cluster objects:

```jsonc
[
  { "sense": "to be able to / know how", "reading": "hui4", "pos": ["verb"],
    "vernacularScore": 5, "glosses": ["can", "to know how to", "to have the skill"] },
  { "sense": "to reckon accounts", "reading": "kuai4", "pos": ["verb"],
    "vernacularScore": 1, "glosses": ["(bound form) to reckon accounts"] }
]
```

| Field | Meaning |
|---|---|
| `sense` | short English label for the shared meaning |
| `reading` | numbered pinyin for **this** sense — heteronyms differ (会计 → `kuai4`), so a future per-reading row split is a pure data migration, not a schema change |
| `pos` | part(s) of speech for this sense — **always `string[] \| null`** (single-POS senses are a 1-element array). Normalized at write time by `toPosArray`; existing rows were migrated string→array. |
| `vernacularScore` | 1–5 register, scored **independently per cluster** (`null` = scoring failed). Same rubric/scale as the word-level `vernacularScore`. |
| `glosses` | verbatim source glosses, ordered prototypical→vernacular within the cluster |

**Difficulty stays at the word level** (the `difficulty` column) and is *not*
duplicated per cluster.

- Migration: `database/migrations/90-add-definition-clusters-to-zh.sql`
- Types: `DefinitionCluster` in `server/types/index.ts` and `src/types.ts`
  (added to the `DictionaryEntry` shape as `definitionClusters`).

## Ownership: clusters vs. the flat `definitions`

`definitionClusters` is **additive metadata**. The flat `definitions` array
stays the contract for the ~40 downstream consumers (flashcards, dd,
segmentation) and remains **owned solely by**
`backfill-process-definitions-array.js`. The clusterer **never writes
`definitions`**.

The two intentionally diverge — `definitions` is **not** a strict flatten of
`definitionClusters`:
- `definitions` may carry a **synthetic short headline gloss** (e.g. 一下 →
  `"a bit; give it a try"`) that exists in no source cluster.
- a cluster may **prune** a low-value gloss (broken English / archaic) that
  `definitions` still lists.

## Pipeline

`server/scripts/backfill/chinese/backfill-cluster-definitions.js`, per entry:

| Stage | What | Code |
|---|---|---|
| **A — Split** | Sonnet (Opus on retry) partitions the entry's glosses into clusters **verbatim** — every input gloss lands in exactly one cluster; no add/rephrase/drop. Rules: **reading is a hard boundary** (never mix readings in a cluster); cluster by **shared core idea**; err toward *finer, precise* atomic senses (the merge pass consolidates). Validated by `validatePartition` (exact partition). | `backfill-cluster-definitions.js` (`CLUSTER_INSTRUCTIONS`, `callCluster`, `clusterEntry`, `validatePartition`) |
| **A.5 — Merge (opt-in `--merge-pass`)** | A second Sonnet call reviews Stage-A's candidate clusters and **consolidates over-similar ones**, leaning toward merging but never crossing a reading boundary and never fusing an incoherent grab-bag. It only **regroups** existing glosses, so the result is re-checked as an exact partition; on any error or validation failure it **keeps Stage A's clusters** (the merge must never lose a gloss). | `backfill-cluster-definitions.js` (`MERGE_INSTRUCTIONS`, `mergeClusters`, `mergeUser`) |
| **B — Order/prune within cluster** | Reuses the shared Pass-1/2 gloss-ordering pipeline per cluster (skips the API for ≤1-gloss clusters). Standalone-safe: Pass-1 also prunes broken/archaic glosses, so the clusterer runs on raw cedict glosses too. | `lib/orderGlosses.js` (`createGlossOrderer` → `pass1Sort`, `pass2Critique`) |
| **C — Score register** | Scores each cluster's vernacular register 1–5 **independently** (会 "can"=5 vs "accounts"=1), identical rubric to the word-level scorer. | `lib/vernacularScore.js` (`createVernacularScorer` → `scoreVernacular`) |

The clusterer then writes **only** `definitionClusters` and stamps the run log.

Stage A's model is overridable for A/B testing via the `CLUSTER_MODEL` env var
(defaults to Sonnet; e.g. `CLUSTER_MODEL=claude-opus-4-8` runs the whole split on
Opus). The Opus retry escalation is independent of this.

### Shared cores (one source of truth)

The ordering and register logic were extracted out of the two standalone
backfills into `lib/` so the clusterer reuses them verbatim rather than
re-implementing the prompts:

- `lib/orderGlosses.js` — Pass-1 reorder/prune prompt, Pass-2 critic, short-gloss
  synthesis, the parenthetical/validation helpers, and `createGlossOrderer`.
  Imported by `backfill-process-definitions-array.js` (flat array) and
  `backfill-cluster-definitions.js` (per cluster).
- `lib/vernacularScore.js` — the `SCALE_AND_GUIDELINES` rubric, `SCORE_LABELS`,
  and `createVernacularScorer`. Imported by `backfill-vernacular-score.js`
  (word level) and `backfill-cluster-definitions.js` (per cluster).

## Running

```bash
# discoverable, not-yet-clustered entries
docker exec cow-backend-local npx tsx scripts/backfill/chinese/backfill-cluster-definitions.js
docker exec cow-backend-local npx tsx scripts/backfill/chinese/backfill-cluster-definitions.js --all        # all zh
docker exec cow-backend-local npx tsx scripts/backfill/chinese/backfill-cluster-definitions.js --force      # re-cluster
docker exec cow-backend-local npx tsx scripts/backfill/chinese/backfill-cluster-definitions.js --words=会,中  # specific words
docker exec cow-backend-local npx tsx scripts/backfill/chinese/backfill-cluster-definitions.js --spot-check  # 5 entries, NO writes, verbose
docker exec cow-backend-local npx tsx scripts/backfill/chinese/backfill-cluster-definitions.js --merge-pass  # Stage A.5: consolidate over-fine clusters
docker exec cow-backend-local npx tsx scripts/backfill/chinese/backfill-cluster-definitions.js --no-critic   # skip the Stage B critic
```

**Every entry with ≥1 definition is clustered — single-gloss words included** (they
become a trivial one-cluster array, never left NULL). There is no `definitions > 1`
gate: downstream consumers key on `definitionClusters IS NULL`, so leaving
single-gloss words unclustered would wrongly read as "not processed".

**Single-definition fast path (zero API calls).** A one-definition entry skips *every*
model call (Stage A/A.5/B/C) and is built locally: the lone definition is used verbatim
as both the cluster's `sense` label and its only gloss, with `reading` = the row's
primary reading. `pos` and `vernacularScore` are **copied from the word-level columns**
(`partsOfSpeech`, `vernacularScore`) rather than re-derived — for a single-sense word
the word-level values already describe that one sense, so no API call is needed. Both
fall back to `null` if their column isn't populated at clustering time, so in the
mark-discoverable pipeline **`backfill-parts-of-speech` and `backfill-vernacular-score`
must run before clustering** (the pipeline is ordered accordingly). So a bulk `--all`
run is cheap for the single-gloss majority and only spends tokens on genuinely
polysemous (`≥2`-definition) entries. Trade-off: the `sense` is the raw source gloss,
not a model-cleaned label (e.g. 米饭 → `"(cooked) rice"`, not `"cooked rice"`).
Code: the `definitions.length === 1` branch in `run()`.

It runs in the mark-discoverable §A pipeline **before `backfill-example-sentences`**,
which now reads `definitionClusters` to tag each example sentence with the exact
`sense` it demonstrates (and skips any row that isn't clustered yet). Uncertainty
is surfaced via the `⚠ CLUSTER REVIEW` stdout lines described above (no file) — a
wrong cluster/reading here also propagates a wrong `sense` into the example
sentences downstream.

## Consumers

`definitionClusters` is additive metadata; its downstream readers:

| Consumer | Uses | Code |
|---|---|---|
| **Example sentences** (est) — generation | The list of `sense` labels + per-cluster `vernacularScore`, to tag each generated sentence with the target-word sense it demonstrates and to steer coverage toward every register-4/5 sense. | `server/scripts/backfill/chinese/backfill-example-sentences.js` (`buildSenseContext`) — see [EXAMPLE_SENTENCES.md](./EXAMPLE_SENTENCES.md) |
| **Example sentences** (est) — per-segment tagging | Each segment's own cluster labels are offered to the tagging pass, which writes a `senseDict[segment]` label; at read time a matching cluster's `ddt(cluster)` becomes that segment's displayed dd. | `backfill-example-sentences.js` (`tagSentenceSegments`), `server/dal/shared/segmentString.ts` (`buildSegmentMetadata`) |
| **flp sense-picker** (EnglishBlock) | `ddt(cluster)` renders each cluster as a display string in the dropdown; the menu is **sectioned by `reading`** (one `ListSubheader` per distinct pinyin, tone-marked via `numberedToTonedPinyin` and per-syllable tone-colored via `getToneColor`), preserving the vernacular sort within each section and the star on the global default (index 0). The clusters are ordered by the shared `sortedSenseClusters(entry)` helper (highest vernacular first) — the single source of truth both the picker and the persistence layer address. | `src/utils/definitionUtils.ts` (`ddt`, `sortedSenseClusters`), `src/features/flashcards/FlashcardsLearnPage/FlashCardSection.tsx` (`EnglishBlock` → `senseSections`), `src/utils/textUtils.ts` (`numberedToTonedPinyin`), `src/utils/toneColors.ts` (`getToneColor`) |
| **Per-account sense selection** (`selectedSense`, migration 99) | The learner's chosen sense is persisted **per user per word** so it survives reloads/re-promotion. Stored as the cluster's `sense` LABEL (not an index) so it's stable across re-clustering/re-scoring; resolved back to a sorted index on read (falls back to the default/starred sense if the label no longer matches). Only the two user-context surfaces persist — the **read-only dictionary cdp uses a det-fallback entry with no userId and always shows the default** (its picker is local-only, never saved). | vet column `selectedSense` (`database/migrations/99-add-selected-sense-to-vocabentries.sql`); `src/utils/definitionUtils.ts` (`resolveSelectedSenseIndex`); `src/utils/vocabApi.ts` (`saveSelectedSense`); flp: `useCardIconEditor.ts` (`persistSelectedSense`) → `FlashCardSection.tsx` (`CardFace.handleSelectSense`); saved-card cdp: `VocabCardDetailPage.tsx` (`handleSelectSense`); server: `PATCH /api/vocabEntries/:id/selected-sense` (`VocabEntryController.updateSelectedSense` → `VocabEntryService.updateSelectedSense` → `VocabEntryDAL.updateSelectedSense`) |

## Human review: model self-flagging via stdout

There is **no review file and no embedding guardrail**. The clustering model
flags its own uncertainty: Stage A returns `{ clusters, reviewNotes }`, and
prompt rule 6 tells it to add a short note to `reviewNotes` for **anything it is
even slightly unsure about** — an ambiguous sense boundary, a gloss that could
sit in two clusters, an uncertain/guessed `reading` (especially heteronyms), an
unsure register/pos, or broken source glosses. It errs heavily toward flagging.

The script augments those with low-confidence signals from the Stage B ordering
critic (`low_confidence` action) and any per-cluster scoring failure, then prints
every note to **stdout** as a greppable line:

```
⚠ CLUSTER REVIEW 中 (id=3216): 'all right / OK (dialect)' — uncertain whether zhong4 or zhong1 …
```

The run summary tallies `Flagged for review: N entries`. The marker string
(`REVIEW_MARKER` in the script) is stable so the **mark-discoverable skill agent
detects these lines and surfaces them to the user** (see
`.claude/commands/mark-discoverable.md`, §A3) — clustering is the last step of
that pipeline. These flags are the cases most likely to need a manual fix (e.g. a
wrong heteronym reading) before `/data-deploy`.
