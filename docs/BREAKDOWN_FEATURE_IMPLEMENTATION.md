# Breakdown Feature Implementation Summary

## Overview
Added character breakdown support for Chinese vocabulary flashcards. Each Chinese vocab entry now includes a JSON breakdown showing the definition of each character.

## Changes Made

### 1. Database Schema
- **Migration**: `database/migrations/21-add-breakdown-column.sql`
  - Added `breakdown` JSONB column to `vocabentries` table
  - Format: `{"char1": "definition", "char2": "definition", ...}`
  - NULL for non-Chinese entries
  - Indexed with GIN for fast queries

### 2. TypeScript Types
- **Server Types** (`server/types/index.ts`):
  - Added `breakdown?: Record<string, string> | null` to `VocabEntry` interface
  
- **Client Types** (`src/types.ts`):
  - Added `breakdown?: Record<string, string> | null` to `VocabEntry` interface

### 3. Breakdown Generation Service
- **DictionaryService** (`server/services/DictionaryService.ts`):
  - Added `generateBreakdown(word: string, language: string)` method
  - Splits Chinese words into individual characters
  - Looks up each character in the dictionary
  - Returns JSON object with character definitions
  - Returns NULL for non-Chinese languages

### 4. Automatic Breakdown for New Entries
- **VocabEntryService** (`server/services/VocabEntryService.ts`):
  - Updated `createEntry()` to automatically generate breakdown for Chinese vocab
  - Breakdown generated after entry creation
  - Fails gracefully if breakdown generation fails (doesn't break entry creation)

### 5. Backfill Scripts

Breakdown enrichment is two ordered passes over `dictionaryentries_zh.breakdown`
(breakdown is a per-word fact stored on the **det** table, not per-user on vet):

**5a. Generate breakdown (deterministic, no AI)** —
`server/scripts/backfill/chinese/backfill-dictionary-breakdown.js`
- Populates `breakdown[char] = { definition }` using each character's **global lead
  gloss** (`definitions[0]`) via `DictionaryService.generateBreakdown`.
- Scope: discoverable, multi-character (`char_length(word1) > 1`) zh entries with
  `breakdown IS NULL`; `--words=未来,摸脉` to target specific entries.
- Run-logged via `stampEntries`; progress tracking and error handling.
- Usage: `node server/scripts/backfill/chinese/backfill-dictionary-breakdown.js`
- NOTE: the old per-vet `backfill-breakdown.js` was removed after the migration-66
  vet split / migration-73 legacy drop — this det-based script supersedes it.

**5b. Sense-tag the breakdown (AI)** —
`server/scripts/backfill/chinese/backfill-breakdown-senses.js`
- The `definitions[0]` gloss from 5a is the character's most-common sense **in
  isolation**, which is often WRONG inside a specific compound (会议 → 会 = "can"
  instead of the "meeting" sense; 银行 → 行 = "to walk" instead of the háng
  "row/business" sense). This pass picks the **correct `definitionClusters` sense**
  (migration 90) per component character in the context of `word1`.
- **Writes** (extends the breakdown shape, **no new column**):
  `breakdown[char] = { definition: <tagged cluster lead gloss>, sense: <tagged
  cluster's `sense` LABEL>, pronunciation? }`. `sense` is the source of truth and is
  the cluster **label** (not an index) so it survives re-clustering/re-scoring — the
  same stability contract as `vet.selectedSense` (migration 99). `definition` is
  refreshed to that cluster's lead gloss (ddt-style) so the on-card breakdown shows
  the correct sense with **no read-path change**.
- **Method** (mirrors the example-sentence per-segment sense tagger): per unique
  component character — 0 clusters → left untouched (no `sense`); 1 cluster →
  auto-assigned, no API call; ≥2 clusters → offered to one Sonnet call per word that
  returns `{char: senseLabel}`. Each label is validated against that character's own
  cluster labels; invalid/missing → falls back to the most-vernacular cluster and
  prints a `⚠ BREAKDOWN SENSE REVIEW` line (stable marker, greppable by the
  mark-discoverable agent — same convention as the clusterer).
- **Depends on** 5a (breakdown must exist) **and** the component characters being
  clustered by `backfill-cluster-definitions.js` first; an un-clustered component
  char is carried through unchanged and fixed on a later re-run.
- Flags: `--words=会议,银行`, `--all` (include non-discoverable), `--force` (re-tag
  rows already carrying a `sense`), `--limit=N`, `--spot-check` (5 entries, NO
  writes, verbose).
- Usage: `docker exec cow-backend-local npx tsx scripts/backfill/chinese/backfill-breakdown-senses.js`

## Data Flow

### Creating New Chinese Vocab Entry:
1. User creates vocab entry through API
2. Entry is saved to database
3. If language is 'zh', breakdown is automatically generated
4. Breakdown is saved to entry
5. Client receives entry with breakdown included

### Fetching Flashcards:
1. Client requests flashcards from `/api/onDeck/distributed-working-loop`
2. Server queries `vocabentries` table
3. Breakdown column is automatically included in response
4. Client receives `VocabEntry` objects with breakdown field populated

## Example Data

### Vocabulary Entry:
```json
{
  "id": 123,
  "entryKey": "一箭双雕",
  "entryValue": "kill two birds with one stone",
  "language": "zh",
  "breakdown": {
    "一": "one",
    "箭": "arrow",
    "双": "double, pair",
    "雕": "carve, engrave"
  }
}
```

## Next Steps

### Required Before Use:
1. **Run the migration**:
   ```bash
   # Inside the app container
   npm run migrate
   ```

2. **Backfill existing entries** (optional but recommended):
   ```bash
   # Inside the app container
   node server/scripts/backfill/chinese/backfill-dictionary-breakdown.js
   ```

### Frontend Integration (Future):
The breakdown data is now available to the client. To display it:
- Access `currentEntry.breakdown` in FlashcardsLearnPage
- Replace mock `breakdownItems` data with real breakdown
- Handle null breakdown gracefully (for non-Chinese cards)
- Map breakdown object to BreakdownLineItem components

## Testing
- Create a new Chinese vocab entry - should have breakdown
- Fetch flashcards - breakdown should be included
- Non-Chinese entries should have NULL breakdown
- Run backfill script on existing Chinese entries

## Notes
- Breakdown generation only works for Chinese (language: 'zh')
- Uses first definition from dictionary for each character
- Gracefully handles missing character definitions ("No definition")
- Breakdown generation failure doesn't break entry creation
- CSV imports currently don't generate breakdown (can be added if needed)
