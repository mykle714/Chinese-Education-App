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
