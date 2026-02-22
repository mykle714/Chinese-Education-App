# Flashcard Review History Implementation

## Overview
Added tracking of the last 16 flashcard review marks for each vocabulary entry to support spaced repetition algorithms.

## Implementation Date
February 10, 2026

## Changes Made

### 1. Database Schema (Migration 15)
**File:** `database/migrations/15-add-flashcard-history.sql`

- Added `reviewHistory` column to `VocabEntries` table
- Type: `JSONB` (native PostgreSQL JSON storage)
- Default: Empty array `[]`
- Index: GIN index for efficient JSONB queries
- Format: Array of objects with `timestamp` (ISO-8601) and `isCorrect` (boolean)

```sql
ALTER TABLE VocabEntries
ADD COLUMN "reviewHistory" JSONB DEFAULT '[]';

CREATE INDEX idx_vocabentries_review_history ON VocabEntries USING gin ("reviewHistory");
```

### 2. TypeScript Type Definitions
**File:** `server/types/index.ts`

Added new type for review marks:
```typescript
export interface ReviewMark {
  timestamp: string;  // ISO-8601 date string
  isCorrect: boolean;
}
```

Updated `VocabEntry` interface to include:
```typescript
reviewHistory?: ReviewMark[];  // Last 16 flashcard review marks
```

### 3. API Endpoint Update
**File:** `server/server.ts`

Updated `/api/flashcards/mark` endpoint to:
1. Fetch current review history from database
2. Append new review mark with timestamp
3. Keep only last 16 entries (using `.slice(-16)`)
4. Store updated history back to database as JSON

**Request Format:**
```json
POST /api/flashcards/mark
{
  "cardId": 123,
  "isCorrect": true
}
```

**Behavior:**
- On marking correct: Returns a random library card
- On marking incorrect: Returns success without new card
- Always tracks the review in the `reviewHistory` field

### 4. Database Connection
- Added `import db from './db.js'` to use connection pooling
- Uses proper client acquisition and release pattern
- Ensures database consistency and proper error handling

## Data Storage

### Why JSONB?
- ✅ Native PostgreSQL support (no serialization needed)
- ✅ Already used in the project (`OnDeckVocabSets`)
- ✅ Flexible structure for future enhancements
- ✅ Efficient querying with GIN indexes
- ✅ Maintains data in same table (no joins needed)

### Storage Format
```json
[
  { "timestamp": "2026-02-10T20:25:00.000Z", "isCorrect": true },
  { "timestamp": "2026-02-10T20:26:15.000Z", "isCorrect": false },
  { "timestamp": "2026-02-10T20:27:30.000Z", "isCorrect": true }
  // ... up to 16 entries
]
```

## How It Works

1. User marks a flashcard as correct/incorrect
2. Backend fetches current `reviewHistory` for that card
3. Creates new review mark: `{ timestamp: new Date().toISOString(), isCorrect }`
4. Appends to existing history array
5. Keeps only last 16 entries: `[...existingHistory, newMark].slice(-16)`
6. Updates database with new history
7. Returns response (with new card if correct)

## Future Use Cases

This review history can be used for:
- **Spaced Repetition Algorithms** (SM-2, Anki-style)
- **Progress Tracking** (accuracy over time)
- **Difficulty Assessment** (cards with many incorrect marks)
- **Study Analytics** (learning curves, retention rates)
- **Adaptive Learning** (adjust review intervals based on history)

## Testing

To test the implementation:

1. Log in with test account: `empty@test.com` / `testing123`
2. Use the flashcard demo to mark cards
3. Check database to verify history is being stored:

```bash
docker exec -i cow-postgres-local psql -U cow_user -d cow_db -c \
  "SELECT id, \"entryKey\", \"reviewHistory\" FROM vocabentries WHERE \"reviewHistory\" != '[]'::jsonb LIMIT 5;"
```

## Migration Status

✅ Migration file created: `database/migrations/15-add-flashcard-history.sql`
✅ Migration executed successfully
✅ Column verified in database schema
✅ Backend restarted with updated code

## Files Modified

1. `database/migrations/15-add-flashcard-history.sql` (new)
2. `server/types/index.ts` (updated)
3. `server/server.ts` (updated)

## Notes

- The 16-entry limit is arbitrary and can be adjusted by changing `.slice(-16)` to `.slice(-N)`
- Each mark is stored with a full ISO-8601 timestamp for precise tracking
- JSONB provides native PostgreSQL querying capabilities if needed later
- The implementation maintains backward compatibility (existing entries default to empty array)
