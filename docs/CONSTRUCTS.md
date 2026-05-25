# Project Constructs

## Definitions

There are two types of definitions stored per vocab entry.

### Short Definition (`entryValue`)
- **Source:** `vocabentries.entryValue` (VET)
- A brief English definition (typically 1–10 words), crowdsourced from language databases.
- Each language's entries come from a different crowdsourced source and may follow different formatting conventions.

### Long Definition (`longDefinition`)
- **Source:** `dictionaryentries.longDefinition` (DET)
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
| `category` | `category` | Current flashcard category (`Unfamiliar`/`Target`/`Comfortable`/`Mastered`); stored in VET but recalculated server-side after each mark from the last 8 marks in `markHistory` |
| `starterPackBucket` | `starterPackBucket` | `'library'` / `'learn-later'` / `'skip'` — determines if card appears in study loop |
| `markHistory` | `markHistory` | JSONB array (capped at 16) of `{ timestamp: ISO-8601, isCorrect: boolean }` |
| `totalMarkCount` | `totalMarkCount` | Running total of all marks ever given |
| `totalCorrectCount` | `totalCorrectCount` | Running total of correct marks |
| `totalSuccessRate` | `totalSuccessRate` | `totalCorrectCount / totalMarkCount`; recalculated after each mark |
| `last8SuccessRate` | `last8SuccessRate` | Correct count in last 8 marks ÷ 8; recalculated after each mark |
| `last16SuccessRate` | `last16SuccessRate` | Correct count in last 16 marks ÷ 16; recalculated after each mark |
| `createdAt` | `createdAt` | Row creation timestamp |

### From `dictionaryentries` (DET) — via DICT_JOIN

Joined via `LEFT JOIN LATERAL` in `server/dal/shared/dictJoin.ts`, matching on `word1 = ve.entryKey AND language = ve.language LIMIT 1`.

| Property | DET Column | Description |
|----------|-----------|-------------|
| `pronunciation` | `pronunciation` | Space-separated pinyin/romaji; DET value overwrites VET's own column |
| `tone` | `tone` | Tone digit string (e.g. `"12"` for fēng kuáng); derived from pronunciation |
| `hskLevel` | `hskLevel` | HSK1–HSK6 level |
| `script` | `script` | Writing system variant (traditional/simplified/kanji) |
| `breakdown` | `breakdown` | JSONB `Record<char, { definition: string }>` — per-character decomposition |
| `longDefinition` | `longDefinition` | AI-generated extended definition (25–150 chars) |
| `exampleSentences` *(raw)* | `exampleSentences` | JSONB array of `{ chinese, english, translatedVocab, partOfSpeechDict }` |
| `expansion` | `expansion` | Fuller/expanded form of the word (e.g., 不知不觉 for 知觉) |
| `expansionLiteralTranslation` | `expansionLiteralTranslation` | Literal English phrase derived from the expansion's components |
| `synonyms` | `synonyms` | JSONB string array of synonym words |

### Calculated at Runtime — enrichment pipeline

Computed by `OnDeckVocabService` after the DB query, before the API response is returned.

| Property | How It's Calculated | Service Method |
|----------|-------------------|----------------|
| `exampleSentences.segmentMetadata` | Each raw example sentence is greedy-segmented into tokens; each token is looked up in `dictionaryentries` to attach `{ pronunciation, definition, particleOrClassifier }` | `DictionaryService.enrichExampleSentencesMetadataBatch()` |
| `expansionMetadata` | For each character in the `expansion` string, looks up `pronunciation` and `definition` in `dictionaryentries`; result: `Record<char, { pronunciation, definition }>` | `DictionaryService.enrichExpansionMetadataBatch()` |
| `synonymsMetadata` | Collects all unique synonym words from the batch, batch-queries `dictionaryentries`, builds `Record<word, { definition, pronunciation }>` | `DictionaryService.enrichEntriesWithSynonymMetadata()` |
| `relatedWords` | Finds up to 4 of the user's own library words (VET `starterPackBucket = 'library'`) that share characters with `entryKey`. Chinese only. Returns `Array<{ id, entryKey, pronunciation, definition }>` | `OnDeckVocabService.enrichWithRelatedWords()` → `VocabEntryDAL.findRelatedBySharedCharacters()` |

---

## Night Market — Tiles, Nodes & Edges

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
