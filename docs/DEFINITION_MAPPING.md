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

### 3. dd — display definition (flashcard face / games)
- **Shape:** `string`, derived **on the front end** as
  `stripParentheses(entry.definition)`.
- **Where:** `src/utils/definitionUtils.ts` (`stripParentheses`), consumed by
  `FlashCardSection.tsx:168`, `games/bubble-match/Bubble.tsx`, `BubbleStage.tsx`.
- **Operation:** strips parenthetical notes from the lead gloss so the card shows
  a clean headline. (Abbreviation `dd` per CLAUDE.md.)

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
- **Shape stored:** JSONB **object keyed by POS** `{ "noun": "...", "verb": "..." }`
  (migration 70), AI-generated 25–150 chars.
- **Read boundary:** `longDefObjectToDisplayString` joins it back into a single
  `"pos: …\n\npos: …"` string (`server/utils/definitions.ts:83`).
- **Then:** split into `longDefinitionParts` (`LongDefinitionPart[]`) — alternating
  English-prose and cpcd-able Chinese runs for the renderer
  (`server/types/index.ts:122`).
- **Renderer:** `LongDefinitionDisplay` (`src/components/LongDefinitionDisplay.tsx`)
  renders each Chinese part as an inline `SegmentedSentenceDisplay`. In the **eip**
  (`InfoCardPanelBody.tsx` definition tab) it forwards `onSegmentOpen`
  (= `onExampleSegmentClick` → `eip.openForEntryKey`), so the segment popup is
  tappable and drills into the eip for that headword — the same gesture as the est
  popups. The cdp (`VocabCardDetailPage.tsx`) omits `onSegmentOpen`, so there the
  popup stays a passive tooltip (it has no eip).
- **Producer:** `backfill-long-definitions.js`.

### 6. `definitionClusters` — orthogonal sense clusters
- **Shape:** `DefinitionCluster[]` (jsonb, migration 90); each cluster groups
  same-sense glosses with a `sense` label, `reading`, `pos`, and an independent
  1–5 `vernacularScore`.
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
| 5 | Long definition | `backfill-long-definitions.js` | produces `longDefinition` (form #5) |
| 6 | Word-level register | `backfill-vernacular-score.js` | sets word-level `vernacularScore` (drives GSA, not a definition form) |
| 7 | Cluster | `backfill-cluster-definitions.js` | produces `definitionClusters` (form #6) |

### Shared logic (`scripts/backfill/chinese/lib/`)
The ordering and register cores are extracted so steps 4, 6, and 7 share one
implementation instead of duplicating prompts:
- `lib/orderGlosses.js` — Pass-1 reorder/prune + Pass-2 critic + short-gloss
  synthesis. Used by step 4 (whole array) and step 7 (per cluster).
- `lib/vernacularScore.js` — the 1–5 register rubric + scorer. Used by step 6
  (word level) and step 7 (per cluster).

---

## Where each form surfaces (quick reference)

| Surface | Form used |
|---|---|
| Flashcard face, bubble-match | dd = `stripParentheses(definitions[0])` (#3) |
| Discover sort cards | `definition` = `definitions[0]` (#2) |
| Dictionary row / vocab card | `definitions` array (#1), `shortDefinition` (#4) |
| eip / card detail expanded view | `longDefinitionParts` (#5), `synonyms`/`breakdown` (#7-segment) |
| Example sentence popups (est) | `segmentMetadata[*].definition` (#7), resolved per segment from `senseDict` → `ddt(cluster)` (#6) with string-match fallback |
| flp sense-picker dropdown | `ddt(cluster)` per `definitionClusters` entry (#6) |
