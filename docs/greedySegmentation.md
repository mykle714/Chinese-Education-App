# Greedy Segmentation (Forward Maximum Matching)

## Overview

The greedy segmentation algorithm — formally known as **Forward Maximum Matching (FMM)** — splits a Chinese string into dictionary-matched tokens by scanning left-to-right and always choosing the longest possible match at each position. This is the standard baseline algorithm in Chinese NLP for word segmentation without training data.

The implementation lives in `server/dal/shared/segmentString.ts` and is used to compute `exampleSentencesMetadata` at runtime.

---

## How the Algorithm Works

Given a Chinese string and a dictionary, FMM works as follows:

1. At the current position, try the longest possible substring (up to 4 characters).
2. Check if that substring is in the dictionary.
3. If yes — extract it as a token, then recurse on the left and right remainders.
4. If no — try the next shorter length (3, 2, 1).
5. If no match at length 1 — emit that single character as an unmatched token (fallback).

### Concrete Example

Input: `"我很喜欢中国菜"`
Dictionary contains: `我`, `很`, `喜欢`, `中国`, `菜`

| Step | Position | Tried | Match? | Token emitted |
|------|----------|-------|--------|---------------|
| 1 | 0 | `我很喜欢` | No | — |
| 2 | 0 | `我很喜` | No | — |
| 3 | 0 | `我很` | No | — |
| 4 | 0 | `我` | Yes | `我` |
| 5 | 1 | `很喜欢中` | No | — |
| ... | ... | ... | ... | ... |
| 6 | 1 | `很` | Yes | `很` |
| 7 | 2 | `喜欢中国` | No | — |
| 8 | 2 | `喜欢中` | No | — |
| 9 | 2 | `喜欢` | Yes | `喜欢` |
| 10 | 4 | `中国菜` | No | — |
| 11 | 4 | `中国` | Yes | `中国` |
| 12 | 6 | `菜` | Yes | `菜` |

Result: `["我", "很", "喜欢", "中国", "菜"]`

---

## Utility Functions

All three functions are exported from `server/dal/shared/segmentString.ts`.

### `getAllSubstrings(str, maxLen = 4): string[]`

Generates every unique substring of `str` up to length `maxLen`, scanning all start positions and all lengths. Used to build the set of candidate lookup keys for a single batch DB query before segmentation runs.

```typescript
getAllSubstrings("中国人", 4)
// → ["中国人", "中国", "中", "国人", "国", "人"]
```

**Why this exists:** Rather than issuing one DB query per token during segmentation, we pre-collect all possible substrings and resolve them in a single `findMultipleByWord1` call. This is critical for batch processing multiple entries.

---

### `buildDictMap(dictEntries: DictionaryEntry[]): Map<string, SegmentMeta>`

Converts an array of `DictionaryEntry` rows into a `Map<word1, { pronunciation, definition }>`. First entry for each `word1` wins (handles duplicates from the batch query).

```typescript
// Input: DictionaryEntry[]
// Output: Map {
//   "中国" => { pronunciation: "zhōng guó", definition: "China" },
//   "中"   => { pronunciation: "zhōng", definition: "middle" },
//   ...
// }
```

---

### `segmentWithDict(str, dictMap): string[]`

The core FMM function. Recursively segments `str` using the provided `dictMap`.

- Tries lengths 4 → 3 → 2 → 1 at each position
- Scans left-to-right at each length tier
- On match: splits string at the match site and recursively processes left and right remainders
- On no match at any length: falls back to individual characters

```typescript
segmentWithDict("不知不觉", dictMap)
// → ["不知不觉"]   (if the 4-char phrase is in the dict)
// → ["不知", "不觉"]  (if only 2-char segments match)
// → ["不", "知", "不", "觉"]  (fallback, no matches)
```

---

## Edge Cases

| Case | Behavior |
|------|----------|
| Character count ≠ syllable count for a matched segment | Pronunciation for that segment's individual characters is skipped; the segment itself is still recorded in `_segments` |
| Non-Chinese characters (punctuation, spaces) | No dictionary match at any length → emitted as individual characters with no pronunciation |
| Unknown token (Chinese char not in dict) | Emitted as a single-character fallback with no pronunciation |
| Duplicate characters across sentences | First-occurrence pronunciation wins (stored once in the metadata map) |

---

## Complexity

- **Time:** O(n × L²) per string, where n = character count and L = max substring length (4). In practice, n is small (example sentences are short).
- **Space:** O(S) where S = total unique substrings across all sentences in a batch — the dominant cost is the single DB round-trip, not the in-memory map.
- **DB queries:** One `findMultipleByWord1` call per batch of entries, regardless of how many entries or sentences are in the batch.

---

## Usage in This Codebase

The algorithm drives `DictionaryDAL.enrichExampleSentencesMetadataBatch()`, which computes `exampleSentencesMetadata` on-the-fly for vocab entries returned by the API. The metadata is never stored in the database.

### Output shape: `ExampleSentencesMetadata`

```typescript
type ExampleSentencesMetadata = Record<string, { pronunciation: string }> & {
  _segments?: string[][];  // _segments[i] = segmented tokens for exampleSentences[i]
};
```

Example for entry with `word1 = "中国"` and one example sentence `"我很喜欢中国菜"`:

```json
{
  "我":  { "pronunciation": "wǒ" },
  "很":  { "pronunciation": "hěn" },
  "喜":  { "pronunciation": "xǐ" },
  "欢":  { "pronunciation": "huān" },
  "中":  { "pronunciation": "zhōng" },
  "国":  { "pronunciation": "guó" },
  "菜":  { "pronunciation": "cài" },
  "_segments": [["我", "很", "喜欢", "中国", "菜"]]
}
```

The frontend (`VocabCardDetailPage`, `FlashcardsLearnPage`) iterates over each character in the sentence and looks up `exampleSentencesMetadata[char].pronunciation` to drive `CharacterPinyinColorDisplay` (cpcd) tone-colored rendering.

---

## API Endpoints That Return exampleSentencesMetadata

All endpoints below require a valid JWT cookie (`token`). Metadata is computed server-side before the response is sent.

### `GET /api/vocabEntries`
Returns all vocab entries for the authenticated user.
- **Auth:** JWT cookie
- **Query params:** none
- **Response:** `VocabEntry[]` — each entry includes `exampleSentences` and `exampleSentencesMetadata`

### `GET /api/vocabEntries/paginated`
Returns a paginated slice of the user's vocab entries.
- **Auth:** JWT cookie
- **Query params:**
  - `limit` (int, default `10`) — entries per page
  - `offset` (int, default `0`) — number of entries to skip
- **Response:** `{ entries: VocabEntry[], total: number, hasMore: boolean }`

### `GET /api/vocabEntries/:id`
Returns a single vocab entry by ID (must belong to the authenticated user).
- **Auth:** JWT cookie
- **Path params:**
  - `id` (int) — vocab entry ID
- **Response:** `VocabEntry`

### `GET /api/vocabEntries/search`
Searches the user's vocab entries.
- **Auth:** JWT cookie
- **Query params:**
  - `query` (string, min 2 chars) — search term
- **Response:** `VocabEntry[]`

### `GET /api/onDeck/library-cards`
Returns all library cards (starterPackBucket = `'library'`) for the user.
- **Auth:** JWT cookie
- **Query params:** none
- **Response:** `VocabEntry[]`

### `GET /api/onDeck/learn-later-cards`
Returns all learn-later cards (starterPackBucket = `'learn-later'`) for the user.
- **Auth:** JWT cookie
- **Query params:** none
- **Response:** `VocabEntry[]`

### `GET /api/onDeck/mastered-library-cards`
Returns library cards with category = `'Mastered'`.
- **Auth:** JWT cookie
- **Query params:** none
- **Response:** `VocabEntry[]`

### `GET /api/onDeck/non-mastered-library-cards`
Returns library cards without category = `'Mastered'`.
- **Auth:** JWT cookie
- **Query params:** none
- **Response:** `VocabEntry[]`

### `GET /api/onDeck/distributed-working-loop`
Returns the distributed working loop — a shuffled blend of cards from multiple categories.
- **Auth:** JWT cookie
- **Query params:** none
- **Response:** `VocabEntry[]` (also includes `relatedWords`)

### `GET /api/dictionary/lookup/:term`
Looks up a single dictionary entry. Language is derived from the user's `selectedLanguage`.
- **Auth:** JWT cookie
- **Path params:**
  - `term` (string) — the Chinese word or character to look up
- **Response:** `DictionaryEntry` (includes `exampleSentences`; metadata is not enriched on this path — dictionary entries returned directly from the DAL do not go through the enrichment pipeline)

### `GET /api/dictionary/search`
Searches dictionary entries with pagination.
- **Auth:** JWT cookie
- **Query params:**
  - `term` (string, required) — search term
  - `language` (string, optional) — defaults to user's `selectedLanguage`
  - `page` (int, default `1`, min `1`)
  - `limit` (int, default `50`, range `1–100`)
- **Response:** `{ entries: DictionaryEntry[], pagination: { page, limit, total, totalPages } }`

### `GET /api/starter-packs/:language`
Returns unsorted discoverable cards for the given language (up to 50).
- **Auth:** JWT cookie
- **Path params:**
  - `language` (string, e.g. `'zh'`)
- **Response:** `DiscoverCard[]` (includes `exampleSentences` and `exampleSentencesMetadata`)
