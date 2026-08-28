# Flashcard Review History Implementation

## Overview
Per-card tracking of recent flashcard review marks, the input to the whole utcm mastery
computation.

> **This doc describes two eras.** Sections 1–2 record the ORIGINAL shape (migration 15):
> a flat `markHistory` array of the last 16 marks on a single `vocabentries` table. What
> ships today is the **typed** model — the newest `MARK_WINDOW_SIZE` (8) marks **per
> track** in `typedMarkHistory`, on the per-language vet tables, feeding three bars. The
> historical sections are kept because the column and its migration still exist; for the
> current model read [MASTERY_REWORK.md](./MASTERY_REWORK.md) first, then section 3 below
> for the layering.

## Implementation Date
February 10, 2026

## Changes Made

### 1. Database Schema (Migration 15)
**File:** `database/migrations/15-add-flashcard-history.sql`

- Added `markHistory` column to `VocabEntries` table
- Type: `JSONB` (native PostgreSQL JSON storage)
- Default: Empty array `[]`
- Index: GIN index for efficient JSONB queries
- Format: Array of objects with `timestamp` (ISO-8601) and `isCorrect` (boolean)

```sql
ALTER TABLE VocabEntries
ADD COLUMN "markHistory" JSONB DEFAULT '[]';

CREATE INDEX idx_vocabentries_review_history ON VocabEntries USING gin ("markHistory");
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
markHistory?: ReviewMark[];  // Last 16 flashcard review marks
```

### 3. API Endpoint and its layering
**Files:**
- `server/routes/flashcardRoutes.ts` — the HTTP layer for `/api/flashcards/mark` and
  `/api/flashcards/undoLastMark` (moved from server.ts in the 2026-07 route split).
  Parses the body, delegates, maps a service error to a status code. **No SQL, no
  banding logic.**
- `server/services/FlashcardMarkService.ts` → `applyMark`, `undoMark` — the mark
  POLICY: the cooldown gate, the rolling per-type window, the mastery-crossing stamp
  and the velocity log. These two handlers were the last route handlers in the
  codebase carrying embedded SQL; the extraction closed that out.
- `server/dal/implementations/VocabEntryDAL.ts` → `findMarkState`, `updateMarkHistory`
  — the vet read/write. `findMarkState` is the "probe both physical vet tables for a
  globally-unique id" lookup both paths need, and takes `forUpdate` for the row lock.

`applyMark` deliberately does **not** pick a replacement card. Choosing the next card
the learner sees is `OnDeckVocabService`'s job, and only one of the eight client call
sites wants it; the route composes the two, using the `categoryBeforeMark` the service
returns. See "The refill is a second concern on the same URL" below.

The write path is **transactional and takes a row lock** (`findMarkState(…,
forUpdate: true)`). Appending to `typedMarkHistory` is a read-modify-write over a whole
jsonb column, so two concurrent marks on one card would both read the same history and
the second `UPDATE` would erase the first. That is not hypothetical: Word Search fires
its reading and production marks in the same tick without awaiting either
([WORD_SEARCH_GAME.md](./WORD_SEARCH_GAME.md)), so a No-Pinyin find raced with itself
and could silently lose a track. Before the extraction the mark path had no
transaction and no lock, while `undoLastMark` had both.

### The refill is a second concern on the same URL

`POST /api/flashcards/mark` does two unrelated things: it records the mark (all eight
call sites want this) and it hands back a replacement card (only the flp working loop
wants it). Seven callers send `excludeIds: []` and discard `newCard`, and four request
fields — `mode`, `deckId`, `collection`, `foreignTrack` — exist solely to steer a
refill the games never read.

Splitting the refill onto its own endpoint is now a **routing change only**, because
`applyMark` returns `categoryBeforeMark` instead of picking the card itself. It has
not been done because it changes the flp's wire contract and needs that call site
(`src/features/flashcards/FlashcardsLearnPage/useWorkingLoop.ts`) migrated with it,
including the decision of who owns "which band does the refill draw from" once the
two calls are separate.

**Request Format:**
```json
POST /api/flashcards/mark
{
  "cardId": 123,
  "isCorrect": true
}
```

**Behavior:**
- On marking correct: returns a replacement card for the flp working loop (`newCard`),
  or `newCard: null` when the pool is exhausted — an expected end-of-pool state for
  every kind of session, never an error.
- On marking incorrect: returns success with no replacement (the card stays in the loop).
- On a mark whose track is still **cooling**: returns `suppressed: true` with
  `markTimestamp: null` and writes nothing. A success, not an error — see
  [HYDRA_BUBBLES.md](./HYDRA_BUBBLES.md) § 8.
- Otherwise the review is appended to that type's track in `typedMarkHistory`.

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
2. The service opens a transaction and reads the row **`FOR UPDATE`**, getting the
   card's `typedMarkHistory`, `masteredAt` and language in one probe
3. **Cooldown gate**: if that track has not finished cooling, nothing is written and
   the call returns `suppressed: true` (logged as `[MarkSuppressed]`)
4. Creates the new review mark: `{ timestamp: new Date().toISOString(), isCorrect }`
5. Appends it to **that type's** track, keeping the newest `MARK_WINDOW_SIZE` (8) —
   `appendTypedMark`. The mark pushed out of a full window is returned as
   `displacedMark` so undo can restore it precisely
6. Writes the history back, stamping `masteredAt.<bar>` in the same statement if this
   mark carried its bar from un-mastered to Mastered
7. **Logs a velocity promotion** if the mark moved its bar up a utcm band —
   `bandsClimbed(categoryBefore, categoryAfter) > 0` appends a
   `category_promotions` row (best-effort; a failure is logged and never fails the
   mark, and it is written **after** the transaction commits for that reason — a
   failed INSERT inside the transaction would abort the mark too). `undoMark` deletes
   that row inside its own transaction, where it is *not* best-effort. See
   [VELOCITY.md](./VELOCITY.md).
8. Returns the response (with a replacement card if correct — see the refill note above)

## Who emits marks

Every surface below writes through the same `POST /api/flashcards/mark`; the `type`
field is what decides which track a mark lands in ([MASTERY_REWORK.md](./MASTERY_REWORK.md)).

| Surface | Track(s) |
|---|---|
| flp working loop | `recognition`, `production` (per face shown) |
| Bubble Match | `recognition` |
| Match Speed | `recognition` |
| Word Search | `production` (Pinyin) / `reading` (No Pinyin) |
| Speed Reading | `reading` — positive AND negative |
| Practice Writing | `writing` |
| **Memory Map** | **`reading`** — one mark per word per run ([MEMORY_MAP_GAME.md](./MEMORY_MAP_GAME.md)) |

**Memory Map's mark policy is worth stating explicitly**, because it is the only one
where a correct answer can produce a NEGATIVE mark. A prompt allows three tries, and
only a first-try find is positive: recovering on try 2 or 3 (orange) and running out of
tries (red) both write `isCorrect: false`. The learner did eventually tap the right
word, but they could not read it on sight, which is what the reading track measures.
An individual wrong tap emits nothing — one prompt, one mark.

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
# vet is split per language — query the table for the language you marked in.
docker exec -i cow-postgres-local psql -U cow_user -d cow_db -c \
  "SELECT id, \"entryKey\", \"typedMarkHistory\", \"masteredAt\" FROM vocabentries_zh \
   WHERE \"typedMarkHistory\" IS NOT NULL AND \"typedMarkHistory\" != '{}'::jsonb LIMIT 5;"
```

The policy itself needs no database: `npm --prefix server test
__tests__/flashcardMark.test.ts` covers the cooldown gate, the displaced-mark window,
the mastery stamp/retract pair and the velocity best-effort rule against stubbed DALs.

## Migration Status

✅ Migration file created: `database/migrations/15-add-flashcard-history.sql`
✅ Migration executed successfully
✅ Column verified in database schema
✅ Backend restarted with updated code

## Files

1. `database/migrations/15-add-flashcard-history.sql` — the original `markHistory` column
2. `server/types/index.ts` — `ReviewMark`, `TypedMarkHistory`, `MarkType`
3. `server/routes/flashcardRoutes.ts` — HTTP layer only (route split, 2026-07)
4. `server/services/FlashcardMarkService.ts` — the mark/undo policy
5. `server/dal/implementations/VocabEntryDAL.ts` → `findMarkState`, `updateMarkHistory`
6. `server/__tests__/flashcardMark.test.ts` — the policy tests (stubbed DALs, fake
   transaction runner, no database)
7. `src/api/flashcards.ts` — the one client entry point every surface marks through

## Notes

- The per-track window is `MARK_WINDOW_SIZE` (8) in `server/contracts/wire.ts`, applied
  by `appendTypedMark`. The flat 16-entry `markHistory` array this doc originally
  described was replaced by the per-type `typedMarkHistory` object in migration 101
- Each mark is stored with a full ISO-8601 timestamp for precise tracking
- JSONB provides native PostgreSQL querying capabilities if needed later
- The implementation maintains backward compatibility (existing entries default to empty array)
