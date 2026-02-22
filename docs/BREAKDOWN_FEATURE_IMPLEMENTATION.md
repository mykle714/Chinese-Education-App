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

### 5. Backfill Script
- **Script**: `server/scripts/backfill-breakdown.js`
  - Processes all existing Chinese vocab entries
  - Generates and stores breakdown for each
  - Progress tracking and error handling
  - Usage: `node server/scripts/backfill-breakdown.js`

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
   node server/scripts/backfill-breakdown.js
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
