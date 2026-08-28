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
- [WORD_TAXONOMY.md](./WORD_TAXONOMY.md) — **DESIGN/DRAFT**: a hierarchical
  semantic classification (kingdom › class › order › genus) attached to each
  *sense cluster* rather than to the headword. Clusters say how many meanings a
  word has; the taxonomy says what kind of thing each meaning is about.

---

## The forms

### 1. `definitions` — the flat gloss array  (storage; source of everything)
- **Shape:** `string[]` (jsonb column). e.g. 会 → `["can","to know how to",…,"(bound form) to reckon accounts"]`.
- **Origin:** CC-CEDICT import (`server/scripts/import-cedict-pg.ts`).
- **Role:** the canonical, app-wide contract. ~40 consumers (flashcards, dd,
  segmentation, discover) read it. **Owned by**
  `backfill-process-definitions-array.js` (the only writer that reorders/prunes).
- **Type:** `DictionaryEntryBase.definitions` (`server/contracts/wire.ts`, re-exported
  through `server/types/index.ts`; client mirror in `src/types.ts`).

### 2. `definition` — the single lead gloss
- **Shape:** `string` = `definitions[0]`.
- **Where:** projected at the DAL/join boundary (`det.definitions[0]`, see
  `server/dal/shared/dictJoin.ts`), carried on `DiscoverCard.definition`
  (`server/contracts/wire.ts`), `VocabEntry.definition`, related-word lists, etc.
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
- **`stripParentheses` is depth-scanning, not regex** (fixed 2026-08-24). It tracks paren
  nesting, eats the whitespace preceding an aside, swallows an unmatched `(` to end of
  string and drops an unmatched `)`. The old `/\s*\([^)]*\)/g` stopped at the first `)`,
  so 27 discoverable glosses — 21 of them Spanish — leaked an aside's tail onto the card
  (的 rendered `" or 新的[xin1 de5] "new one")`). See
  [GLOSS_CONFUSABILITY.md](./GLOSS_CONFUSABILITY.md) § 8l for the full diff and rationale.
- **Inline-morpheme exception** (added 2026-08-28). A parenthetical GLUED to a word (no
  space on at least one side) whose content matches `^[a-z]{1,4}$` is an inline
  morpheme, not an aside, and is **rejoined** rather than dropped: `personal(ly)` →
  `personally`, `child(ren)` → `children`, `(hand)bag` → `handbag`. Without it the strip
  turns an adverb into an adjective — 手's cluster gloss `personal(ly)` reached the card
  as the bare `personal`, which is how 下手's breakdown came to read that way.
  The `^[a-z]{1,4}$` **content** test is load-bearing: an aside that merely lost its
  space (`skimming(of milk)`, `prescription(same as 丹方)`, `(idiom)fig.`) is shaped
  IDENTICALLY at the parenthesis, so adjacency alone cannot separate the two.
  Measured over the whole det corpus (446,517 display strings, 118 glued): the rule
  fires on 50, declines all 12 missing-space asides and all 35 chemical/math formulas
  (`Ca(OH)2`, `copper(II)` — uppercase or digit-bearing). Two accepted errors, both on
  non-discoverable rows: it misses the longer optional prefixes (`(house)wife` →
  `wife`) and fires wrongly on `manganese(iv) oxide`. Implemented in
  `unwrapInlineMorphemes`, called by `stripParentheses`.
- **Three implementations, one behavior.** Separate builds mean the transform exists in
  `src/utils/definitionUtils.ts` (client), `server/utils/definitions.ts` (server) and
  `server/scripts/backfill/shared/lib/stripParentheses.js` (backfill scripts, which sit
  outside the server tsconfig `include`). Keep all three in sync;
  `server/__tests__/definitions.test.ts` asserts parity between the latter two. The
  backfill module replaced THREE hand-copied `/\s*\([^)]*\)/g` regexes
  (`senseClusters.js` `clusterLeadGloss`/`isDisplayable`, `backfill-icons.js`) that had
  never followed the 2026-08-24 scanner fix — so nested asides were still leaking into
  what the backfill **wrote to the database**, not just what the app displayed.
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
  `VocabEntryDAL.findUsedInForCharacter` (used-in, **both** passes — pass 2 rows carry no
  `selectedSense`, but the resolver's default-sense branch still applies),
  `StarterPacksService._rowsToDiscoverCards` (discover / sort cards),
  `StudyChallengeDAL` (challenge word cards),
  `CommunityLayoutDAL.normalize` (community feed — the design OWNER's pick).
- **det-only surfaces** carry no `selectedSense`, which selects the **default** (highest-
  frequency) sense — not a fallback to `definitions[0]`. "No pick to honor" and "no sense to
  resolve" are different things; conflating them is what left the sort flow showing a
  different gloss and reading than the flashcard the same word produces (fixed 2026-08-19).
- **Derived key — `ddCollisionKey`** (`server/utils/definitions.ts`): the dd, lowercased
  with whitespace collapsed and a trailing period dropped. Not a display form and never
  rendered — it exists only so a game can ask "do these two cards read the same?" and
  refuse to put both in one round (see
  [GAMES_FEATURE.md](./GAMES_FEATURE.md) § "No two cards may share a dd in one round").
  Used by `OnDeckVocabService.getGameVocabPool` / `.getWordSearchGrid` / `.fetchDdKeys`
  and `MemoryMapService.spawnInto`. A designed (unbuilt) successor keyed on semantic
  nearness rather than string equality is [GLOSS_CONFUSABILITY.md](./GLOSS_CONFUSABILITY.md).

### 4. `shortDefinition` — deterministic short gloss
- **Shape:** `string | null`, resolved at read time, **no AI**.
- **Rule:** `resolveShortDefinition` = manual override `?.definition`, else
  `generateShortDefinition(definitions)` (`server/utils/definitions.ts`).
  The generator filters grammatical-note glosses (`(`/`CL:`), splits on
  `; `, strips trailing parentheticals, and returns the **shortest** surviving
  token.
- **Override:** `shortDefinitionPronunciationOverride.definition`
  (`server/types/index.ts`) wins verbatim.
- **Hydrated by:** `DictionaryDAL` (`server/dal/implementations/DictionaryDAL.ts`).

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
  override shown in the segment popup (`server/contracts/wire.ts`; resolved in
  `server/dal/shared/segmentString.ts`).
- `breakdown[char]` — per-component-character breakdown (`server/contracts/wire.ts`).
  `.definition` is
  the character's gloss; `.sense` (added by `backfill-breakdown-senses.js`) is the
  `definitionClusters` **sense label** the character carries **in this word** — a
  stable pointer (like `vet.selectedSense`) resolving form #6 → the correct-sense
  gloss, replacing the naïve `definitions[0]` that `generateBreakdown` first writes.
- `synonymsMetadata[syn].definition` — computed at read time from
  `dictionaryentries_zh` (`server/services/DictionaryService.ts`).

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
| 5b | Frequency reconciliation | `shared/repair-frequency-score-drift.js` | safety net only — every scorer now enforces `frequencyScore == MAX(cluster scores)` on write. No API calls; runs as the last step of both enrichment pipelines, and by hand for rows written before 2026-08-28 |
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
the same-named key on every `definitionClusters` element) measures **how much a word
or sense would stand out if a friend said it in casual conversation**:

| Score | Band | Test |
|---|---|---|
| 5 | Everyday | you will hear or say it this week without trying |
| 4 | Common when topical | not daily, but nobody would think twice |
| 3 | Unremarkable | you would not be *surprised* to hear it casually, even if you would not reach for it |
| 2 | Odd but forgivable | you would notice — stiff, bookish, specialist — but the conversation carries on |
| 1 | Would stop the conversation | genuinely strange to say to a friend: classical, archaic, hyper-technical |

**The axis changed on 2026-08-28 (no migration).** It used to ask *how often* a word
occurs; it now asks *how conspicuous* it would be. Bands 4 and 5 were merged — both are
now everyday-common — and the freed slot went to the bottom, splitting the old band 1
into "would stop the conversation" (1) and "odd but forgivable" (2) and lifting
目前-class words to 3. The trigger: under the old scale **53% of the discoverable zh
corpus (2,244 of 4,224 words we deliberately teach) sat in bands 1–2**, i.e. labelled
"you'd rarely or never hear this" — self-refuting for a curated learning corpus, and
the mechanism behind bound morphemes like 自 scoring low.

Only the top two bands are frequency judgments; 3/2/1 are reaction judgments. Two
consequences for the prompts: **recognition now counts** (a known-but-rarely-said word
is a 3, not a 2 — the old rubric said the exact opposite), and **formal flavour alone
is not a penalty** (政府 is formal and a 4).

⚠ **Every score written before 2026-08-28 is on the old axis.** `SCRIPT_VERSION` was
bumped on all four scorers (zh/es × word/cluster) so `--stale` and the oracle planner
treat those rows as needing a re-score. Until that runs, stored numbers and the rubric
disagree.

**It is NOT a register score.** Until migration 122 the column was named
`vernacularScore` and scored register (casual↔literary): 5 = sounds colloquial,
1 = sounds bookish. That was wrong for every consumer, all of which rank by "how
common is this word" — the gsa tie-break (`server/dal/shared/segmentString.ts`),
dictionary search relevance (`server/dal/implementations/DictionaryDAL.ts`),
starter-pack card + pack ordering (`server/services/StarterPacksService.ts`),
the Quick Mark universe gate `BETWEEN 3 AND 5`
(`server/dal/implementations/VocabEntryDAL.ts`), and dd's top-cluster pick
(`server/utils/definitions.ts`). Under register semantics a colloquial-but-rare
word outranked a very common register-neutral one (自由 "freedom" scored 3).

Do not re-introduce register language into the scorer prompts. Register is **not**
scored anywhere in the app — and note the 2026-08-28 axis change did not bring it
back. "Would this stand out?" is not "does this sound casual?": 政府 sounds formal and
scores 4, while subculture slang sounds maximally casual and scores 2. Conspicuousness,
not formality.

**Consumers are almost all rank-order, so the axis change is safe for them.** Starter
packs, provisional cards, the gsa tie-break and search relevance all read the column
through `ORDER BY ... DESC`, which is invariant under a monotone rescale. The one hard
threshold is the Quick Mark universe gate `BETWEEN 3 AND 5` — its floor now means "you
would not be surprised to hear this", which is a better gate than before, but it admits
more words. Merging bands 4 and 5 does flatten the top of that sort key, where starter
packs live; the secondary key there is `de.id ASC`, i.e. arbitrary, so a real tie-break
(HSK level or `difficulty`) is worth adding — tracked in
[DEFERRED_WORK.md](./DEFERRED_WORK.md).

**The word column is the MAX of the cluster scores, not an independent number.**
`det."frequencyScore" == MAX(definitionClusters[*].frequencyScore)` — enforced at
write time by both clusterers and by `reconcileFrequencyScore`
(`server/scripts/backfill/shared/lib/senseClusters.js`). The two used to be written by
two AI passes that never saw each other and disagreed on 10% of zh / 63% of es
discoverable clustered rows; the full rule, the repair pass and the ratchet-up policy
are in [DEFINITION_CLUSTERS.md](./DEFINITION_CLUSTERS.md) § "The word/cluster frequency
invariant".

**Bound forms count through their compounds.** A morpheme that is never uttered alone
still scores as frequent when the compounds carrying that meaning are common — 自 is
heard daily via 自己/自由/自动. Only genuine rarity (兮, 翌日) scores low.

**Surfaced to users as "Commonality"** — a 5-dot meter (`src/components/FrequencyScoreDots.tsx`)
on the cdp (`VocabCardDetailBody.tsx`), the eip (`InfoCardPanelBody.tsx`), scp
(`SortCardsPage.tsx`), and as the top-left badge on Quick Mark mini cards
(`QuickMarkCard.tsx`).

**Deployed.** Migration 122 (the rename) is on prod; its temporary deploy runbook has
been deleted. The one ordering fact worth keeping: **122 must precede 123**, since 123
references the already-renamed column — both are long since applied, so this matters only
to someone rebuilding a database from the migration files in order.

**⚠️ Re-scoring — the values may still be v1 register numbers.** Migration 122 renamed
the column and the run-log stamp key but deliberately KEPT the old values, so a row holds
a *register* number under a *frequency* name until the backfills are re-run with
`--stale` (SCRIPT_VERSION was bumped for exactly this: zh word-level → 2, es → 4,
cluster-definitions → 5). **That re-run never happened.** Measured on dev 2026-08-17:
896 of 930 discoverable zh rows are still stamped `version: 1` (only 34 reached v2), and
no es row has ever reached v4 (713 at v3, 130 at v2). Prod is very unlikely to be ahead
of dev. **So most "Commonality" dots in the app today are still register judgments
wearing a frequency label.** This is a known, accepted state — it is deliberately **not**
queued in [DEFERRED_WORK.md](./DEFERRED_WORK.md); the re-run costs one Sonnet call per row
and has not been judged worth the spend. Re-measure with:

```sql
-- v1 register vs v2 frequency, per row, from the run-log stamp
SELECT "enrichmentLog" -> 'chinese/backfill-frequency-score' ->> 'version' AS v,
       count(*)
  FROM dictionaryentries_zh WHERE discoverable GROUP BY 1 ORDER BY 1;
```

**If it is ever run**, the mechanics (preserved here from the since-deleted migration-122
deploy runbook, so they are not lost with it):

```bash
# From the HOST — the prod backend image ships neither scripts/backfill/ nor tsx.
# Needs POSTGRES_PASSWORD in the repo-root .env. Idempotent, per-row commit.
server/scripts/backfill/run-prod.sh scripts/backfill/chinese/backfill-frequency-score.js --stale
server/scripts/backfill/run-prod.sh scripts/backfill/spanish/backfill-frequency-score.js --stale
```

- **Order matters: word-level before clustering.** Clustering's single-definition fast
  path copies the word-level score onto the lone cluster rather than spending a call.
- **Spot-check first:** `--spot-check --stale --random --limit=5` prints one-line
  reasoning per word. It must talk about *how often a word comes up*, not how formal it
  sounds. If it mentions register, stop — the wrong prompt shipped.
- ⚠️ **`backfill-cluster-definitions.js --stale` is a different order of cost** — it
  re-runs the entire clustering pipeline (partition + gloss ordering + scoring) per row,
  several calls each. There is no score-only mode. Confirm the spend before running it.
- **Sanity check after:** expect roughly `吃饭` 5, `时间` 5, `搞定` 4, `手术` 3, `自由` 3,
  `阐述` 2, `余` 2, `翌日` 1. A `手术` of 2 or a `翌日` of 4 means the old rubric is still
  in play.
- `--stale` on the **Spanish** script is comparatively new; without it the run finds
  nothing to do, because every row already has a score.

---

## Where each form surfaces (quick reference)

| Surface | Form used |
|---|---|
| Flashcard face, bubble-match, eip header, cdp, mini cards, /decks previews, related + used-in rows, word-search word list | dd = `resolveDisplayDefinition` (#3) — chosen sense (#6) with `definitions[0]` fallback |
| Discover sort cards (scp, QuickMark, Skipped) | dd (#3), resolved server-side to the default sense |
| Dictionary row / vocab card | `definitions` array (#1), `shortDefinition` (#4) |
| eip / card detail expanded view | header dd (#3); the CURRENT sense's `longDefinition`/`longDefinitionParts` (#5, resolved by `resolveLongDefinitionForSense`), `synonyms`/`breakdown` (#7-segment) |
| Example sentence popups (est) | `segmentMetadata[*].definition` (#7), resolved per segment from `senseDict` → `ddt(cluster)` (#6) with string-match fallback |
| flp sense-picker dropdown | `ddt(cluster)` per `definitionClusters` entry (#6) |

### The pinyin forms (the same split, one field over)

Chinese pinyin has the identical two-source problem and resolves the same way, so it is
indexed here rather than in a doc of its own:

| Form | Shape | Notes |
|---|---|---|
| `numberedPinyin` | `"zhong4 dian3"` | det column. Numbered form, CEDICT-derived. The **seed** the clusterer is given. |
| `pronunciation` | `"zhòng diǎn"` | det column, tone-marked. Derived from `numberedPinyin`; **unreviewed, and partly corrupt** — 2,414 zh rows carry a misplaced tone mark (`hoù` for `hòu`) from a bug in `numberedToTonedSyllable` fixed 2026-08-19. |
| `cluster.reading` | `"zhong4 dian3"` | Numbered, **per sense** — the reviewed value. A heteronym's reading belongs to its sense, not the word. |
| **display pinyin** | `"zhòng diǎn"` | `resolveDisplayPronunciation` — the ONLY form a surface may render. Resolves `cluster.reading` through `numberedToTonedPinyin`, falling back to the `pronunciation` column only when no cluster reading exists. |

**The rule mirrors dd's:** never render `entry.pronunciation` directly. The resolver's call
sites are exactly the dd call sites above — the two must resolve the same sense or a card
prints one sense's English over another's tones. Full rationale, including why pinyin does
**not** share dd's `< 2` displayable-cluster gate, is in
[DEFINITION_CLUSTERS.md](./DEFINITION_CLUSTERS.md).
