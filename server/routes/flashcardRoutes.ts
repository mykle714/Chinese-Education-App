import { Router } from 'express';
import { authenticateToken } from '../authMiddleware.js';
import db from '../db.js';
import { VET_PHYSICAL_TABLES, vetTableForLanguage } from '../dal/shared/vetTable.js';
import { onDeckVocabService, categoryPromotionDAL } from '../dal/setup.js';
import { MODE_CONFIGS, type StudyMode, type CollectionFilter } from '../services/OnDeckVocabService.js';
import {
  ReviewMark,
  FlashcardCategory,
  MarkType,
  MARK_TYPES,
  MARK_WINDOW_SIZE,
  TypedMarkHistory,
} from '../types/index.js';
import { computeUtcm, appendTypedMark, bandsClimbed, MasteryGoals } from '../utils/masteryCompute.js';
import { handle } from './asyncHandler.js';

/**
 * Flashcard mark/undo routes — /api/flashcards/*
 *
 * LAYER: HTTP route layer, but these two handlers still carry the mark/undo
 * business logic inline (moved verbatim from server.ts). They are the last
 * route handlers with embedded SQL — a future pass should push this into
 * VocabEntryService. See docs/FLASHCARD_REVIEW_HISTORY_IMPLEMENTATION.md.
 *
 * MASTERY MODEL (migration 101, docs/MASTERY_REWORK.md): each mark carries a
 * `type` (recognition/production/reading/writing). A card keeps the 8 most recent
 * marks PER TYPE in `typedMarkHistory`. The utcm `category` is no longer stored —
 * it is derived here in app code via computeUtcm(typedMarkHistory, accountGoals),
 * because it depends on the account's reading/writing goal flags (goalCount),
 * which a generated column can't reference.
 */
const router = Router();

// Coerce an incoming mark `type` to a valid MarkType. Defensive default:
// an absent/unknown type falls back to 'recognition' (the historical default
// flp foreign-first face). See docs/MASTERY_REWORK.md.
function resolveMarkType(raw: unknown): MarkType {
  return MARK_TYPES.includes(raw as MarkType) ? (raw as MarkType) : 'recognition';
}

// Fetch the account's mastery goal flags (recognition + production are always
// goals; reading/writing are opt-in). Defaults to false/false if the row is gone.
async function fetchGoals(client: any, userId: string): Promise<MasteryGoals> {
  const r = await client.query(
    `SELECT "readingGoal", "writingGoal" FROM users WHERE id = $1`,
    [userId]
  );
  return {
    reading: r.rows[0]?.readingGoal === true,
    writing: r.rows[0]?.writingGoal === true,
  };
}

// Mark a flashcard as correct or incorrect (protected route)
router.post('/api/flashcards/mark', authenticateToken, handle(async (req, res) => {
  const client = await db.getClient();

  try {
    const userId = (req as any).user?.userId;
    const { cardId, isCorrect, type: rawType, excludeIds: rawExcludeIds, mode: rawMode, deckId: rawDeckId, collection: rawCollection } = req.body;

    // Optional difficulty mode (Review/Challenge). When set, the replacement card must
    // stay within the mode's allowed categories so a banned category never leaks
    // back into the loop via a correct-mark refill.
    const mode: StudyMode | undefined =
      rawMode === 'review' || rawMode === 'challenge' ? rawMode : undefined;

    // Optional collection restriction (docs/DECKS_FEATURE.md). The client echoes
    // back the collection the session was launched from, because THIS endpoint is
    // what refills the working loop — without it, the first correct answer in a deck
    // session would pull a replacement from the user's whole library.
    //
    // No ownership check is needed here (unlike the launch endpoints, which 404 on a
    // foreign deck id): the replacement query is already filtered by `ve."userId"`,
    // so a deck the caller does not own selects nothing and the picker falls through
    // to its normal never-stall behaviour. Coerced defensively — a malformed value
    // must mean "no restriction", never a crash mid-review.
    const collection: CollectionFilter | undefined =
      Number.isInteger(rawDeckId) && rawDeckId > 0
        ? { kind: 'deck', deckId: rawDeckId }
        : rawCollection === 'mastered'
          ? { kind: 'mastered' }
          : undefined;

    if (!userId) {
      client.release();
      return res.status(401).json({ error: 'Unauthorized', code: 'ERR_UNAUTHORIZED' });
    }

    if (typeof cardId !== 'number' || typeof isCorrect !== 'boolean') {
      client.release();
      return res.status(400).json({
        error: 'Invalid request body. Expected { cardId: number, isCorrect: boolean, type?: MarkType }',
        code: 'ERR_INVALID_REQUEST'
      });
    }

    const markType: MarkType = resolveMarkType(rawType);

    // excludeIds is the list of card ids currently in the client's working loop,
    // so the replacement picker avoids handing back a duplicate.
    const excludeIds: number[] = Array.isArray(rawExcludeIds)
      ? rawExcludeIds.filter((n): n is number => typeof n === 'number')
      : [];

    // The account's goal flags drive the derived category (before + after).
    const goals = await fetchGoals(client, userId);

    // Fetch the current vocab entry's typed history + counts + language. vet is
    // split per language; the client sends only a cardId, so probe each physical
    // table (ids are globally unique) — exactly one holds the row.
    let entryResult: any = { rows: [] };
    for (const t of VET_PHYSICAL_TABLES) {
      const r = await client.query(
        `SELECT "typedMarkHistory", "totalMarkCount", "totalCorrectCount", "language" FROM ${t} WHERE id = $1 AND "userId" = $2`,
        [cardId, userId]
      );
      if (r.rows.length > 0) { entryResult = r; break; }
    }

    if (entryResult.rows.length === 0) {
      client.release();
      return res.status(404).json({
        error: 'Vocab entry not found',
        code: 'ERR_ENTRY_NOT_FOUND'
      });
    }

    const existingHistory: TypedMarkHistory = entryResult.rows[0].typedMarkHistory || {};
    const currentTotalMarkCount: number = entryResult.rows[0].totalMarkCount || 0;
    const currentTotalCorrectCount: number = entryResult.rows[0].totalCorrectCount || 0;
    // The replacement card must be in the same language as the card just marked.
    const cardLanguage: string = entryResult.rows[0].language || 'zh';

    // Category BEFORE the mark drives the replacement-card category.
    const categoryBeforeMark: string = computeUtcm(existingHistory, goals);

    // Preserve the mark displaced from THIS TYPE's window when it's already full,
    // so undo can restore it precisely (per-type window of MARK_WINDOW_SIZE).
    const existingTrack: ReviewMark[] = Array.isArray(existingHistory[markType]) ? existingHistory[markType]! : [];
    const displacedMark: ReviewMark | null =
      existingTrack.length >= MARK_WINDOW_SIZE ? existingTrack[0] : null;

    const newMark: ReviewMark = {
      timestamp: new Date().toISOString(),
      isCorrect
    };

    const updatedHistory: TypedMarkHistory = appendTypedMark(existingHistory, markType, newMark);

    const newTotalMarkCount: number = currentTotalMarkCount + 1;
    const newTotalCorrectCount: number = currentTotalCorrectCount + (isCorrect ? 1 : 0);

    // category is derived, not stored — write only the history + lifetime counts.
    const updateQuery = `
      UPDATE ${vetTableForLanguage(cardLanguage)}
      SET "typedMarkHistory" = $1,
          "totalMarkCount" = $2,
          "totalCorrectCount" = $3
      WHERE id = $4 AND "userId" = $5
    `;
    await client.query(updateQuery, [
      JSON.stringify(updatedHistory),
      newTotalMarkCount,
      newTotalCorrectCount,
      cardId,
      userId
    ]);

    // Category AFTER the mark, for the client's progress chip.
    const category: FlashcardCategory = computeUtcm(updatedHistory, goals);

    // VELOCITY (docs/VELOCITY.md): this is the ONLY moment a band promotion is
    // observable — `category` is derived, so nothing else in the schema would ever
    // know the card moved up. Log the step count when it did.
    //
    // A single mark can cross two bands (pbh is continuous), so the size of the
    // move is recorded rather than assumed to be 1. Demotions are not logged.
    //
    // Best-effort by design: a failure here is swallowed after logging, because
    // losing a stat is strictly better than failing the user's review write. The
    // insert reuses this handler's client — it is not in a transaction, so it
    // commits independently of the vet UPDATE above.
    const climbed = bandsClimbed(categoryBeforeMark, category);
    if (climbed > 0) {
      try {
        await categoryPromotionDAL.recordPromotion({
          userId,
          language: cardLanguage,
          vocabEntryId: cardId,
          fromCategory: categoryBeforeMark as FlashcardCategory,
          toCategory: category,
          bandsClimbed: climbed,
          markType,
          markTimestamp: newMark.timestamp,
        }, client);
      } catch (promotionError) {
        console.error('Failed to log category promotion (velocity):', promotionError);
      }
    }

    // If correct, return a card from the same category as BEFORE the mark (with fallback priority).
    // In a mode session the replacement pool is capped to the mode's allowed categories.
    if (isCorrect) {
      const allowedCategories = mode ? MODE_CONFIGS[mode].allowed : undefined;
      const newCard = await onDeckVocabService.getNextLibraryCardWithFallback(userId, categoryBeforeMark, cardLanguage, excludeIds, allowedCategories, collection);

      if (!newCard) {
        // In a mode session, "no eligible replacement" is the expected end-of-pool
        // state, not an error: return success with newCard:null so the client winds
        // the loop down ("no more review/challenge cards remaining"). Study keeps the 404.
        if (mode) {
          client.release();
          return res.status(200).json({
            success: true,
            category,
            markTimestamp: newMark.timestamp,
            markType,
            displacedMark,
            newCard: null,
          });
        }
        client.release();
        return res.status(404).json({
          error: 'No library cards available',
          code: 'ERR_NO_CARDS_AVAILABLE'
        });
      }

      // Pre-warm the TTS disk cache for the replacement card so its audio is a
      // guaranteed cache hit on the client's follow-up /api/tts/synthesize call.
      // Same graceful-degrade semantics as the working-loop endpoint.
      await onDeckVocabService.prewarmAudio([newCard]);

      client.release();
      return res.status(200).json({
        success: true,
        category,
        markTimestamp: newMark.timestamp,
        markType,
        displacedMark,
        newCard
      });
    } else {
      // If incorrect, just return success with category
      client.release();
      return res.status(200).json({
        success: true,
        category,
        markTimestamp: newMark.timestamp,
        markType,
        displacedMark
      });
    }
  } catch (error: any) {
    console.error('Error marking flashcard:', error);
    client.release();
    res.status(500).json({
      error: error.message || 'Failed to mark flashcard',
      code: error.code || 'ERR_MARK_FAILED'
    });
  }
}));

// Undo the most recently saved flashcard mark (protected route)
router.post('/api/flashcards/undoLastMark', authenticateToken, handle(async (req, res) => {
  const client = await db.getClient();
  try {
    const userId = (req as any).user?.userId;
    const { cardId, markTimestamp, markType: rawMarkType, displacedMark } = req.body || {};

    if (!userId) {
      client.release();
      return res.status(401).json({ error: 'Unauthorized', code: 'ERR_UNAUTHORIZED' });
    }

    if (typeof cardId !== 'number' || typeof markTimestamp !== 'string') {
      client.release();
      return res.status(400).json({
        error: 'Invalid request body. Expected { cardId: number, markTimestamp: string, markType?: MarkType }',
        code: 'ERR_INVALID_REQUEST'
      });
    }

    // Undo must revert the SAME typed stream the mark was appended to.
    const markType: MarkType = resolveMarkType(rawMarkType);

    await client.query('BEGIN');

    const goals = await fetchGoals(client, userId);

    // FOR UPDATE can't run against the union view, and we don't yet know the row's
    // language, so probe each per-language vet table; the one holding this id
    // returns (and locks) the row. ids are globally unique across the pair.
    let entryResult: any = { rows: [] };
    let lockedVetTable: string | null = null;
    for (const t of VET_PHYSICAL_TABLES) {
      const r = await client.query(
        `SELECT "typedMarkHistory", "totalMarkCount", "totalCorrectCount" FROM ${t} WHERE id = $1 AND "userId" = $2 FOR UPDATE`,
        [cardId, userId]
      );
      if (r.rows.length > 0) { entryResult = r; lockedVetTable = t; break; }
    }

    if (entryResult.rows.length === 0) {
      await client.query('ROLLBACK');
      client.release();
      return res.status(404).json({
        error: 'Vocab entry not found',
        code: 'ERR_ENTRY_NOT_FOUND'
      });
    }

    const existingHistory: TypedMarkHistory = entryResult.rows[0].typedMarkHistory || {};
    const existingTrack: ReviewMark[] = Array.isArray(existingHistory[markType]) ? existingHistory[markType]! : [];
    if (existingTrack.length === 0) {
      await client.query('ROLLBACK');
      client.release();
      return res.status(409).json({
        error: 'No mark history available to undo',
        code: 'ERR_UNDO_NOT_AVAILABLE'
      });
    }

    const lastMark: ReviewMark = existingTrack[existingTrack.length - 1];
    if (lastMark.timestamp !== markTimestamp) {
      await client.query('ROLLBACK');
      client.release();
      return res.status(409).json({
        error: 'Undo target does not match the latest mark',
        code: 'ERR_UNDO_TARGET_MISMATCH'
      });
    }

    let revertedTrack: ReviewMark[] = existingTrack.slice(0, -1);
    const shouldRestoreDisplacedMark =
      displacedMark &&
      typeof displacedMark.timestamp === 'string' &&
      typeof displacedMark.isCorrect === 'boolean';

    if (shouldRestoreDisplacedMark) {
      revertedTrack = [displacedMark as ReviewMark, ...revertedTrack].slice(0, MARK_WINDOW_SIZE);
    }

    const revertedHistory: TypedMarkHistory = { ...existingHistory, [markType]: revertedTrack };

    const currentTotalMarkCount: number = entryResult.rows[0].totalMarkCount || 0;
    const currentTotalCorrectCount: number = entryResult.rows[0].totalCorrectCount || 0;
    const newTotalMarkCount: number = Math.max(0, currentTotalMarkCount - 1);
    const newTotalCorrectCount: number = Math.max(0, currentTotalCorrectCount - (lastMark.isCorrect ? 1 : 0));

    const updateQuery = `
      UPDATE ${lockedVetTable}
      SET "typedMarkHistory" = $1,
          "totalMarkCount" = $2,
          "totalCorrectCount" = $3
      WHERE id = $4 AND "userId" = $5
    `;

    await client.query(updateQuery, [
      JSON.stringify(revertedHistory),
      newTotalMarkCount,
      newTotalCorrectCount,
      cardId,
      userId
    ]);

    const category: FlashcardCategory = computeUtcm(revertedHistory, goals);

    // VELOCITY: an undone mark must give back the band-steps it earned, so delete
    // any promotion rows keyed to this exact (card, mark). Enlisted in the undo
    // transaction — unlike the write path this is NOT best-effort, because leaving
    // the row behind would credit a review the user retracted, and the whole undo
    // rolls back together anyway. No-op when the mark promoted nothing.
    await categoryPromotionDAL.deleteForMark(cardId, markTimestamp, client);

    await client.query('COMMIT');
    client.release();
    return res.status(200).json({
      success: true,
      category
    });
  } catch (error: any) {
    try {
      await client.query('ROLLBACK');
    } catch (rollbackError) {
      console.error('Undo rollback failed:', rollbackError);
    }
    console.error('Error undoing flashcard mark:', error);
    client.release();
    return res.status(500).json({
      error: error.message || 'Failed to undo flashcard mark',
      code: error.code || 'ERR_UNDO_MARK_FAILED'
    });
  }
}));

export default router;
