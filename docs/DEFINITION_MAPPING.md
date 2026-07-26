# Definition Mapping

A map of every **definition form** that shows up around the app and the
operations that transform one form into the next. "Definition" is heavily
overloaded in this codebase — the raw imported gloss list, the single lead
gloss, the deterministic short gloss, the AI long definition, the orthogonal
sense clusters, and several per-segment/override variants are all "the
definition" in different places. This doc is the index that ties them together.

Scope: Chinese (`dictionaryentries_zh`) unless noted. Spanish
(`dictionaryentries_es`) shares the `definitions`/`longDefinition` columns but
not the CJK-specific enrichment.

Child docs:
- [DEFINITION_CLUSTERS.md](./DEFINITION_CLUSTERS.md) — the `definitionClusters`
  form: splitting `definitions` into orthogonal sense clusters.

---

## The forms

### 1. `definitions` — the flat gloss array  (storage; source of everything)
- **Shape:** `string[]` (jsonb column). e.g. 会 → `["can","to know how to",…,"(bound form) to reckon accounts"]`.
- **Origin:** CC-CEDICT import (`server/scripts/import-cedict-pg.ts`).
- **Role:** the canonical, app-wide contract. ~40 consumers (flashcards, dd,
  segmentation, discover) read it. **Owned by**
  `backfill-process-definitions-array.js` (the only writer that reorders/prunes).
- **Type:** `DictionaryEntry.definitions` (`server/types/index.ts:151`, `src/types.ts`).

### 2. `definition` — the single lead gloss
- **Shape:** `string` = `definitions[0]`.
- **Where:** projected at the DAL/join boundary (`det.definitions[0]`,
  `server/types/index.ts:353`), carried on `DiscoverCard.definition`
  (`:199`), `VocabEntry.definition`, related-word lists, etc.
- **Operation:** none beyond `[0]` — so the *quality* of this field is entirely
  determined by the Stage-A ordering of form #1.

### 3. dd — display definition (every "this word means X" surface)
- **Shape:** `string`, derived by the **dd resolver**
  `resolveDisplayDefinition(entry, senseIndexOverride?)`
  (`src/utils/definitionUtils.ts`) — the single source of truth. Server twin:
  `resolveDisplayDefinition` in `server/utils/definitions.ts`.
- **Operation (two branches):**
  1. entry has ≥2 `definitionClusters` (form #6) → `ddt` of the **chosen** cluster:
     the learner's persisted `selectedSense` label → sorted index
     (`resolveSelectedSenseIndex`), or the `senseIndexOverride` for a pick made this
     session that has not round-tripped yet;
  2. otherwise (unclustered, single cluster, or a cluster with no usable gloss) →
     the legacy dd, `stripParentheses(definitions[0])` (form #2 → clean headline).
- **The rule:** any surface showing a **vet-backed** entry's English meaning MUST call
  the resolver, never `stripParentheses(entry.definition)` directly — `entry.definition`
  is det's `definitions[0]` and ignores the learner's sense pick, so a raw call makes
  the same word read differently in two places.
- **Client call sites:** `FlashCardSection.tsx` (`EnglishBlock`, passes the live index),
  `InfoCardPanelBody.tsx` (eip header), `VocabCardDetailPage.tsx` + `FlashcardsLearnPage.tsx`
  (fie movable-text label + icon-search prefill, via `iconSearchTerm`),
  `useCardIconEditor.ts` (icon prefetch warm), `MiniVocabCard.tsx`, `VocabEntryCards.tsx`,
  `EntryDetailPage.tsx`, `FlashcardsPage.tsx` (`addToHistory` snapshots the resolved dd),
  `games/bubble-match/Bubble.tsx` + `BubbleStage.tsx` (text and its radius measurement).
- **Server call sites** (payloads that flatten dd to a string and drop the clusters):
  `OnDeckVocabService.getWordSearchGrid` (word list),
  `VocabEntryDAL.findRelatedBySharedCharacters` (related words),
  `VocabEntryDAL.findUsedInForCharacter` (used-in pass 1 — the user's own words; pass 2
  rows are not in their library and keep plain `definitions[0]`).
- **det-only surfaces** (dictionary search rows, discover sort cards, QuickMark, AI
  fallback results) carry no `selectedSense` and stay on `definitions[0]`.

### 4. `shortDefinition` — deterministic short gloss
- **Shape:** `string | null`, resolved at read time, **no AI**.
- **Rule:** `resolveShortDefinition` = manual override `?.definition`, else
  `generateShortDefinition(definitions)` (`server/utils/definitions.ts:105`,
  `:12`). The generator filters grammatical-note glosses (`(`/`CL:`), splits on
  `; `, strips trailing parentheticals, and returns the **shortest** surviving
  token.
- **Override:** `shortDefinitionPronunciationOverride.definition`
  (`server/types/index.ts:108`) wins verbatim.
- **Hydrated by:** `DictionaryDAL` (`server/dal/implementations/DictionaryDAL.ts:59`).

### 5. `longDefinition` — AI extended definition
- **Shape stored (zh):** JSONB **array, one element per (SENSE, PART OF SPEECH) pair** —
  `[{ "sense": "<definitionClusters label>", "pos": "<one POS>", "definition": "…" }, …]`
  (column added by migration 70; per-pair shape since `backfill-long-definitions.js` v15),
  AI-generated 25–200 chars each, ordered **default-sense-first** (the `sortedSenseClusters`
  order, so element 0 is the fallback) and, within a sense, in the cluster's own `pos` order.
  **Several elements may share a `sense`** — a cluster whose `pos` lists two roles gets one
  definition per role, because the roles mean different things (坏 adjective = the state "it
  is broken", verb = the event "it breaks down"). The `sense` label is the join key to
  `definitionClusters` (#6) and to the learner's `selectedSense`.
- **Shape stored (es / pre-v14 zh rows):** JSONB **object keyed by POS**
  `{ "noun": "…", "verb": "…" }` — Spanish has no sense clusters, so
  `spanish/backfill-long-definitions.js` still writes one definition per POS. Both
  shapes are read through the same helpers.
- **Read boundaries** (`server/utils/definitions.ts`) — two, for two audiences:
  - `resolveLongDefinition(value, entry)` → **the learner's** surfaces: the sense the card
    is on, picked by `resolveSelectedCluster` (the same `selectedSense`-then-default pick
    that drives dd) with element 0's sense as fallback. All of that sense's POS entries are
    shown — bare for one POS, `"<pos>: …\n\n<pos>: …"` for several (`joinSenseEntries`,
    the same shape the old per-POS object produced). Used by `DictionaryDAL.mapRowToEntity`
    and `enrichLongDefinitionMetadataBatch`.
  - `longDefToDisplayString(value)` → **the validator's** review document: every sense
    labeled and joined (`"<sense> (<pos>): …\n\n…"`), via `validationBodyFormat`.
- **Then:** split into `longDefinitionParts` (`LongDefinitionPart[]`) — alternating
  English-prose and cpcd-able Chinese runs for the renderer
  (`server/types/index.ts`).
- **Client-side sense resolution:** because the sense picker is optimistic (no refetch),
  the server ships EVERY sense with its own parts as `longDefinitionSenses`
  (`LongDefinitionSenseView[]`), and the client picks with
  `resolveLongDefinitionForSense` (`src/utils/definitionUtils.ts`) — the long-definition
  twin of `resolveDisplayDefinition`. `longDefinition`/`longDefinitionParts` stay
  populated with the currently-resolved sense for consumers that don't carry the senses.
- **Renderer:** `LongDefinitionDisplay` (`src/components/LongDefinitionDisplay.tsx`)
  renders each Chinese part as an inline `SegmentedSentenceDisplay`. In the **eip**
  (`InfoCardPanelBody.tsx` definition tab) it forwards `onSegmentOpen`
  (= `onExampleSegmentClick` → `eip.openForEntryKey`), so the segment popup is
  tappable and drills into the eip for that headword — the same gesture as the est
  popups. The cdp (`VocabCardDetailPage.tsx`) omits `onSegmentOpen`, so there the
  popup stays a passive tooltip (it has no eip).
- **Producer:** `backfill-long-definitions.js` — reads `definitionClusters`, so it runs
  AFTER `backfill-cluster-definitions.js` and skips unclustered rows.
- **Rolling this out:** [LONGDEF_PER_SENSE_MIGRATION.md](./LONGDEF_PER_SENSE_MIGRATION.md) —
  the deploy/regeneration runbook (code must ship BEFORE any data is regenerated; the legacy
  per-POS object stays readable until each row is re-run).

### 6. `definitionClusters` — orthogonal sense clusters
- **Shape:** `DefinitionCluster[]` (jsonb, migration 90); each cluster groups
  same-sense glosses with a `sense` label, `reading`, `pos`, and an independent
  1–5 `frequencyScore`.
- **Additive:** does NOT replace `definitions` (the two intentionally diverge).
- **Producer:** `backfill-cluster-definitions.js`.
- **Full detail:** [DEFINITION_CLUSTERS.md](./DEFINITION_CLUSTERS.md).

### 7. Per-segment / contextual definitions
- `segmentMetadata[seg].definition` — per-segment gloss for a token inside an example
  sentence or long definition (`server/types/index.ts`, `buildSegmentMetadata` in
  `server/dal/shared/segmentString.ts`). In **example sentences**, resolution is:
  manual override → the segment's tagged sense `senseDict[seg]` → `ddt(matchingCluster)`
  (the cluster's stripped lead gloss, form #6 → #3-style transform) → else the legacy
  translation string-match (`pickDefinitionForTranslatedSentence`). See
  [EXAMPLE_SENTENCES.md](./EXAMPLE_SENTENCES.md).
- `exampleSentenceDefinitionPronunciationOverride.definition` — manual verbatim
  override shown in the segment popup (`:114`).
- `breakdown[char]` — per-component-character breakdown (`:160`). `.definition` is
  the character's gloss; `.sense` (added by `backfill-breakdown-senses.js`) is the
  `definitionClusters` **sense label** the character carries **in this word** — a
  stable pointer (like `vet.selectedSense`) resolving form #6 → the correct-sense
  gloss, replacing the naïve `definitions[0]` that `generateBreakdown` first writes.
- `synonymsMetadata[syn].definition` — computed at read time from
  `dictionaryentries_zh` (`:371`).

---

## Operations on `definitions` (the enrichment pipeline)

Rough order; each is an idempotent backfill in
`server/scripts/backfill/chinese/` (Spanish equivalents in `…/spanish/`).

| # | Operation | Script | Effect on the definition forms |
|---|---|---|---|
| 1 | Import | `import-cedict-pg.ts` | creates raw `definitions` |
| 2 | Split semicolons | `backfill-split-semicolon-definitions.js` | `"a; b"` → `["a","b"]` array elements |
| 3 | Expand abbreviations | `backfill-expand-abbreviations.js` | expands cedict abbreviations in each gloss |
| 4 | Reorder + prune (+ synthetic headline) | `backfill-process-definitions-array.js` | rewrites `definitions` ordering; may prepend a synthetic short lead gloss (owns the column) |
| 5 | Word-level frequency | `backfill-frequency-score.js` | sets word-level `frequencyScore` (drives GSA, not a definition form) |
| 6 | Cluster | `backfill-cluster-definitions.js` | produces `definitionClusters` (form #6) |
| 7 | Long definition | `backfill-long-definitions.js` | produces `longDefinition` (form #5), one definition per cluster from step 6 |

### Shared logic (`scripts/backfill/chinese/lib/`)
The ordering and frequency cores are extracted so steps 4, 6, and 7 share one
implementation instead of duplicating prompts:
- `lib/orderGlosses.js` — Pass-1 reorder/prune + Pass-2 critic + short-gloss
  synthesis. Used by step 4 (whole array) and step 6 (per cluster).
- `lib/frequencyScore.js` — the 1–5 conversation-frequency rubric + scorer. Used by
  step 5 (word level) and step 6 (per cluster). Band labels live in
  `scripts/backfill/shared/lib/frequencyLabels.js` (language-neutral, shared with the
  Spanish scorer).

### `frequencyScore` — what the 1–5 number means (migration 122)
`frequencyScore` (det column on `dictionaryentries_zh` / `dictionaryentries_es`, plus
the same-named key on every `definitionClusters` element) measures **how often a word
or sense comes up in everyday conversation**:

| Score | Band | Meaning |
|---|---|---|
| 5 | Constant in daily speech | comes up daily in ordinary talk |
| 4 | Common | comes up most weeks; met early and often |
| 3 | Moderately common | comes up when the topic calls for it |
| 2 | Uncommon in speech | mostly met while reading or in specialist talk |
| 1 | Almost never spoken | literary, classical, archaic, or narrowly technical |

**It is NOT a register score.** Until migration 122 the column was named
`vernacularScore` and scored register (casual↔literary): 5 = sounds colloquial,
1 = sounds bookish. That was wrong for every consumer, all of which rank by "how
common is this word" — the gsa tie-break (`server/dal/shared/segmentString.ts:274-286`),
dictionary search relevance (`server/dal/implementations/DictionaryDAL.ts:48`),
starter-pack card + pack ordering (`server/services/StarterPacksService.ts:355,485,899`),
the Quick Mark universe gate `BETWEEN 3 AND 5`
(`server/dal/implementations/VocabEntryDAL.ts:838`), and dd's top-cluster pick
(`server/utils/definitions.ts:207`). Under register semantics a colloquial-but-rare
word outranked a very common register-neutral one (自由 "freedom" scored 3).

Do not re-introduce register language into the scorer prompts. Register is no longer
scored anywhere in the app.

**Surfaced to users as "Commonality"** — a 5-dot meter (`src/components/FrequencyScoreDots.tsx`)
on the cdp (`VocabCardDetailBody.tsx`), the eip (`InfoCardPanelBody.tsx`), scp
(`SortCardsPage.tsx`), and as the top-left badge on Quick Mark mini cards
(`QuickMarkCard.tsx`).

**Deploying this change to prod:** see
[FREQUENCY_SCORE_DEPLOY_RUNBOOK.md](./FREQUENCY_SCORE_DEPLOY_RUNBOOK.md) — migration
order (122 must precede 123), verification queries, the re-scoring run, and rollback.

**Re-scoring:** migration 122 renamed the column and the run-log stamp key but
deliberately KEPT the old register values, so rows still hold v1 register numbers
until the backfills are re-run with `--stale` (SCRIPT_VERSION was bumped: zh word-level
→ 2, es → 4, cluster-definitions → 5).

---

## Where each form surfaces (quick reference)

| Surface | Form used |
|---|---|
| Flashcard face, bubble-match, eip header, cdp, mini cards, /decks previews, related + used-in rows, word-search word list | dd = `resolveDisplayDefinition` (#3) — chosen sense (#6) with `definitions[0]` fallback |
| Discover sort cards | `definition` = `definitions[0]` (#2) |
| Dictionary row / vocab card | `definitions` array (#1), `shortDefinition` (#4) |
| eip / card detail expanded view | header dd (#3); the CURRENT sense's `longDefinition`/`longDefinitionParts` (#5, resolved by `resolveLongDefinitionForSense`), `synonyms`/`breakdown` (#7-segment) |
| Example sentence popups (est) | `segmentMetadata[*].definition` (#7), resolved per segment from `senseDict` → `ddt(cluster)` (#6) with string-match fallback |
| flp sense-picker dropdown | `ddt(cluster)` per `definitionClusters` entry (#6) |
