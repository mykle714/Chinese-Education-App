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
  (`server/types/index.ts`), each Chinese run carrying its whole-run `translation` when
  one exists (form #5b — only runs that aren't themselves det headwords get one).
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
  popup stays a passive tooltip (it has no eip). A run that carries a `translation`
  (form #5b) overrides all of that: it becomes one tappable unit showing the phrase's
  meaning, and is never drillable.
- **Producer:** `backfill-long-definitions.js` — reads `definitionClusters`, so it runs
  AFTER `backfill-cluster-definitions.js` and skips unclustered rows.
- **Rolling this out:** [LONGDEF_PER_SENSE_MIGRATION.md](./LONGDEF_PER_SENSE_MIGRATION.md) —
  the deploy/regeneration runbook (code must ship BEFORE any data is regenerated; the legacy
  per-POS object stays readable until each row is re-run).

### 5b. `longDefinitionCitations` — translations of the Chinese quoted inside #5
- **Shape:** `jsonb` array of `{ zh, en }` (zh only, migration 126) —
  `[{ "zh": "光明磊落", "en": "open, honest, and upright" }]`.
- **What it is for:** a long definition may quote Chinese inline ("almost always met inside
  the set phrase 光明磊落"). The read path already splits that run out as a `foreign` part;
  without a translation, tapping it glossed **one segment** of the phrase, which reads as a
  word list rather than as the thing being cited. Each entry here supplies the meaning of the
  WHOLE run, so the run becomes a single tappable unit.
- **Key:** the run text itself, produced by `splitHanRuns`
  (`server/dal/shared/segmentString.ts`) — a *maximal* CJK run, so **interior CJK punctuation
  is part of the key** (`他会说中文，我也会` is one run, not two). The producer extracts runs with
  that same function, precisely so the key can never drift from what the reader looks up.
- **Scope:** one list per ENTRY, covering the runs cited by **every** sense — the runs are
  keyed by text alone, so no sense dimension is needed.
- **Only runs that are NOT det headwords are translated.** If the whole run has its own
  `dictionaryentries_zh` row (`光明磊落`, `看见`), the dictionary already glosses it per segment
  and the eip popup can drill into it; a translation would replace that with whole-run mode
  and take the drill-in away. So translation is reserved for what det has no answer for —
  clauses and sentences (`我在看那只鸟`). Discoverable is irrelevant: **any** row counts,
  because a row means definitions exist. Enforced at READ time in
  `segmentLongDefinitionTexts` (`detWords`), not only at write time, because the Compare
  generator cannot know det's contents and because a stored citation must stop rendering by
  itself once its phrase is later added to det. The producer applies the same rule to skip
  the API call. Practical consequence: a definition that only quotes headwords correctly
  ends up with `[]`.
  - The read path's segmentation lookup only ever asks about ≤4-char tokens
    (`SEGMENTATION_MAX_TOKEN_CHARS`, `server/dal/shared/segmentString.ts`), so over-length
    whole runs are added to that same batch query explicitly — zh has thousands of 5+ char
    idiom headwords. The extra rows are excluded from `buildDictMap`/`buildExcludeSet` so
    segmentation behavior is unchanged.
- **Its own column, deliberately:** `definitionsApproved` (docs/DATA_VALIDATION_SYSTEM.md)
  hashes the raw `partsOfSpeech` + `definitions` + `longDefinition` columns, so folding
  translations into `longDefinition` would invalidate every existing validator approval.
  These are a rendering aid, not part of the reviewed definition text.
- **Attached at read time:** `enrichLongDefinitionMetadataBatch` →
  `segmentLongDefinitionTexts(texts, language, citationsByText)` sets `translation` on the
  matching `foreign` part and then **drops** the raw list from the payload
  (`server/dal/implementations/DictionaryDAL.ts`; `buildCitationMap` indexes it).
- **Renderer:** `SegmentedSentenceDisplay`'s `runTranslation` prop
  (`src/components/SegmentedSentenceDisplay.tsx`) — whole-run mode: a tap or hover anywhere
  in the run (**including its punctuation cells**) selects the entire run and the popup shows
  the translation. The popup is **passive** in this mode: a cited phrase is not a headword,
  so there is nothing for `onSegmentOpen` to drill into. An untranslated run keeps the
  per-segment popup — which is how a run that IS a headword always serves (see the rule
  above), and how every not-yet-backfilled entry serves.
- **Producer:** `server/scripts/backfill/chinese/backfill-longdef-citations.js` — one model
  call per entry, all its runs translated together with the full definition as disambiguating
  context — after dropping the runs that are det headwords, which never reach the model.
  Runs it can't translate are dropped and printed as `⚠ CITATION REVIEW` (a skipped headword
  is NOT flagged — it's the correct outcome). Entries with nothing translatable are stamped
  `[]` (not NULL) so full runs don't re-examine them.
- **Pipeline position:** immediately AFTER `backfill-long-definitions.js`; re-running that
  script for a word **invalidates** this column for that word. See
  `.claude/commands/mark-discoverable.md`.
- **Compare twin:** the eip Compare tab stores the identical `{ zh, en }` shape in
  `word_comparison_cache.citations` (migration 127) and renders through the same component —
  see [WORD_COMPARE_FEATURE.md](./WORD_COMPARE_FEATURE.md). Compare is a live path, so its
  citations come from the comparison call itself rather than a backfill — and since the
  model there cites the two headwords constantly, most of its citations are filtered out by
  the not-a-headword rule and only its example sentences render translated.

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
| 4 | Split commas (es only) + reorder + prune (+ synthetic headline) | `backfill-process-definitions-array.js` | **es:** breaks comma-joined synonym runs into one gloss per element (see below); **both:** rewrites `definitions` ordering; may prepend a synthetic short lead gloss (owns the column) |
| 5 | Word-level frequency | `backfill-frequency-score.js` | sets word-level `frequencyScore` (drives GSA, not a definition form) |
| 6 | Cluster | `backfill-cluster-definitions.js` | produces `definitionClusters` (form #6) |
| 7 | Long definition | `backfill-long-definitions.js` | produces `longDefinition` (form #5), one definition per cluster from step 6 |
| 8 | Cite translations | `backfill-longdef-citations.js` | produces `longDefinitionCitations` (form #5b) — one English translation per Chinese run quoted in step 7's text. Re-running step 7 invalidates it. |

#### Step 4, Spanish only: the comma split
**Code:** `server/scripts/backfill/spanish/backfill-process-definitions-array.js`
(split pass: `SPLIT_INSTRUCTIONS`, `applySplits` call, `splitDefinitions`),
`server/scripts/backfill/shared/lib/commaSplit.js` (the guard),
`…/commaSplit.test.mjs` (40 cases).

**The problem it solves.** The zh source (CEDICT) delimits glosses with `/`, so one
array element is one gloss. The es source (Wiktionary via `doozan/spanish_data`) packs
synonym runs into one string with commas — `después` → `["later, afterwards, afterward,
post", "next", "after"]`. Measured on discoverable rows, `definitions[0]` contains a
comma in **22.7% of es rows vs 0.9% of zh**. Every consumer keyed off `definitions[0]`
inherits the whole list where it expects one gloss: dd (form #3 — the flashcard face,
eip header, cdp, bubble-match), the icons8 search term, and the cluster partition.

**Why the model decides, in its own pass.** A comma is not always a delimiter, and the
difference is semantic, not lexical:

| Keep whole | Why |
|---|---|
| `to break the law, rule, order` | the commas delimit the verb's OBJECTS — splitting invents "to rule" / "to order" |
| `wall, especially of a house or room` | prose continuation |
| `to turn out, e.g. well or poorly` | `e.g.` continuation |
| `to be granted, awarded, or given` | coordination |
| `to look up (in a search engine, dictionary, etc.)` | comma is inside a parenthetical, not top-level |

Splitting was first folded into the ranking Pass 1, and it fired only intermittently —
`pasar` (22 glosses) split all ten of its runs on one attempt and none on the next,
because ranking dominates the model's attention. It now gets a **dedicated Sonnet call
that runs first**, skipped entirely when no gloss has a top-level comma and non-fatal on
failure (the entry is simply ranked with its glosses still joined). Both ranking passes
therefore always see one gloss per element, and their verbatim-copy validation is
unchanged.

**The guard (`isExactPartition`).** The model chooses *where* to cut; the code forbids
everything else. Proposed pieces must be an exact, in-order partition of the gloss's
top-level comma segments, so an invented word, a dropped segment, or a reordering is
rejected and the gloss stays whole. Each piece may re-attach the two markers that scope
the whole run and would otherwise fall off the trailing pieces:
- **leading note** — `(of food) bad, spoiled` → `(of food) bad`, `(of food) spoiled`,
  keeping restrictive/regional/vulgar markers that ranking principles 3 and 5 demote on;
- **leading infinitive** — `to eat away, corrode` → `to eat away`, `to corrode`
  (2,205 es glosses have this gap).

A **partial** split is legal and sometimes correct: `to break, break open, (new ground, a
game, etc.)` → `["to break", "to break open, (new ground, a game, etc.)"]`, because the
dangling note belongs with "break open".

The guard fires on real output — in a spot check the model proposed
`["to like [+de]", "to enjoy [+de]"]` for `to like, to enjoy [+de]`, copying the trailing
`[+de]` backwards onto a piece that never had it; that was rejected and logged.

Every split and every rejection is written to the run's `/tmp` review log, because an
over-split invents a sense the word does not have and no later step can detect it.

**Two consequences for the rest of the pipeline:** the entry-selection filter widened
from `jsonb_array_length(definitions) > 1` to also admit single-element arrays whose
gloss has a comma (those were previously skipped and are exactly the `después` case),
and `max_tokens` on both ranking passes went 1024 → 4096, since splitting lengthens the
list each pass must echo (`pasar`: 22 → 36).

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
