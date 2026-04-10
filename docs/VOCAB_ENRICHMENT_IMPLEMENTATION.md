# Vocabulary Enrichment Feature Implementation

## Overview
This feature adds rich contextual information to vocabulary flashcards, including synonyms, example sentences, parts of speech, and related words sharing characters.

## Implementation Summary

### 1. Database Schema (✅ Complete)

Enrichment columns (breakdown, synonyms, exampleSentences, expansion, expansionLiteralTranslation, longDefinition, pronunciation, tone, script, hskLevel) live in `dictionaryentries`, not `vocabentries`. They are fetched via LEFT JOIN on `entryKey = word1 AND language`.

Runtime-computed fields (never stored in the DB):
- `shortDefinition` — deterministic, via `generateShortDefinition()` in `server/utils/definitions.ts`
- `synonymsMetadata` — batch-reads pronunciation + first definition for each synonym word via `DictionaryService.enrichEntriesWithSynonymMetadata()`
- `segmentMetadata` per example sentence — greedy segmentation + dictionary lookup for pronunciation, definition, and particle/classifier annotations, via `DictionaryDAL.enrichExampleSentencesMetadataBatch()`

### 2. TypeScript Types (✅ Complete)
**Files Updated**:
- `server/types/index.ts`
- `src/types.ts`

**New Fields Added to VocabEntry**:
```typescript
{
  synonyms?: string[];
  exampleSentences?: Array<{
    chinese: string;
    english: string;
    translatedVocab: string;
    partOfSpeechDict: Record<string, string>;
    // Added at query time (not stored):
    _segments?: string[];
    segmentMetadata?: Record<string, {
      pronunciation?: string;
      definition?: string;
      particleOrClassifier?: { type: 'particle' | 'classifier'; definition: string };
    }>;
  }>;
  relatedWords?: Array<{
    id: number;
    entryKey: string;
    sharedCharacters: string[];
    successRate: number | null
  }>;
}
```

### 3. Dictionary Service Methods (✅ Complete)
**File**: `server/services/DictionaryService.ts`

**New Methods**:
- `extractPartsOfSpeech(word, language)` - Extracts POS markers from dictionary definitions
- `findSynonyms(word, language)` - Finds Chinese words with similar definitions (up to 5)
- `generateExampleSentences(word, language)` - Creates 3 template-based sentences showing different uses

### 4. DAL Layer (✅ Complete)
**Files**:
- `server/dal/implementations/VocabEntryDAL.ts`
- `server/dal/interfaces/IVocabEntryDAL.ts`

**New Method**:
- `findRelatedBySharedCharacters(userId, word, language, limit)` - Finds user's library words sharing characters, sorted by success rate

### 5. Service Integration (✅ Complete)

#### VocabEntryService
**File**: `server/services/VocabEntryService.ts`

When creating new Chinese vocab entries, automatically generates and stores:
- Character breakdown
- Synonyms
- Example sentences

#### OnDeckVocabService
**File**: `server/services/OnDeckVocabService.ts`

**New Methods**:
- `enrichWithRelatedWords(userId, entry)` - Adds related words to a single entry
- `enrichMultipleWithRelatedWords(userId, entries)` - Enriches multiple entries

**Modified Method**:
- `getDistributedWorkingLoop()` - Now enriches all returned cards with related words before returning

### 6. Backfill Script (✅ Complete)
**File**: `server/scripts/backfill-enrichment.js`

Populates enrichment data for existing Chinese vocab entries.

**Usage**:
```bash
docker-compose exec backend-local node server/scripts/backfill-enrichment.js
```

## Data Structure Examples

### Synonyms
```json
["喜爱", "热爱", "钟爱"]
```

### Example Sentences
```json
[
  {
    "chinese": "我很喜欢看书。",
    "english": "I really like to read books.",
    "usage": "object"
  },
  {
    "chinese": "看书很有用。",
    "english": "Reading books is very useful.",
    "usage": "subject"
  },
  {
    "chinese": "这是一个关于看书的故事。",
    "english": "This is a story about reading books.",
    "usage": "prepositional"
  }
]
```

### Related Words (Computed Dynamically)
```json
[
  {
    "id": 123,
    "entryKey": "欢迎",
    "sharedCharacters": ["欢"],
    "successRate": 0.85
  },
  {
    "id": 456,
    "entryKey": "喜悦",
    "sharedCharacters": ["喜"],
    "successRate": 0.72
  }
]
```

## API Response

When fetching flashcards from `/api/ondeck/working-loop`, each Chinese vocab entry now includes:

```json
{
  "id": 1,
  "entryKey": "喜欢",
  "entryValue": "to like",
  "language": "zh",
  "breakdown": {
    "喜": {
      "definition": "to be fond of",
      "pronunciation": "xǐ"
    },
    "欢": {
      "definition": "joyous",
      "pronunciation": "huān"
    }
  },
  "synonyms": ["喜爱", "热爱"],
  "exampleSentences": [
    {
      "chinese": "我很喜欢看书。",
      "english": "I really like to read books.",
      "translatedVocab": "like",
      "partOfSpeechDict": { "我": "pronoun", "很": "adverb", "喜欢": "verb", "看书": "verb" },
      "_segments": ["我", "很", "喜欢", "看书"],
      "segmentMetadata": {
        "我":   { "pronunciation": "wǒ",      "definition": "I; me" },
        "很":   { "pronunciation": "hěn",     "definition": "very" },
        "喜欢": { "pronunciation": "xǐ huān", "definition": "to like" },
        "看书": { "pronunciation": "kàn shū", "definition": "to read" }
      }
    }
  ],
  "relatedWords": [
    {
      "id": 123,
      "entryKey": "欢迎",
      "sharedCharacters": ["欢"],
      "successRate": 0.85
    }
  ]
}
```

## Frontend Integration

### Current Status
- ✅ TypeScript types updated in `src/types.ts`
- ✅ FlashcardsLearnPage already has `VocabEntry` type with new fields
- ⏳ Display logic not yet implemented

### Next Steps for Frontend
The data is now available in `currentEntry` on FlashcardsLearnPage. To display:

1. **Synonyms**: Show `currentEntry.synonyms`
2. **Example Sentences**: Show `currentEntry.exampleSentences` with per-token `CharacterPinyinColorDisplay` using `sentence.segmentMetadata`
3. **Related Words**: Show `currentEntry.relatedWords` with shared character highlighting

## Testing

### Verify Database Schema
```bash
docker-compose exec postgres-local psql -U cow_user -d cow_db -c "\d dictionaryentries" | grep -E "(synonyms|exampleSentences|longDefinition)"
```

### Verify Data Populated
```bash
docker-compose exec postgres-local psql -U cow_user -d cow_db -c "SELECT word1, language, synonyms, \"exampleSentences\" FROM dictionaryentries WHERE language = 'zh' LIMIT 3;"
```

### Test API Response
Login as test user and call:
```bash
GET /api/ondeck/working-loop
```

The response should include enrichment fields for Chinese cards.

## Performance Considerations

1. **Related Words Lookup**: Currently computes on-the-fly (expensive operation)
   - Uses regex pattern matching in PostgreSQL
   - Acceptable for current use case
   - Can be optimized later with caching if needed

2. **Enrichment Generation**: Only runs when creating new entries
   - Existing entries backfilled once
   - No performance impact on normal operations

3. **Synonym Finding**: Simple overlap matching
   - Could be improved with better similarity algorithms
   - Works well enough for initial implementation

## Future Improvements

1. **Better Synonym Detection**: Use semantic similarity instead of definition overlap
2. **AI-Generated Example Sentences**: Replace templates with context-aware AI generations
3. **Cache Related Words**: Pre-compute and store related words to avoid regex queries
4. **User Feedback**: Allow users to rate example sentences and suggest better ones
5. **Multiple Languages**: Extend enrichment to Japanese, Korean, Vietnamese

## Discoverable Entry Enrichment Pipeline

All discoverable zh entries must be processed through the following scripts **in order**. Each script is idempotent — it skips entries that already have the relevant field populated.

### Run the full pipeline

```bash
bash server/scripts/run-discoverable-enrichment.sh [production|local]
```

### Pipeline steps

| Step | Script | Output field(s) | Notes |
|------|--------|-----------------|-------|
| 1 | `backfill-split-semicolon-definitions.js` | `definitions` | Expands semicolon-delimited elements into separate array entries. Runs on ALL zh entries. |
| 2 | `backfill-sort-definitions.js` | `definitions` | AI reorders definitions from most prototypical to least. Runs on discoverable zh entries with >1 definition. |
| 3 | `backfill-hsk-level.js` | `hskLevel` | AI assigns one level token per entry (`HSK1`..`HSK6`). |
| 4 | `backfill-short-long-definitions.js` | `longDefinition` | AI generates 25–75 char elaboration. Depends on sorted definitions from step 2. |
| 5 | `backfill-example-sentences.js` | `exampleSentences` | AI generates 3 example sentences. Segment metadata (`_segments`, `segmentMetadata`) is computed at runtime — not stored. |
| 6 | `backfill-synonyms.js` | `synonyms` | AI finds validated Chinese synonyms. |
| 7 | `backfill-expansion.js` | `expansion`, `expansionLiteralTranslation` | AI generates expanded word form. |
| 8 | `backfill-classifier.js` | `classifier` | AI assigns measure word(s). |
| 9 | `backfill-dictionary-breakdown.js` | `breakdown` | AI generates per-character breakdown (multi-char words only). |
| 10 | `backfill-vernacular-score.js` | `vernacularScore` | AI scores vernacular vs. literary register (1–5). |

---

## Migration History

- **Migrations 21–24**: Historically added and renamed enrichment columns (`breakdown`, `synonyms`, `exampleSentences`, `partsOfSpeech`, `expansion`) on `vocabentries`. Those columns have since been removed from `vocabentries`; all enrichment data now lives in `dictionaryentries`.
- **Migration 34**: Dropped `exampleSentencesMetadata` column — segment metadata (pronunciation, definition, particle/classifier per token) is now computed on-the-fly via `DictionaryDAL.enrichExampleSentencesMetadataBatch()` and attached to each sentence object at query time as `segmentMetadata`. Never stored in the DB.
- **Migration 25**: Added `longDefinition` column to `dictionaryentries`
- **Migration 27**: Dropped `shortDefinition` column — now computed at runtime via `generateShortDefinition()` in `server/utils/definitions.ts`

## Short and Long Definitions (dictionaryentries)

### Columns

| Column | Type | Table | Derivation |
|--------|------|-------|------------|
| `shortDefinition` | *Not stored* | Computed at runtime | Deterministic — shortest gloss extracted from `definitions` array via `server/utils/definitions.ts` |
| `longDefinition` | TEXT (nullable) | `dictionaryentries` | AI-generated via Claude Haiku, 25–75 characters |

### shortDefinition Algorithm (server/utils/definitions.ts)

1. For each definition in the array, skip entries starting with `(` or `CL:` (grammatical/classifier notes)
2. Split remaining definitions by `"; "`
3. Strip trailing parenthetical content matching `/ \([^)]+\)$/`
4. If no tokens survive the filter, fall back to unfiltered tokens
5. Return the token with the fewest characters

**Examples**:
- `["no; not so", "(bound form) not; un-"]` → `"no"`
- `["not just; not limited to", "(as a correlative..."]` → `"not just"`
- `["you (informal, as opposed to courteous 您[nin2])"]` → `"you"`

### longDefinition Generation

Uses Claude Haiku (`claude-haiku-4-5-20251001`) with a prompt that asks for a 25–75 character elaboration of the short definition. Only generated for `language = 'zh'`.

**Examples**:
- 不 → `"used to negate verbs and adjectives in Chinese"`
- 不仅 → `"indicates something is not limited to a given scope"`

### Backfill

```bash
docker exec cow-backend-local ./node_modules/.bin/tsx scripts/backfill-short-long-definitions.js
```

Only processes `discoverable = TRUE` zh entries where either column is NULL.

### Service Methods

`server/services/DictionaryService.ts`:
- `generateShortDefinition(definitions: string[]): string | null` — synchronous, no AI
- `generateLongDefinition(word, language, shortDef, definitions): Promise<string | null>` — AI call

---

## Expansion Field

### Purpose
The `expansion` column stores an expanded or fuller form of Chinese words, used to better understand word composition and usage.

**Examples**:
- 不知不觉 → 不知道不觉得 (More complete form showing individual character usage)
- 违规 → 违反规矩 (Expansion showing more meaningful form)
- NULL for words that cannot be meaningfully expanded

### Implementation
- **Column Type**: TEXT (NULL-able)
- **Storage**: Direct text value, not JSON
- **Index**: Sparse index on non-NULL values for performance
- **Use Case**: Educational insights into word construction and meaning

### Field Definition
```typescript
// From server/types/index.ts
export interface VocabEntry {
  // ... other fields
  expansion?: string;  // Fuller/expanded form of the word
}
```

## Files Modified

### Backend Code
- `server/types/index.ts`
- `server/dal/interfaces/IVocabEntryDAL.ts`
- `server/dal/implementations/VocabEntryDAL.ts`
- `server/services/DictionaryService.ts`
- `server/services/VocabEntryService.ts`
- `server/services/OnDeckVocabService.ts`
- `server/scripts/backfill-enrichment.js` (new)

### Frontend
- `src/types.ts`

## Completion Status

✅ Backend types
✅ Service layer implementation
✅ DAL implementation  
✅ Automatic enrichment on entry creation
✅ Dynamic related words computation
✅ Migration executed
✅ Backfill script executed
✅ Frontend types updated
⏳ Frontend display (data available, UI not implemented)

---

**Status**: Backend implementation complete. All enrichment data is now being generated and sent to the client. Frontend display can be implemented as needed.
