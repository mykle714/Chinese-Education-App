# Project Constructs

## Definitions

There are two types of definitions stored per vocab entry.

### Short Definition (`entryValue`)
- **Source:** `vocabentries.entryValue` (VET)
- A brief English definition (typically 1–10 words), crowdsourced from language databases.
- Each language's entries come from a different crowdsourced source and may follow different formatting conventions.

### Long Definition (`longDefinition`)
- **Source:** `dictionaryentries_zh.longDefinition` (DET)
- An AI-generated extended definition (25–150 chars), fetched via DICT_JOIN.

---

## FLP Card Data Sources

The FLP console logs the following on every card change (see `FlashcardsLearnPage.tsx`):
- `Current card:` → `{ id, entryKey }`
- `Current card enrichment:` → `{ breakdown, longDefinition, exampleSentences, expansion, expansionMetadata, relatedWords }`
- `Working loop by category:` → cards partitioned into `{ Unfamiliar, Target, Comfortable, Mastered }`

Each property on a `VocabEntry` object falls into one of three source categories:

### From `vocabentries` (VET) — direct columns

| Property | VET Column | Description |
|----------|-----------|-------------|
| `id` | `id` | Primary key |
| `entryKey` | `entryKey` | The word/characters being studied |
| `entryValue` | `entryValue` | Short English definition |
| `category` | `category` | Current flashcard category (`Unfamiliar`/`Target`/`Comfortable`/`Mastered`). A **GENERATED STORED** column (migration 67) the DB derives from `markHistory` via `compute_flashcard_category()` — banded by correct-count in the last 8 marks (≤1 Unfamiliar, ≤4 Target, ≤6 Comfortable, ≥7 Mastered; thresholds set by migration 69). Read-only: never written by app code; the mark/undo endpoints read it back via `RETURNING`. |
| `starterPackBucket` | `starterPackBucket` | `'library'` / `'skip'` — determines if card appears in study loop (`'already-learned'` is a sort action that maps to `'library'` + Mastered, not a stored value) |
| `markHistory` | `markHistory` | JSONB array (capped at 16) of `{ timestamp: ISO-8601, isCorrect: boolean }` |
| `totalMarkCount` | `totalMarkCount` | Running total of all marks ever given |
| `totalCorrectCount` | `totalCorrectCount` | Running total of correct marks |
| `totalSuccessRate` | `totalSuccessRate` | `totalCorrectCount / totalMarkCount`; recalculated after each mark |
| `last8SuccessRate` | `last8SuccessRate` | Correct count in last 8 marks ÷ 8; recalculated after each mark |
| `last16SuccessRate` | `last16SuccessRate` | Correct count in last 16 marks ÷ 16; recalculated after each mark |
| `createdAt` | `createdAt` | Row creation timestamp |

### From `dictionaryentries_zh` (DET) — via DICT_JOIN

Joined via `LEFT JOIN LATERAL` in `server/dal/shared/dictJoin.ts`, matching on `word1 = ve.entryKey AND language = ve.language LIMIT 1`.

| Property | DET Column | Description |
|----------|-----------|-------------|
| `pronunciation` | `pronunciation` | Space-separated pinyin/romaji; DET value overwrites VET's own column |
| `tone` | `tone` | Tone digit string (e.g. `"12"` for fēng kuáng); derived from pronunciation |
| `hskLevel` | `hskLevel` | HSK1–HSK6 level |
| `script` | `script` | Writing system variant (traditional/simplified/kanji) |
| `breakdown` | `breakdown` | JSONB `Record<char, { definition: string }>` — per-character decomposition |
| `longDefinition` | `longDefinition` | AI-generated extended definition (25–150 chars) |
| `exampleSentences` *(raw)* | `exampleSentences` | JSONB array of `{ chinese, english, translatedVocab, tense, partOfSpeechDict }`. `tense` is `'past' \| 'present' \| 'future'` — the temporal *meaning* of the sentence, not just which Chinese aspect markers are present. `partOfSpeechDict` keys are word tokens that appear in the Chinese sentence (single- or multi-char); values are POS tags. See "Example-sentence tense-aware popups" below. |
| `wordForms` | `wordForms` | JSONB `Record<string, string>` — AI-generated English inflection map for the entry, keyed by `past`, `present`, `future`, `gerund`, `adverb`, `adjective`, `noun`. Only the keys relevant to the entry's `partsOfSpeech` are populated. `{}` means "processed, nothing applicable" (so the backfill doesn't retry it). |
| `expansion` | `expansion` | Fuller/expanded form of the word (e.g., 不知不觉 for 知觉) |
| `expansionLiteralTranslation` | `expansionLiteralTranslation` | Literal English phrase derived from the expansion's components |
| `synonyms` | `synonyms` | JSONB string array of synonym words |

### Calculated at Runtime — enrichment pipeline

Computed by `OnDeckVocabService` after the DB query, before the API response is returned.

| Property | How It's Calculated | Service Method |
|----------|-------------------|----------------|
| `exampleSentences.segmentMetadata` | Each raw example sentence is greedy-segmented into tokens; each token is looked up in `dictionaryentries_zh` to attach `{ pronunciation, definition, particleOrClassifier, wordForms }`. `wordForms` is carried through verbatim from the matched DET row so the renderer can pick a tense-appropriate form per segment (see below). | `DictionaryService.enrichExampleSentencesMetadataBatch()` → `buildDictMap()` in `server/dal/shared/segmentString.ts` |
| `expansionMetadata` | For each character in the `expansion` string, looks up `pronunciation` and `definition` in `dictionaryentries_zh`; result: `Record<char, { pronunciation, definition }>` | `DictionaryService.enrichExpansionMetadataBatch()` |
| `synonymsMetadata` | Collects all unique synonym words from the batch, batch-queries `dictionaryentries_zh`, builds `Record<word, { definition, pronunciation }>` | `DictionaryService.enrichEntriesWithSynonymMetadata()` |
| `relatedWords` | Finds up to 4 of the user's own library words (VET `starterPackBucket = 'library'`) that share characters with `entryKey`. Chinese only. Returns `Array<{ id, entryKey, pronunciation, definition }>` | `OnDeckVocabService.enrichWithRelatedWords()` → `VocabEntryDAL.findRelatedBySharedCharacters()` |
| `usedIn` | Single-character zh entries only. Up to 5 multi-char words that contain this character. **Pass 1**: user's vet entries containing the char (excluding the entry itself), ordered by `de."vernacularScore" DESC NULLS LAST, entryKey ASC`. **Pass 2**: if pass 1 returns < 5, top up from `dictionaryentries_zh` (same ordering, same exclusions, skipping pass-1 entryKeys). Pass-2 items have `vocabEntryId === null`. Returns `UsedInItem[]`. | `OnDeckVocabService.enrichWithUsedIn()` → `VocabEntryDAL.findUsedInForCharacter()` |

---

## Example sentences

Each example sentence is a `{ chinese, english, translatedVocab, tense, partOfSpeechDict }` row in `dictionaryentries_zh.exampleSentences` (JSONB). The Chinese is rendered through `SegmentedSentenceDisplay` — characters are grouped into dictionary-matched segments, and tapping/hovering a segment surfaces a popup with the segment's contextual English meaning.

### Why we need a tense-aware popup, not just the dictionary definition

The English translation field is one fixed string for the whole sentence, so it cannot tell the user what an individual Chinese word means in isolation. The popup on a tapped segment fills that gap, but the *base* DET definition is usually the lemma form (e.g. 跑 → "to run"). If the sentence is "他昨天跑了" / "He ran yesterday", the lemma definition feels disconnected from both the Chinese sentence (which is in past tense) and the English translation (where "run" appears as "ran"). The mechanism below makes the segment popup show the *same* English form that actually appears in the translation — "ran" for the past-tense sentence, "runs" for the present-tense one, "running" if it's used as a gerund subject, etc.

### Authoring time — two AI backfills

1. **`server/scripts/backfill/chinese/backfill-example-sentences.js`** — for each discoverable zh DET row missing `exampleSentences`, asks Claude Sonnet for **exactly 3** sentences using the headword in a different grammatical role each, one per tense (`past`, `present`, `future`). The prompt requires:
   - `tense` derived from the sentence's *meaning*, not its surface aspect markers (e.g. 了 can mark a present state change, so it doesn't automatically imply past).
   - `partOfSpeechDict` covering **every** non-punctuation token in the Chinese sentence, with multi-char tokens allowed. Tags come from `ALLOWED_POS_TAGS`.
   - A special tagging rule: if the headword is a verb used **nominally** in this sentence (e.g. 下单 as the subject of 下单很简单 / "Ordering is simple"), tag it as `noun` in `partOfSpeechDict`, not `verb`. This is what later lets the renderer pick the gerund form.

2. **`server/scripts/backfill/chinese/backfill-word-forms.js`** — for each discoverable zh DET row with `partsOfSpeech` and no `wordForms`, asks Claude Sonnet to extract the base English word from `definitions[0]` and emit a `Record<string, string>` keyed by `past`, `present`, `future`, `gerund`, `adverb`, `adjective`, `noun`. Only the keys applicable to the entry's POS are populated; entries that yield no applicable forms are written as `{}` so the backfill doesn't retry them. The prompt explicitly handles two pitfalls:
   - **Irregular verbs** — actual inflected English, not `{word}ed` templates (e.g. "run" → past `"ran"`).
   - **Adjectives mistagged as verbs** — Chinese adjectives are often POS-tagged as verbs, but English adjectives like "happy" don't conjugate. In that case only the `adjective` key is returned.

### Request time — carrying `wordForms` onto segment metadata

When the FLP request hits `OnDeckVocabService`, `DictionaryService.enrichExampleSentencesMetadataBatch()` greedy-segments each sentence's Chinese against DET. `buildDictMap()` in `server/dal/shared/segmentString.ts:97` copies the matched entry's `wordForms` (when present) onto each `SegmentMeta`, alongside the existing `pronunciation` / `definition` / `particleOrClassifier`. The result is `exampleSentences[i].segmentMetadata: Record<segment, { pronunciation, definition, particleOrClassifier?, wordForms? }>`.

### Render time — `resolveWordForm` in `SegmentedSentenceDisplay`

`src/components/SegmentedSentenceDisplay.tsx:76` resolves the per-segment popup text from three inputs: the segment's `wordForms`, the segment's POS from `sentence.partOfSpeechDict`, and the sentence's `tense`. Selection rules:

- **Verb / auxiliary verb + tense set** → `wordForms[tense]` (e.g. `wordForms.past = "ran"`); falls back to `wordForms[pos]` if the tense key is missing.
- **Noun** → `wordForms.noun ?? wordForms.gerund`. The gerund fallback is what makes a verb-used-as-noun (tagged `noun` by the authoring rule above) render as e.g. "running" instead of the lemma.
- **Anything else** → `wordForms[pos]` directly (covers `adjective`, `adverb`).
- **Particle / classifier** → bypassed entirely; the contextually correct gloss already lives on `particleOrClassifier.definition`, which wins over both `definition` and any `wordForms` lookup.

When `resolveWordForm` returns a value, it replaces the dictionary base `definition` for that segment's popup; otherwise the base definition is used unchanged. The same resolution is applied in the fallback per-character branch (lines 156–160) so single-character segments that were never unified into a multi-char word still get tense-correct popups.

---

## Extra Info Panel (EIP)

The EIP is the secondary panel on the FLP / mdp that surfaces auxiliary card info (sct, st, bt, est, et). Structurally it is two stacked regions:

### Breakdown tab (bt) — single-char vs multi-char

The bt has two render modes, selected by `[...currentEntry.entryKey].length === 1`:

- **Multi-char** (default): per-character rows backed by `currentEntry.breakdown` (precomputed JSONB on the det row by `backfill-dictionary-breakdown.js`). Each row is tappable when `onBreakdownItemClick` is wired.
- **Single-char zh**: tab is relabeled **"Used In"** and rows are backed by `currentEntry.usedIn` — up to 5 multi-char words containing this character, computed at request time (see the `usedIn` enrichment in the table above). `vocabEntryId === null` flags a det-fallback item (not in the user's vet). The expansion block still renders below the rows when present.

Empty-state copy differs per mode: "No words use this character yet" for single-char, "Breakdown not available for this card" for multi-char.



- **Header** — fixed-height; holds the tab strip and any per-tab controls. Never scrolls.
- **Content area** — the active tab's body. The only scrollable region inside the EIP.

### Scroll-to-resize behavior

The EIP is *resizable*: it has a collapsed/min height and an expanded/max height. Vertical scroll gestures originating inside the content area are interpreted in two modes, switched by panel state and scroll position:

1. **Resize mode (default while not maxed out).** When the content is scrolled to the top of its page, a downward scroll gesture *grows* the EIP toward its max height rather than scrolling the content. The content stays pinned at the top; the panel itself eats the delta.
2. **Content-scroll mode (only after EIP is fully expanded).** Once the EIP has reached its max height, additional scroll deltas pass through to the content area and scroll it normally.

The reverse direction mirrors this: while the content is at `scrollTop === 0`, an upward gesture *shrinks* the EIP back toward its min height; only once it's at its min does scroll return to content (which, being at top, is a no-op).

This means the user never sees the content scroll past the top of its page while there is still room to expand the panel — resizing always happens first, content scroll second.


### Tile object (`TileDef`)

Defined in `src/config/nightMarketRegistry.ts:137`.

| Field | Type | Meaning |
|---|---|---|
| `isoX`, `isoY` | `number` | Integer iso coords (in `TILE_SIZE` units). Identity of the tile. |
| `connections?` | `string[]` | Stand `assetId`s reachable from this tile. The "last-mile" hook from walkable space to a stall — must be 4-adjacent to that stand's footprint. |
| `street?` | `Street` | The *winning* street that owns the tile (thickest-first, NS-wins-ties). Drives visual ownership. |
| `intersectingStreets?` | `Street[]` | *Every* street that tried to claim this slot. `length >= 2` ⇒ intersection tile (the seed for nodes); `length === 1` ⇒ body tile on a single street. |
| `isOccupied?` | `boolean` | Mutated each sim tick — true if a pedestrian's current or next tile is here. Pathfinder avoids these. |

Streets are authored as `Street { isNorthSouth, start, end, offset, width }` and expanded to tiles by `streetTiles()` in `src/config/tileRegistry.ts:107`. `buildTilesFromStreets()` then deduplicates by priority and stamps `street` + `intersectingStreets` onto each surviving tile.

> **Future layout source:** the tiles above are authored today via the hand-written tile/street registry. The template system ([NIGHT_MARKET_TEMPLATES.md](./NIGHT_MARKET_TEMPLATES.md), DESIGN stage) will replace that registry as the source of truth — the tile and street graphs will be computed from tiled, placed templates instead.

### Two graphs are derived from tiles

#### 1. Tile graph (fine-grained) — `src/utils/tileGraph.ts`

Built by `buildTileGraph(TILES, DEMO_STALLS)` at `tileRegistry.ts:338`.

- **Nodes** = every walkable tile (`tiles: Map<tileKey, TileDef>`).
- **Edges** = pure 4-neighbor adjacency. For each tile, try `(±TILE_SIZE, 0)` and `(0, ±TILE_SIZE)`; keep neighbors that exist in `tileMap` (`tileGraph.ts:115-123`).
- Also indexes stand access: `standAccessTiles` (assetId → tile keys that name it in `connections`) and validates that each access tile is 4-adjacent to the stand footprint and that each stand has exactly one access tile.

Used for per-tile stepping and last-mile pathing (BFS in `bfsTilePath`).

#### 2. Street graph (coarse) — `src/utils/streetGraph.ts`

Built by `buildStreetGraph(STREETS, TILES)` at `tileRegistry.ts:345`. This is the high-level routing graph.

- **Nodes (`StreetNode`)** = 4-connected components of *intersection tiles* (tiles where `intersectingStreets.length >= 2`). Flood-filled in `buildNodes` (`streetGraph.ts:143`).
- **Edges (`StreetEdge`)** = a single street's run between two intersection nodes. The `bodyTileSet` is every tile on that street with `intersectingStreets.length === 1` lying strictly between the two endpoint nodes. Because tiles on a street are axial and contiguous, an edge is a straight strip — pedestrians traverse it by monotonic motion along the street's primary axis.
- **Adjacency** = `nodeId → [{ edge, other }]`. Plus `tileToNode` (intersection tile → node) and `tileToEdge` (body tile → its edge) for O(1) lookups when promoting a tile-BFS leg into an axial street walk.

### Node types and their function

The codebase uses the word "node" in two distinct senses:

#### Tile-graph node — a walkable tile (`TileDef`)
- **Function:** the unit of pedestrian movement and occupancy. Every step a pedestrian takes is from one tile-node to a 4-neighbor tile-node.
- **Used by:** `bfsTilePath` for last-mile / off-street routing; the occupancy system (`isOccupied`) to prevent two peds from colliding on the same tile.
- **Sub-roles a tile can play:**
  - **Body tile** — `intersectingStreets.length === 1`. Lives in the body of exactly one street edge; the workhorse of axial walking.
  - **Intersection tile** — `intersectingStreets.length >= 2`. Belongs to a `StreetNode` component; the place a pedestrian can switch streets.
  - **Access tile** — has a non-empty `connections[]`. The single tile from which a given stand can be entered. Always 4-adjacent to that stand's footprint.

#### Street-graph node — an intersection (`StreetNode`)
- **Function:** the stopping points in the *high-level* plan. Routing across the market is "node → edge → node → edge → …", and only at a node may the pedestrian change streets.
- Carries its `tileKeys` (all intersection tiles in the component), the distinct `streets` that meet there, and a debug centroid.
- A pedestrian arriving at a node may pick any tile in the node as a randomized goal (this is how lane variety is introduced — see the `bodyTileSet` comment at `streetGraph.ts:54`).

#### How the two interact
- The **street graph** chooses *which* intersections to visit (coarse plan).
- Each leg is a single `(edge, target)` pair — the ped walks axially along the edge's primary axis until it reaches the target (a node or a specific tile). See [PEDESTRIAN_WALKING_ALGORITHM.md](./PEDESTRIAN_WALKING_ALGORITHM.md) for the full algorithm and [NIGHT_MARKET_GRAPH_ASSUMPTIONS.md](./NIGHT_MARKET_GRAPH_ASSUMPTIONS.md) for the invariants it relies on.
- `tileToNode` and `tileToEdge` are the bridges: given any tile, you can resolve which street-graph node or edge it belongs to in O(1), which is how the planner classifies start and goal positions.
