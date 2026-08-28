# Definition Clusters

> Child of [DEFINITION_MAPPING.md](./DEFINITION_MAPPING.md) — the index of all
> definition forms across the app and the operations between them. This doc
> covers one form: `definitionClusters`.
>
> **Deploying the Spanish convergence (migration 123)?** See
> [ES_CLUSTERED_SENSES_DEPLOYMENT.md](./ES_CLUSTERED_SENSES_DEPLOYMENT.md) — the
> operational runbook: migration ordering, pre-flight checks, locking/runtime,
> verification, rollback, and the post-deploy clusterer run.

Splits a dictionary entry's flat `definitions` array into **sense clusters**
stored in the `definitionClusters` jsonb column. Many headwords carry
mutually-unrelated meanings (会 = "can" / "will" / "to meet" / "meeting" / the
kuài "to reckon accounts" sense); a single globally-ranked list forces those
senses to interleave. Clustering groups each sense, ranks glosses
prototypical→vernacular **within** the cluster, and scores each cluster's
frequency **independently**.

**Both languages use this model** — Chinese since migration 90, Spanish since
migration 123. They differ only in what makes a hard sense boundary:

| | Chinese (zh) | Spanish (es) |
|---|---|---|
| Boundary field | `reading` — heteronyms never share a cluster (会 hui4/kuai4) | `pos` + `gender` — gender carries distinct meaning (`cura`/f "cure" vs `cura`/m "priest") |
| The other field | `gender` is NULL | `reading` is NULL (Spanish pronunciation is not per-sense) |
| Migration | 90 | 123 |
| Clusterer | `chinese/backfill-cluster-definitions.js` | `spanish/backfill-cluster-definitions.js` |

Spanish arrived here from the opposite direction. Its senses used to be
**materialized as ROWS** — one det row per (word1, pos, gender) — with a whole
parallel code path (`vocabentries_es.pos` in the card's identity, a `match_rank`
preference in the dict join, `hasMultiplePos`/`alternateGender`/`alternateMeaning`
columns, a POS badge) existing solely to answer "which row did the learner mean?".
Migration 123 merged those rows and deleted that path: the question is now answered
one layer up by the learner's `selectedSense`, exactly as it always was for Chinese.

## Goal & design rationale

**What we're trying to do:** turn a flat, single-ranked gloss list into a small
set of *learnable senses*, each with its own reading and its own register score,
so a flashcard can show "this word's distinct meanings" instead of one
interleaved blob. Three properties matter:

1. **One reading per cluster.** Heteronyms (会 hui4/kuai4, 得 de2/de5/dei3, 和
   he2/huo2/he4/hu2) never share a cluster — reading is a hard boundary. This
   also lets a future per-reading row split be a pure data migration.
2. **Frequency is per-cluster, not per-word.** A word-level `frequencyScore` is a
   lie for polysemes: 干 "to do" comes up constantly (5) while 干 "shield" is
   effectively never spoken (1). Each cluster is scored independently.
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

`dictionaryentries_zh."definitionClusters"` and
`dictionaryentries_es."definitionClusters"` — `jsonb`, nullable (NULL = not yet
clustered). Array of cluster objects; ONE shape for both languages:

```jsonc
// zh — separated by reading
[
  { "sense": "to be able to / know how", "reading": "hui4", "pos": ["verb"], "gender": null,
    "frequencyScore": 5, "glosses": ["can", "to know how to", "to have the skill"] },
  { "sense": "to reckon accounts", "reading": "kuai4", "pos": ["verb"], "gender": null,
    "frequencyScore": 1, "glosses": ["(bound form) to reckon accounts"] }
]

// es — separated by pos + gender
[
  { "sense": "cure / remedy", "reading": null, "pos": ["n"], "gender": "f",
    "frequencyScore": 4, "glosses": ["cure (something that restores good health)", "healing"] },
  { "sense": "priest", "reading": null, "pos": ["n"], "gender": "m",
    "frequencyScore": 3, "glosses": ["priest", "curate"] }
]
```

| Field | Meaning |
|---|---|
| `sense` | short English label for the shared meaning. **Unique within the entry** — `vet.selectedSense` addresses a cluster by this label |
| `reading` | zh: numbered pinyin for **this** sense — heteronyms differ (会计 → `kuai4`), so a future per-reading row split is a pure data migration, not a schema change. **NULL for es**. Read by the flp sense-picker's section headings and by the est read path, where it becomes the *rendered* pinyin of a tagged segment (see the est consumer row below) — so a wrong reading here is now user-visible in two places, not just the picker |
| `pos` | part(s) of speech for this sense — **always `string[] \| null`** (single-POS senses are a 1-element array). Normalized at write time by `toPosArray`; existing rows were migrated string→array. es reuses the raw Wiktionary abbreviations (`n`, `v`, `adj`, …) |
| `gender` | es: grammatical gender of **this** sense (`m`, `f`, `mf`, `m-p`, …). This is what a Spanish gender-homograph's second det ROW became in migration 123. **NULL for zh** |
| `frequencyScore` | 1–5 conversational commonality — how much this sense would stand out if a friend used it casually (axis re-pointed 2026-08-28; see [DEFINITION_MAPPING.md](./DEFINITION_MAPPING.md)) — scored **independently per cluster** (`null` = scoring failed). Same rubric/scale as the word-level `frequencyScore`. Also the **sort key**: `sortedSenseClusters` orders by it, so the highest-scoring cluster is the entry's default/starred sense. **This is the number the eip/cdp "Commonality" chip shows** — see below |
| `glosses` | verbatim source glosses, ordered prototypical→vernacular within the cluster |

**Difficulty stays at the word level** (the `difficulty` column) and is *not*
duplicated per cluster.

### Where the per-cluster `frequencyScore` surfaces

The eip definition tab (`InfoCardTabContent.tsx`) and the read-only dictionary cdp's
Definition box (`VocabCardDetailBody.tsx`) both render a **"Commonality"** chip — five dots plus an
`N/5` readout. It shows the **selected sense's** cluster score, not the entry's
`frequencyScore` column: on a polyseme the word-level number contradicts the gloss
printed directly above it (干 "to do" = 5, 干 "shield" = 1).

`resolveCommonality` (`src/utils/definitionUtils.ts`) is the single resolver, and it
mirrors `resolveDisplayDefinition` step for step so the two can never disagree about
which sense is showing:

1. a clustered entry (≥2 displayable clusters) whose chosen cluster has a non-null
   `frequencyScore` → that score, tagged with the cluster's `sense` label;
2. otherwise — unclustered, single-cluster, or a cluster whose scoring pass failed →
   the entry-level `frequencyScore`, with a null label.

The chip follows the same sense the card is on: both the cdp and the eip pass their
host page's live `selectedSenseIndex` as the override, so the meter changes on the tap
rather than waiting for the persisted `selectedSense` to round-trip back (in the eip's
case via `useEipTabs.syncEntry`).

**Saved-card cdp — two pickers, one index.** Since it raises the eip itself
(`VocabCardDetailPage` → `InfoCardSection`), that page shows the picker twice: on the hero
card face (`EnglishBlock`) and in the panel header. Both are driven by the page's single
`selectedSenseIndex` state and both persist through the same `handleSelectSense`, so they
cannot disagree. Note the contrast with the flp/scp, where the panel's index lives per
entry tab inside `useEipTabs` — the cdp has no entry tabs (it drills in by navigating), so
page state is the simpler home for it.

The returned `senseLabel` is also what decides the chip's **validation target**: non-null
→ the `senseFrequencyScore` field addressed by that label; null → the entry-level
`frequencyScore` field. Approving one never vouches for the other. See
[DATA_VALIDATION_SYSTEM.md](./DATA_VALIDATION_SYSTEM.md) (migration 139) — which also
explains why both clusterers now carry a `validatedClause` guard: they rewrite
`definitionClusters` wholesale, so a reviewed sense freezes the row.

Referenced code: `src/utils/definitionUtils.ts` (`resolveCommonality`,
`sortedSenseClusters`, `resolveSelectedSenseIndex`),
`src/features/flashcards/FlashcardsLearnPage/InfoCardTabContent.tsx`,
`src/features/flashcards/VocabCardDetailBody.tsx`,
`src/components/FrequencyScoreDots.tsx` (the shared five-dot meter),
`src/__tests__/resolveCommonality.test.ts`.

### The word/cluster frequency invariant

```
det."frequencyScore"  ==  MAX(definitionClusters[*].frequencyScore)
```

**Why it must hold.** The word-level score is *defined* as "score its most
frequently-heard everyday meaning" (the `word` polysemy guideline in
`scripts/backfill/chinese/lib/frequencyScore.js`), and the clusters **are** that
word's meanings. The word-level number is therefore not independent evidence — it is
the max of the per-sense numbers.

**Why it drifted.** The two numbers are written by two independent AI passes that
never see each other — `backfill-frequency-score.js` writes the column,
`backfill-cluster-definitions.js` Stage C writes the per-cluster scores — with no
reconciliation between them. A 2026-08-28 audit found the invariant violated on
**430 / 4276** comparable zh rows (10%) and **562 / 885** comparable discoverable es
rows (63%).

**Why it is user-visible.** The two numbers feed *different* surfaces, so a learner
can see both at once and they contradict: the eip/cdp **Commonality** chip shows the
selected *cluster's* score, while the *word* column drives starter-pack and
provisional-card ordering, search relevance and the gsa tie-break. 讨论 shipped as
word = 3 with its only sense scored 5.

**Repair rule — ratchet up.** Neither pass dominates, so the repair takes
`max(word, maxCluster)` on both sides rather than trusting one:

| direction | example | why the higher number wins |
|---|---|---|
| word < max cluster (354 zh, 561 es) | 讨论 word 3, sense "to discuss" 5 | the sense pass deflates common words — its guideline pushes back against headword familiarity |
| word > max cluster (76 zh, 1 es) | 老公 word 5, senses "husband" 3 / "eunuch" 1 | the sense pass under-scored the *core* sense; the word pass had it right |

When the clusters need lifting, only the **default** cluster is raised — the one the
learner is already on — so the repair never changes which sense a card shows. A rare
sense is never raised (老公 "eunuch" stays at 1), and nothing is ever lowered.

**Bound forms count through their compounds** (rubric rule added 2026-08-28). A
morpheme that is never uttered alone is still *heard* constantly if the compounds
carrying that meaning are common: 自 is bound, yet a learner meets it daily inside
自己/自由/自动, so its senses score as frequent. This is what separates a
bound-but-everywhere morpheme (自) from a genuinely rare one (兮).

**How it is now enforced.** `reconcileFrequencyScore`
(`scripts/backfill/shared/lib/senseClusters.js`) is the single implementation, called
from three places:

| where | when |
|---|---|
| `scripts/backfill/shared/repair-frequency-score-drift.js` | one-off repair of existing rows; language-generic, no API calls, `--dry-run` supported |
| both `backfill-cluster-definitions.js` (zh + es) | every cluster write reconciles the word column in the **same statement** |
| both `backfill-frequency-score.js` (zh + es) | the word write is floored at the entry's best cluster score, in SQL |

A validator's approval outranks the invariant: every path skips (or `CASE`-guards)
entries validated on `frequencyScore` / `senseFrequencyScore`, which is the one way a
row may legitimately remain inconsistent.

Referenced code: `server/scripts/backfill/shared/lib/senseClusters.js`
(`reconcileFrequencyScore`, `defaultClusterIndex`, `maxClusterScore`,
`clusterLeadGloss`, `isDisplayable`),
`server/scripts/backfill/shared/repair-frequency-score-drift.js`,
`server/scripts/backfill/{chinese,spanish}/backfill-cluster-definitions.js`,
`server/scripts/backfill/{chinese,spanish}/backfill-frequency-score.js`,
`server/__tests__/frequencyInvariant.test.ts`.

### Where the per-cluster `reading` surfaces — the display pinyin

Every surface that shows a **sense-resolved definition must show that sense's own
pinyin**. A heteronym's reading belongs to the sense, not the word: 过去 is `guò qù`
for "the past" and `guò qu` for the verb-directional suffix; 会 is `huì` for "can" and
`kuài` for "to reckon accounts". The entry-level `pronunciation` column can hold only
one of them, so a surface that resolves the gloss per sense but reads the column for
pinyin prints one sense's English over another sense's tones — wrong, and silent.

`resolveDisplayPronunciation` (`src/utils/definitionUtils.ts`) is the single resolver. Its
sense pick comes from `readingCluster`, which agrees with `resolveDisplayDefinition` about
which sense is showing whenever a picker exists:

1. **A picker exists** (`sortedSenseClusters`, ≥2 displayable clusters) → the chosen
   cluster's `reading`, converted from the stored NUMBERED form to the tone-MARKED form the
   app renders (`numberedToTonedPinyin`, `src/utils/textUtils.ts`). The client resolver's
   `senseIndexOverride` is an index into that same list, so the two sides cannot desync.
2. **No picker** (single cluster, or several clusters of which fewer than two are
   displayable) → the entry's PRIMARY reading: the highest-frequency cluster, preferring one
   that carries displayable English so a gloss-less particle sense cannot donate its reading
   to a real gloss's card.
3. **No cluster reading at all** — unclustered (the ~110k non-discoverable det rows), or
   Spanish (whose clusters carry `reading: null`) — or a reading whose **syllable count
   disagrees with the column** → the entry-level `pronunciation` column.

#### Why pinyin does NOT share the dd's `< 2` gate

`resolveDisplayDefinition` bails to `definitions[0]` when there is no real sense choice; the
pinyin resolver does not. The two fields have different fallbacks:

| | Fallback when there is no sense choice | Is the fallback trustworthy? |
|---|---|---|
| **dd** | `definitions[0]` | Yes — a curated, hand-ordered lead gloss. A genuinely different artifact, often the better string. Gate stays. |
| **pinyin** | `pronunciation` / `numberedPinyin` | No — the same fact stored twice, and this is the UNREVIEWED copy. Gate dropped. |

`backfill-cluster-definitions.js` seeds the model with the column as `primaryReading`,
instructs it to override that for genuine heteronyms, and writes back **only**
`definitionClusters` — it never writes the column. The column is therefore
upstream-of-review by construction and drift is permanent and one-directional: 重点 kept
`chóng diǎn` in its column long after its clusters were corrected to `zhòng diǎn`. Roughly
**74% of discoverable zh entries are single-cluster**, so gating pinyin on `< 2` would pin
most of the corpus to the unreviewed copy.

Measured on the 4,224 discoverable zh entries when this landed (2026-08-19): 97 readings
changed — 48 multi-cluster (真 heteronym corrections: 重点, 重重, 老子, 用人) and 49
single-cluster (tone digits the column had lost: 安定门 `an` → `ān`, 二林 `er` → `èr`). A
further 174 changed only in capitalization, the clusters capitalizing proper nouns
(`xī fāng` → `Xī fāng`) where the column is uniformly lowercase. Spanish is a no-op:
`reading` is always null there and the column is empty.

> ⚠️ The `pronunciation` column is not merely stale, it is partly **corrupt**: 2,414 zh rows
> (45 discoverable) hold a misplaced tone mark — `hoù`, `roù`, `yoù` — because the column was
> generated by `numberedToTonedSyllable` while that function omitted `o` from its
> mark-placement group (fixed 2026-08-19; see the note under Consumers). The clusters route
> around it for discoverable words, so no backfill was run.

**The narrated audio uses the same resolver** (fixed 2026-08-18). `useTTS.speak` passes
its pronunciation hint through to `CloudTTSProvider`, which sends it to Google TTS as an
SSML `<phoneme>` tag — so the hint genuinely decides **which reading is spoken**, and a
disagreement with the displayed pinyin is audible rather than cosmetic.

`speak` used to send the raw `entry.pronunciation` column while every card face rendered
`resolveDisplayPronunciation`. For a polyphone the two differ by construction: 和 shows
**huó** on its "to mix / blend" sense and was narrated **hé** from the headword column.
Reported from live play in Hydra Bubbles, but it affected every surface with audio — the
games, the cdp, discover, and the flp. A learner hearing one syllable while reading
another has no way to know which is wrong, which is worse for a beginner than no audio.

`speak(entry, senseIndexOverride?)` now mirrors the resolver's own signature. The
override exists for a caller holding a **live** sense pick that has not yet round-tripped
to `entry.selectedSense` — the flp's picker moves `selectedSenseIndex` on tap, so
`FlashCardSection` narrates through a `speakWithSense` wrapper. Every surface without a
picker omits it and gets the persisted sense, which is what its face is showing anyway.
`prefetch` uses the resolver too, or it would warm a cache key nothing ever asks for (the
buffer is keyed on text + pinyin + voice). Pinned by
`src/__tests__/resolveDisplayPronunciation.test.ts`.

That syllable-count guard exists because cpcd zips syllables to characters positionally
(see [CPCD_PINYIN_SHIFT.md](./CPCD_PINYIN_SHIFT.md)): a mis-shaped cluster reading would
shift every character's pinyin one column over rather than fail loudly.

**Where it is applied.** The rule is: **if the clusters travel to the client, the client
resolves; if they stay server-side, the server resolves.** No surface reads the raw column.

Client — the flashcard face's `ChineseBlock` (which takes the live `selectedSenseIndex` so a
pick made this session shows immediately, exactly like the gloss), the cdp hero AND the cdp
header block (both on one entry, so both take the same `selectedSenseIndex`), the eip header,
and the game prompts (match speed, bubble match, speed reading).

Server — the payloads that materialize a sense-resolved dd where the clusters do NOT travel,
via the twin `resolveDisplayPronunciation` in `server/utils/definitions.ts` (numbered→toned
via `server/utils/pinyinTones.ts`). In each, the clusters are selected purely to feed the
resolvers and are stripped before the row leaves the method, so no wire DTO carries them:

| Payload | Site | Sense pick |
|---|---|---|
| discover / sort cards (scp, QuickMark, Skipped) | `StarterPacksService._rowsToDiscoverCards` | default — no vet row exists yet |
| Study Challenge word cards | `StudyChallengeDAL` (`findCandidates` + stored-word display) | default |
| community feed designs | `CommunityLayoutDAL` (`feedSelect` → `normalize`) | the **design owner's** `selectedSense` |
| used-in list, pass 1 (saved words) | `VocabEntryDAL.findUsedInForCharacter` | the learner's `selectedSense` |
| used-in list, pass 2 (dictionary words) | same | default — no pick to honor, but the default branch still applies |
| Word Search word list | `OnDeckVocabService` | default |
| related-words list | `VocabEntryDAL.findRelatedBySharedCharacters` | learner's pick where saved |

**Not covered (deliberate):** **card** TTS still narrates the entry-level `pronunciation`
(`src/hooks/useTTS.ts` `speak`/`prefetch`, and the server-side audio prewarm in
`OnDeckVocabService.prewarmAudio`). Making audio per-sense means the prewarm and the
cloud-TTS cache key must resolve the same sense, so it is a separate change. (Example-sentence
*segment* narration is already sense-correct — it passes `segmentMetadata[seg].pronunciation`,
which the est path resolves per sense; see the est consumer row below.)

Referenced code: `src/utils/definitionUtils.ts` (`resolveDisplayPronunciation`,
`readingCluster`), `server/utils/definitions.ts` (server twins),
`server/services/StarterPacksService.ts` (`_rowsToDiscoverCards`),
`server/dal/implementations/StudyChallengeDAL.ts`,
`server/dal/implementations/CommunityLayoutDAL.ts` (`feedSelect`, `normalize`),
`src/features/flashcards/VocabCardDetailPage.tsx` (cdp header block),
`src/__tests__/numberedToTonedPinyin.test.ts` (tone-mark placement),
`server/utils/pinyinTones.ts`
(numbered→toned + the `readingSyllableCount` shape guard; client twin
`src/utils/textUtils.ts`),
`src/features/flashcards/card/CardFace.tsx` (`ChineseBlock`, `selectedSenseIndex` prop),
`src/features/flashcards/FlashcardsLearnPage/InfoCardPanelBody.tsx`,
`src/components/MiniVocabCard.tsx`, `src/games/match-speed/MatchSpeedCard.tsx`,
`src/games/bubble-match/Bubble.tsx`, `src/games/speed-reading/SpeedReadingPrompt.tsx`,
`server/dal/implementations/VocabEntryDAL.ts` (`findRelatedBySharedCharacters`,
words-containing-char), `server/services/OnDeckVocabService.ts` (Word Search inputs),
`src/__tests__/resolveDisplayPronunciation.test.ts`.

- Migrations: `database/migrations/90-add-definition-clusters-to-zh.sql` (zh),
  `database/migrations/123-es-word1-unique-clustered-senses.sql` (es — adds the
  column, merges the per-(pos,gender) rows into one row per `word1`, and seeds a
  mechanical cluster per merged row)
- Types: `DefinitionCluster` in `server/types/index.ts` and `src/types.ts`
  (added to the `DictionaryEntry` shape as `definitionClusters`).
- Display helper: `senseGrammarTag` in `src/utils/definitionUtils.ts` renders a
  cluster's `pos`/`gender` as a short tag ("n · m") for the picker's flat (es) path.

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
| **C — Score frequency** | Scores each cluster's conversation frequency 1–5 **independently** (会 "can"=5 vs "accounts"=1), identical rubric to the word-level scorer. | `lib/frequencyScore.js` (`createFrequencyScorer` → `scoreFrequency`) |
| **C.5 — Tiebreak order** | Ranks the clusters that came back with the **same** `frequencyScore`, because array order is what every read-side sort uses to break a score tie (see "Ties" below). One call per entry that *has* a tie, none otherwise. Permutes tied clusters **within the slots they already occupy** — cross-band order is left to the read-side sort, and no `sense`, `glosses`, `pos` or score is edited. On any failure the original order is kept and a review note is printed. Skippable with `--no-tiebreak`. | `shared/lib/tiebreakOrder.js` (`createClusterTiebreaker` → `tiebreakClusterOrder`, `tieGroups`) |

The clusterer then writes **only** `definitionClusters` and stamps the run log.

Stage A's model is overridable for A/B testing via the `CLUSTER_MODEL` env var
(defaults to Sonnet; e.g. `CLUSTER_MODEL=claude-opus-4-8` runs the whole split on
Opus). The Opus retry escalation is independent of this.

### Ties: why array order is a ranking, not an accident

Every read path orders a word's senses with the **same** comparator — highest
`frequencyScore` first, nulls last — in three twins that must stay in lockstep:
`sortedSenseClusters` (`src/utils/definitionUtils.ts`), `resolveSelectedCluster`
(`server/utils/definitions.ts`) and `defaultClusterIndex`
(`server/scripts/backfill/shared/lib/senseClusters.js`). The comparator returns 0 for two
clusters sharing a score, and all three sorts are **stable**, so a tie falls through to the
order of the stored `definitionClusters` array. Index 0 of that sorted list is the sense the
card shows as its dd and the one the picker **stars**, so a tie at the top score is not a
cosmetic question — it picks the default sense.

Ties are structural, not rare. The 1–5 scale is coarse **on purpose** (it asks how much a
sense would stand out, not how often it occurs), and Stage C scores each cluster in an
**independent** call that never sees its siblings — so it cannot break its own ties even in
principle. Before v6, when the scorer was accidentally scoring the *headword* for every
cluster, 39.4% of clustered discoverable entries had their default decided this way; v6 cut
the rate but not the mechanism.

**Stage C.5 is the missing comparison** (added 2026-08-28, zh `SCRIPT_VERSION` 9). It shows
one model every cluster that landed on the same band and asks only which of them a learner
meets first — the marginal difference the 1–5 scale was too coarse to record. Its rubric:
everyday concrete usage over figurative; a sense that stands alone as a word over one that
only lives inside fixed compounds; broader coverage over a narrow/domain sense; plain modern
usage over formal, regional or dated. The score is an **input** there and never an output —
the model is explicitly forbidden to re-score, so a "this is really more common" judgement
comes out as an order, not as a band change.

What C.5 may change is deliberately narrow: **only** the relative order of clusters that
already share a score, and only among the array slots those clusters already occupy.
Cross-band order stays owned by the read-side sort (two opinions about it would be one too
many), and non-displayable clusters are excluded from every tie group since the picker drops
them before it sorts. Because nothing but order changes, C.5 can never orphan a
`vet.selectedSense` label, a per-sense `longDefinition` key or an est sentence tag — all of
which address a cluster **by label**. That is also why `--rescore-only` runs it: a re-score
produces exactly the ties C.5 exists to settle.

Spanish does the same job **inline** rather than as a separate pass (`CLUSTER_RULES` rule 7,
`spanish/backfill-cluster-definitions.js`, `SCRIPT_VERSION` 3): its single generate call
already sees every cluster *and* assigns every score, so it can emit the clusters in ranked
order directly. The zh scorer's per-cluster isolation is what forces zh to pay for an extra
call.

### Shared cores (one source of truth)

The ordering and register logic were extracted out of the two standalone
backfills into `lib/` so the clusterer reuses them verbatim rather than
re-implementing the prompts:

- `lib/orderGlosses.js` — Pass-1 reorder/prune prompt, Pass-2 critic, short-gloss
  synthesis, the parenthetical/validation helpers, and `createGlossOrderer`.
  Imported by `backfill-process-definitions-array.js` (flat array) and
  `backfill-cluster-definitions.js` (per cluster).
- `lib/frequencyScore.js` — the `SCALE_AND_GUIDELINES` rubric, `SCORE_LABELS`,
  and `createFrequencyScorer`. Imported by `backfill-frequency-score.js`
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
docker exec cow-backend-local npx tsx scripts/backfill/chinese/backfill-cluster-definitions.js --no-tiebreak # skip the Stage C.5 tied-sense ordering
docker exec cow-backend-local npx tsx scripts/backfill/chinese/backfill-cluster-definitions.js --rescore-only # Stage C only: re-score, keep the partition
```

### ⚠ After a scoring-only `SCRIPT_VERSION` bump, use `--rescore-only`, never `--stale`

A version bump marks every row stale, so `--stale` is the reflex — and it is the wrong
flag here. `--stale` re-runs the WHOLE pipeline (Stage A split → B critic → A.5 merge),
which **repartitions senses and mints new `sense` labels**. Labels are addresses:
`vet.selectedSense` (the learner's saved sense choice), `longDefinition`'s per-sense
keying and the est sentences' `sense` tags all resolve a cluster BY LABEL, and an
unmatched label silently falls back to the default sense. A learner who picked one
sense of 会 would be moved off it.

`--rescore-only` runs Stage C alone: same clusters, same labels, new numbers. Use it
whenever only the frequency rubric changed — as it did on 2026-08-28, when the scale's
axis was re-pointed (see [DEFINITION_MAPPING.md](./DEFINITION_MAPPING.md) §
`frequencyScore`). The same distinction applies to the lazy-enrichment bulk drain,
which spawns steps with `--stale`: see
[DISCOVER_LAZY_ENRICHMENT.md](./DISCOVER_LAZY_ENRICHMENT.md) § 5.

**Every entry with ≥1 definition is clustered — single-gloss words included** (they
become a trivial one-cluster array, never left NULL). There is no `definitions > 1`
gate: downstream consumers key on `definitionClusters IS NULL`, so leaving
single-gloss words unclustered would wrongly read as "not processed".

**Single-definition fast path (zero API calls).** A one-definition entry skips *every*
model call (Stage A/A.5/B/C) and is built locally: the lone definition is used verbatim
as both the cluster's `sense` label and its only gloss, with `reading` = the row's
primary reading. `pos` and `frequencyScore` are **copied from the word-level columns**
(`partsOfSpeech`, `frequencyScore`) rather than re-derived — for a single-sense word
the word-level values already describe that one sense, so no API call is needed. Both
fall back to `null` if their column isn't populated at clustering time, so in the
mark-discoverable pipeline **`backfill-parts-of-speech` and `backfill-frequency-score`
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

## The Spanish clusterer

`server/scripts/backfill/spanish/backfill-cluster-definitions.js` — **step 6** of the
mark-discoverable §B3 pipeline, where it replaced `backfill-parts-of-speech.js`. The
canonical order is `REQUIRED_SCRIPTS_ES` in
`server/scripts/backfill/shared/lib/requiredScripts.js`.

> ⚠️ **`spanish/backfill-process-definitions-array.js` MUST run before the clusterer.**
> `checkShape` (below) enforces an exact partition of `definitions`, and process-defs
> re-orders and *prunes* that array — clustering first leaves the stored partition
> pointing at glosses the row no longer has. This matches zh, where process-defs is
> manifest step 4 and clustering step 10.
>
> For es there is a second, stronger reason: process-defs also **splits comma-joined
> synonym runs** (docs/DEFINITION_MAPPING.md, "Step 4, Spanish only"). Cluster first and
> every cluster gloss is a whole synonym list — `abrir`'s partition would contain
> `"to open, open up"` rather than `"to open"` and `"to open up"` — which then propagates
> into `ddt` (the per-cluster dd) and into the sense labels that `longDefinition` and
> `exampleSentences` join on.
>
> One deliberate zh/es divergence sits next to it: zh's single-gloss fast path *copies*
> the word-level `partsOfSpeech`/`frequencyScore` onto the lone cluster, so zh hard-requires
> those steps first. The es fast path writes `frequencyScore: null` and lets the word-level
> column own it, so es has no such dependency — `frequency-score` is ordered ahead of
> clustering only to keep the two pipelines the same shape.

```bash
docker exec cow-backend-local npx tsx scripts/backfill/spanish/backfill-cluster-definitions.js               # discoverable, never AI-clustered
docker exec cow-backend-local npx tsx scripts/backfill/spanish/backfill-cluster-definitions.js --force       # re-cluster
docker exec cow-backend-local npx tsx scripts/backfill/spanish/backfill-cluster-definitions.js --words=cura,perro
docker exec cow-backend-local npx tsx scripts/backfill/spanish/backfill-cluster-definitions.js --dry-run     # print clusters, write nothing
docker exec cow-backend-local npx tsx scripts/backfill/spanish/backfill-cluster-definitions.js --spot-check  # first 5 words, implies --dry-run
```

**Shape: one generation call, not zh's four stages.** Where the Chinese clusterer
runs split → merge → order → score as separate passes, the Spanish one asks a single
Opus call for the finished clusters (labels, pos/gender, gloss order, and per-cluster
`frequencyScore` together), then has a Sonnet reviewer accept-or-critique it, with one
Opus regeneration on rejection. It can do this because Spanish starts from a much
stronger prior: Wiktionary already tagged every gloss with its pos and gender, so the
model is *checking and refining* a partition rather than discovering one from a flat
list. `checkShape` still enforces an EXACT PARTITION (every source gloss used once,
verbatim, none invented or dropped) deterministically, before any model judges quality.

| Stage | What | Code |
|---|---|---|
| **Generate** | Opus partitions the entry's glosses into clusters, labels each sense, assigns pos/gender, orders glosses within the cluster, scores each cluster's conversation frequency 1–5, **and emits the clusters most- to least-common** — rule 7, with same-score ties ordered by the marginal difference the 1–5 scale cannot record, because array order is what breaks a tie on read (see "Ties" above). This is zh's Stage C.5 done inline; one call sees every cluster and its score, so es needs no separate pass. | `generateClusters`, `CLUSTER_RULES` |
| **Check** | Deterministic: exact partition, unique sense labels, score range. No API call. | `checkShape` |
| **Review** | Sonnet judges *quality* only — mixed meanings, mergeable duplicates, violated pos/gender boundaries, a wrong lead gloss, an implausible score, **and a cluster order that would star the wrong default sense**. | `validateClusters` |
| **Retry** | Opus regenerates against the critique; if the retry fails the partition check, the first (mechanically valid) attempt is kept — a rejected retry must never lose a gloss. | `regenerateClusters`, `runPipeline` |

**Seeded clusters are input, not output.** Migration 123 wrote a *mechanical* cluster
per merged row for the 9,087 multi-row words, carrying Wiktionary's pos/gender. Those
are fed to the model as the source senses. Because a seeded row is already non-NULL,
the "already clustered?" gate can't be `definitionClusters IS NULL` — it is instead
`enrichmentLog ? 'spanish/backfill-cluster-definitions'`, i.e. *has this script ever
stamped this row*. The migration deliberately did not stamp.

**Single-gloss fast path (zero API calls)**, same idea as zh: the lone gloss becomes
both the label and the only gloss, `frequencyScore` left NULL for the word-level scorer.

**It only ever UPDATEs `definitionClusters` + `partsOfSpeech` on one row.** No INSERT,
no DELETE, no discoverable-toggling — all of which its predecessor did, because senses
were rows. And like zh it never writes `definitions`.

## Consumers

`definitionClusters` is additive metadata; its downstream readers:

| Consumer | Uses | Code |
|---|---|---|
| **Example sentences** (est) — generation | The list of `sense` labels + per-cluster `frequencyScore`, to tag each generated sentence with the target-word sense it demonstrates and to steer coverage toward every register-4/5 sense. | `server/scripts/backfill/chinese/backfill-example-sentences.js` (`buildSenseContext`) — see [EXAMPLE_SENTENCES.md](./EXAMPLE_SENTENCES.md) |
| **Example sentences** (est) — per-segment tagging | Each segment's own cluster labels are offered to the tagging pass, which writes a `senseDict[segment]` label; at read time the matching cluster supplies **both** that segment's displayed dd (`ddt(cluster)`) **and** its pronunciation (`cluster.reading`, tone-marked) — so a heteronym in a sentence reads as the sense the sentence uses (会 = kuài in "to reckon accounts"), including in TTS narration. | `backfill-example-sentences.js` (`tagSentenceSegments`), `server/dal/shared/segmentString.ts` (`buildSegmentMetadata`, `senseReading`), `server/utils/pinyinTones.ts` |
| **sense-picker** (shared `SensePicker`) | **Two states, one component (redesigned 2026-08-24, artboards 19–25).** RESTING (`.ssel`) is a small pill carrying a counter and a triangle — `1/9` — sitting directly under the gloss on every surface. It replaced a bare triangle, which said "there is a control here" and nothing else; the counter says the two things a learner needs at rest (this word has nine meanings; you are on the first), which is what lets a set-and-forget control be this small and stop asking for attention on a word whose sense is settled. OPEN (`.ssheet`) lifts a compact sheet showing EVERY sense at once, so the choice is made by COMPARING in one look rather than by paging; it closes on the pick. The sheet's own header names the count and the trailing column ONCE (a column header belongs to the column, not to the first group in it — it used to be repeated into the first reading heading). Rows mark the showing sense by **weight**, not by a tick in a gutter: a tick pushes all nine labels off their own margin to mark one of them. Still a MUI `Menu` underneath the restyle — the portal, anchor tracking, outside-tap dismiss and focus trap are exactly what a sheet lifted off a chip inside a draggable card needs, and hand-rolling them on a gesture-heavy surface would be three bugs. Mounted by the flp/cdp card face (`EnglishBlock`) **and by the eip definition header** (`InfoCardPanelBody`) — one component, so the two surfaces always offer the same senses in the same order under the same labels. It self-hides when the entry has no real choice. `ddt(cluster)` renders each cluster as a display string in the dropdown. **zh — sectioned by `reading`**: one `ListSubheader` per distinct pinyin, tone-marked via `numberedToTonedPinyin` and per-syllable tone-colored via `getToneColor`, preserving the frequency sort within each section and the star on the global default (index 0). **es — flat list**: `senseSections` returns null when no cluster carries a reading (sectioning would emit one meaningless "—" heading over the whole list), so each row renders instead with its own `senseGrammarTag` ("n · m") to carry the disambiguation. Both paths render through the same `renderSenseItem` so selection/star/stop-propagation can't drift apart. **Front/question side censors the readings**: on flp Side 1 (English question side) `EnglishBlock` is passed `censorReadings`, which replaces each pinyin heading with a neutral ordinal label ("-pinyin 1-", "-pinyin 2-", … in section order) — the grouping still tells the learner which senses share a reading, but the pronunciation and tones (the answer they are supposed to produce) are not leaked. The back/answer side, both cdps, and the community card view leave the prop off and show real tone-colored pinyin. The clusters are ordered by the shared `sortedSenseClusters(entry)` helper (highest frequency first) — the single source of truth both the picker and the persistence layer address. That helper also decides *which* clusters are offered at all: clusters with no displayable English are dropped and the picker is suppressed entirely below two survivors (see "Displayable clusters" below). **Each row carries a commonality meter**: the cluster's own `frequencyScore` renders as a 5px `FrequencyScoreDots` trailing the label (muted to `text.secondary` / `divider`), the same meter the eip and cdp show at full size. It is needed here precisely because the zh path re-groups by reading, so menu order is no longer globally frequency-sorted and nothing else tells the learner which of two senses under different readings is the common one. A cluster whose score is null renders no meter (rather than five hollow dots, which would read as "score 0"). The meter's column is labelled ONCE, by the sheet header described above (`… senses` on the left, `commonality` on the right, suppressed when no cluster is scored) — it used to be folded into the first `ListSubheader`, which read as part of that reading's heading rather than as a one-time column label. **Layout on the card face**: the trigger sits in flow, in a wrapping row, beside the gloss — with a hidden twin balancing it on the gloss's other side so the text itself stays centered. It squeezes (and wraps) a long gloss rather than being pushed off the card's right edge, and drops onto its own line under the text when even that leaves no room. | `src/utils/definitionUtils.ts` (`ddt`, `senseGrammarTag`, `sortedSenseClusters`), `src/features/flashcards/card/SensePicker.tsx` (`senseSections`, `renderSenseItem`), `src/features/flashcards/card/CardFace.tsx` (`EnglishBlock` — mounts it), `src/features/flashcards/FlashcardsLearnPage/InfoCardPanelBody.tsx` (eip header — mounts it with `classPrefix="mobile-demo-eic"`), `src/components/FrequencyScoreDots.tsx`, `src/utils/textUtils.ts` (`numberedToTonedPinyin`), `src/utils/toneColors.ts` (`getToneColor`) |
| **Long definition** (eip Definition tab, cdp) | The unit of generation is the cluster × POS pair: `backfill-long-definitions.js` writes one `longDefinition` entry per (cluster, part of speech), keyed by the cluster's `sense` label — a cluster whose `pos` lists several roles gets one definition per role, since the roles carry different meanings (docs/DEFINITION_MAPPING.md #5). `buildSlots` does the expansion; a cluster with no `pos` of its own yields one slot whose POS the model picks from the word-level `partsOfSpeech`. At read time the learner sees only the sense their card is on — resolved server-side by `resolveLongDefinition` and client-side (following the optimistic sense picker, no refetch) by `resolveLongDefinitionForSense`, both using the same sorted-cluster + `selectedSense` pick as dd. A re-clustering that changes a `sense` label orphans that sense's definition until the backfill re-runs (readers fall back to the default sense). | `server/scripts/backfill/chinese/backfill-long-definitions.js`; `server/utils/definitions.ts` (`resolveLongDefinition`, `resolveSelectedCluster`, `longDefToDisplayString`); `server/dal/implementations/DictionaryDAL.ts` (`enrichLongDefinitionMetadataBatch` — ships every sense as `longDefinitionSenses`); `src/utils/definitionUtils.ts` (`resolveLongDefinitionForSense`); `src/features/flashcards/FlashcardsLearnPage/InfoCardPanelBody.tsx`; `src/features/flashcards/VocabCardDetailBody.tsx` |
| **Character breakdown** (bt tab + Word Search) | Each component character's *context-correct* gloss = the char's cluster keyed by `breakdown[char].sense` (the label written by `backfill-breakdown-senses.js`), rendered via `ddt`. The breakdown tab reads the materialized `breakdown[char].definition`; Word Search re-resolves it live at grid build via `resolveSenseGloss`. Both surface the **same dd**. | `server/utils/definitions.ts` (`resolveSenseGloss`); `server/services/OnDeckVocabService.ts` (`getWordSearchGrid`); `src/utils/breakdownUtils.ts` — see [BREAKDOWN_FEATURE_IMPLEMENTATION.md](./BREAKDOWN_FEATURE_IMPLEMENTATION.md) §5b, [WORD_SEARCH_GAME.md](./WORD_SEARCH_GAME.md) §2/§4 |
| **Per-account sense selection** (`selectedSense`, migration 99) | The learner's chosen sense is persisted **per user per word** so it survives reloads/re-promotion. Stored as the cluster's `sense` LABEL (not an index) so it's stable across re-clustering/re-scoring; resolved back to a sorted index on read (falls back to the default/starred sense if the label no longer matches). Only the user-context surfaces **persist** a pick (flp card face, saved-card cdp, and the eip header picker when the panel's entry has a vet row) — the read-only dictionary cdp's picker, and an eip tab drilled into a word the learner has not saved, are local-only, never saved (there is no vet row to write). The index→label conversion is the shared `senseLabelForIndex` helper, so every host stores index 0 as NULL. **Every dd surface READS the pick**, via `resolveDisplayDefinition` — see [DEFINITION_MAPPING.md](./DEFINITION_MAPPING.md) form #3 for the full call-site list. Payloads that flatten dd to a plain string server-side (word-search word list, related words, used-in pass 1) resolve it with the server twin in `server/utils/definitions.ts`. An **open eip follows a pick made on the card underneath it**: entry tabs hold a snapshot, so the flp re-seeds the matching tab via `useEipTabs.syncEntry` whenever `selectedSense` changes — and `syncEntry` re-derives the tab's own `selectedSenseIndex` from the fresher entry, so the panel picker and the card picker converge rather than fighting. The reverse direction works too — **an eip pick updates the flashcard in the same session**: the pick is recorded on the tab (`useEipTabs.setActiveSenseIndex`) and persisted by the host page, and `persistSelectedSense`'s optimistic session override lands the new label on the current entry with no refetch. The card face's own sense index therefore re-seeds on `entry.selectedSense`, not just on `entry.id` (`CardFaceSide` in `FlashCardSection.tsx`) — keyed on the id alone, the face's stale local index would out-rank the fresher label until the card was cycled. **Dictionary lookups carry the requester's pick**: `GET /api/dictionary/lookup/:term` attaches `selectedSense` from the caller's vet row when they have that word as a card, so an eip drill-in and the dictionary cdp show the same sense as their flashcard (absent ⇒ default/starred sense). | vet column `selectedSense` (`database/migrations/99-add-selected-sense-to-vocabentries.sql`); `src/utils/definitionUtils.ts` (`resolveSelectedSenseIndex`, `senseLabelForIndex`, `resolveDisplayDefinition`); `server/utils/definitions.ts` (`resolveDisplayDefinition` — server twin); `src/utils/vocabApi.ts` (`saveSelectedSense`); `src/features/flashcards/FlashcardsLearnPage/useEipTabs.ts` (`syncEntry`, `setActiveSenseIndex`); `server/controllers/DictionaryController.ts` (`lookupTerm` — attaches the caller's `selectedSense`); `src/utils/dictEntryAdapter.ts` (carries `definitionClusters` + `selectedSense`); `server/dal/implementations/VocabEntryDAL.ts` (`findRelatedBySharedCharacters`, `findUsedInForCharacter`); `server/services/OnDeckVocabService.ts` (`getWordSearchGrid`); flp: `useCardIconEditor.ts` (`persistSelectedSense`) → `FlashCardSection.tsx` (`CardFace.handleSelectSense`); saved-card cdp: `VocabCardDetailPage.tsx` (`handleSelectSense`); eip header: `FlashcardsLearnPage.tsx` / `SortCardsPage.tsx` (`onSelectSense` → `InfoCardSection` → `InfoCardPanelBody`); server: `PATCH /api/vocabEntries/:id/selectedSense` (`VocabEntryController.updateSelectedSense` → `VocabEntryService.updateSelectedSense` → `VocabEntryDAL.updateSelectedSense`) |

### Displayable clusters: the picker's `< 2` gate

The sense picker and the dd/longDefinition resolvers do **not** address every cluster — they
address the **displayable** ones, and only offer a choice when at least two survive.

A cluster is *not* displayable when its lead gloss is entirely parenthetical, so `ddt` strips
it to the empty string. These are the grammatical-particle senses the CC-CEDICT-derived
`definitions` carry as bare annotations:

| word1 | non-displayable lead gloss |
|---|---|
| 上来 | `(verb complement indicating success)` |
| 了 | `(completed action marker)` |
| 在 | `(used before a verb to indicate an action in progress)` |
| 给 | `(grammatical equivalent of 把)`, `(sentence intensifier)` |
| 好 | `(verb complement indicating completion)` |
| 过去 | `(verb suffix)` |
| 哪 | `(emphatic sentence-final particle …)` |
| 直 | `(indicates continuing motion or action)` |
| 来 | `(used after 得[de2] to indicate possibility …)` |
| 斯 | `(phonetic)` |

They are filtered out **before** the `< 2` gate, not after, which has two consequences:

1. they never render as a **blank row** in the dropdown (`renderSenseItem` passes `ddt(cluster)`
   straight into `ListItemText` with no fallback), and
2. an entry left with a single displayable cluster (上来, 了, 在) shows **no picker at all** and
   falls back to the flat `definitions[0]` dd — rather than a one-item dropdown.

**The pinyin resolver is deliberately outside this gate** (2026-08-19). `readingCluster`
follows the picker's list whenever one exists — so a displayed gloss and its tones always
describe one sense — but when the gate suppresses the picker it still returns the entry's
primary reading rather than falling back to the `pronunciation` column, because that column
is the unreviewed seed rather than a curated alternative. See "Why pinyin does NOT share the
dd's `< 2` gate" above. Within that fallback it prefers a **displayable** cluster, so a
gloss-less particle sense cannot donate its reading to a card showing a real gloss: 了's two
`le` particle clusters are non-displayable, and the entry resolves to `liǎo` — matching its
`definitions[0]` dd "to understand", which is what the card was already showing over a
mismatched `le`.

The filter is scoped to this "which sense is the card on?" layer only. **Label-addressed** reads
— a segment's tagged `senseDict` label, a breakdown char's `breakdown[char].sense` — still see
every cluster and apply their own empty-gloss fallback (`resolveSenseGloss` returns `null`;
`buildSegmentMetadata` does `ddt(matchedCluster) || undefined`), because there the cluster is
named explicitly rather than chosen from a list.

Client and server twins must stay in lockstep:
`src/utils/definitionUtils.ts` (`sortedSenseClusters`) and
`server/utils/definitions.ts` (`resolveSelectedCluster`).

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
wrong heteronym reading); since that pipeline writes straight to prod, the fix has to
happen right then rather than at a review gate.
