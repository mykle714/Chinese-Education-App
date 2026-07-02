import { Router } from 'express';
import { authenticateToken } from '../authMiddleware.js';
import db from '../db.js';
import { VET_PHYSICAL_TABLES, vetTableForLanguage } from '../dal/shared/vetTable.js';
import { onDeckVocabService } from '../dal/setup.js';
import { MODE_CONFIGS, type StudyMode } from '../services/OnDeckVocabService.js';
import { ReviewMark, FlashcardCategory } from '../types/index.js';

/**
 * Flashcard mark/undo routes — /api/flashcards/*
 *
 * LAYER: HTTP route layer, but these two handlers still carry the mark/undo
 * business logic inline (moved verbatim from server.ts). They are the last
 * route handlers with embedded SQL — a future pass should push this into
 * VocabEntryService. See docs/FLASHCARD_REVIEW_HISTORY_IMPLEMENTATION.md.
 *
 * NOTE: category is not computed in app code. It is a GENERATED STORED column
 * (migration 67) derived from markHistory by compute_flashcard_category();
 * the mark/undo endpoints read the freshly-derived value back via `RETURNING category`.
 */
const router = Router();

function calculateSuccessRates(markHistory: ReviewMark[], totalMarkCount: number, totalCorrectCount: number): {
  totalSuccessRate: number;
  last8SuccessRate: number;
  last16SuccessRate: number;
} {
  const totalSuccessRate = totalMarkCount > 0 ? totalCorrectCount / totalMarkCount : 0;
  const last8Marks: ReviewMark[] = markHistory.slice(-8);
  const last8Correct: number = last8Marks.filter(m => m.isCorrect).length;
  const last8SuccessRate = last8Marks.length > 0 ? last8Correct / last8Marks.length : 0;
  const last16Correct: number = markHistory.filter(m => m.isCorrect).length;
  const last16SuccessRate = markHistory.length > 0 ? last16Correct / markHistory.length : 0;

  return {
    totalSuccessRate,
    last8SuccessRate,
    last16SuccessRate
  };
}

// Mark a flashcard as correct or incorrect (protected route)
// @ts-ignore
router.post('/api/flashcards/mark', authenticateToken, async (req, res) => {
  const client = await db.getClient();

  try {
    const userId = (req as any).user?.userId;
    const { cardId, isCorrect, excludeIds: rawExcludeIds, mode: rawMode } = req.body;

    // Optional difficulty mode (Easy/Hard). When set, the replacement card must
    // stay within the mode's allowed categories so a banned category never leaks
    // back into the loop via a correct-mark refill.
    const mode: StudyMode | undefined =
      rawMode === 'easy' || rawMode === 'hard' ? rawMode : undefined;

    if (!userId) {
      client.release();
      return res.status(401).json({ error: 'Unauthorized', code: 'ERR_UNAUTHORIZED' });
    }

    if (typeof cardId !== 'number' || typeof isCorrect !== 'boolean') {
      client.release();
      return res.status(400).json({
        error: 'Invalid request body. Expected { cardId: number, isCorrect: boolean }',
        code: 'ERR_INVALID_REQUEST'
      });
    }

    // excludeIds is the list of card ids currently in the client's working loop,
    // so the replacement picker avoids handing back a duplicate.
    const excludeIds: number[] = Array.isArray(rawExcludeIds)
      ? rawExcludeIds.filter((n): n is number => typeof n === 'number')
      : [];

    // Fetch the current vocab entry to get its mark history, counts, rates, AND CURRENT CATEGORY
    // vet is split per language; the client sends only a cardId, so probe each
    // physical table (ids are globally unique) — exactly one holds the row.
    let entryResult: any = { rows: [] };
    for (const t of VET_PHYSICAL_TABLES) {
      const r = await client.query(
        `SELECT "markHistory", "totalMarkCount", "totalCorrectCount", "totalSuccessRate", "last8SuccessRate", "last16SuccessRate", "category", "language" FROM ${t} WHERE id = $1 AND "userId" = $2`,
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

    // Get existing mark history or initialize empty array
    const existingHistory: ReviewMark[] = entryResult.rows[0].markHistory || [];

    // Get current counts and rates
    const currentTotalMarkCount: number = entryResult.rows[0].totalMarkCount || 0;
    const currentTotalCorrectCount: number = entryResult.rows[0].totalCorrectCount || 0;
    // CAPTURE THE CATEGORY BEFORE THE MARK IS APPLIED
    const categoryBeforeMark: string = entryResult.rows[0].category || 'Unfamiliar';
    // The replacement card must be in the same language as the card just marked.
    const cardLanguage: string = entryResult.rows[0].language || 'zh';

    // Preserve the displaced oldest mark when history is already at capacity.
    const displacedMark: ReviewMark | null = existingHistory.length >= 16 ? existingHistory[0] : null;

    // Add new mark
    const newMark: ReviewMark = {
      timestamp: new Date().toISOString(),
      isCorrect
    };

    // Append new mark and keep only last 16
    const updatedHistory = [...existingHistory, newMark].slice(-16);

    // Calculate new counts
    const newTotalMarkCount: number = currentTotalMarkCount + 1;
    const newTotalCorrectCount: number = currentTotalCorrectCount + (isCorrect ? 1 : 0);

    const {
      totalSuccessRate: newTotalSuccessRate,
      last8SuccessRate: newLast8SuccessRate,
      last16SuccessRate: newLast16SuccessRate
    } = calculateSuccessRates(updatedHistory, newTotalMarkCount, newTotalCorrectCount);

    // Update the database with new mark history, counts, and success rates.
    // `category` is a GENERATED column (migration 67) derived from markHistory, so
    // we never write it — instead RETURNING hands back the freshly-derived value.
    // We know the row's language (read above), so route to its per-language vet table.
    const updateQuery = `
      UPDATE ${vetTableForLanguage(cardLanguage)}
      SET "markHistory" = $1,
          "totalMarkCount" = $2,
          "totalCorrectCount" = $3,
          "totalSuccessRate" = $4,
          "last8SuccessRate" = $5,
          "last16SuccessRate" = $6
      WHERE id = $7 AND "userId" = $8
      RETURNING category
    `;
    const updateResult = await client.query(updateQuery, [
      JSON.stringify(updatedHistory),
      newTotalMarkCount,
      newTotalCorrectCount,
      newTotalSuccessRate,
      newLast8SuccessRate,
      newLast16SuccessRate,
      cardId,
      userId
    ]);
    const category: FlashcardCategory = updateResult.rows[0].category;

    // If correct, return a card from the same category as BEFORE the mark (with fallback priority).
    // In a mode session the replacement pool is capped to the mode's allowed categories.
    if (isCorrect) {
      const allowedCategories = mode ? MODE_CONFIGS[mode].allowed : undefined;
      const newCard = await onDeckVocabService.getNextLibraryCardWithFallback(userId, categoryBeforeMark, cardLanguage, excludeIds, allowedCategories);

      if (!newCard) {
        // In a mode session, "no eligible replacement" is the expected end-of-pool
        // state, not an error: return success with newCard:null so the client winds
        // the loop down ("no more easy/hard cards remaining"). Mix keeps the 404.
        if (mode) {
          client.release();
          return res.status(200).json({
            success: true,
            category,
            markTimestamp: newMark.timestamp,
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
});

// Undo the most recently saved flashcard mark (protected route)
// @ts-ignore
router.post('/api/flashcards/undo-last-mark', authenticateToken, async (req, res) => {
  const client = await db.getClient();
  try {
    const userId = (req as any).user?.userId;
    const { cardId, markTimestamp, displacedMark } = req.body || {};

    if (!userId) {
      client.release();
      return res.status(401).json({ error: 'Unauthorized', code: 'ERR_UNAUTHORIZED' });
    }

    if (typeof cardId !== 'number' || typeof markTimestamp !== 'string') {
      client.release();
      return res.status(400).json({
        error: 'Invalid request body. Expected { cardId: number, markTimestamp: string }',
        code: 'ERR_INVALID_REQUEST'
      });
    }

    await client.query('BEGIN');

    // FOR UPDATE can't run against the union view, and we don't yet know the row's
    // language, so probe each per-language vet table; the one holding this id
    // returns (and locks) the row. ids are globally unique across the pair.
    let entryResult: any = { rows: [] };
    let lockedVetTable: string | null = null;
    for (const t of VET_PHYSICAL_TABLES) {
      const r = await client.query(
        `SELECT "markHistory", "totalMarkCount", "totalCorrectCount" FROM ${t} WHERE id = $1 AND "userId" = $2 FOR UPDATE`,
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

    const existingHistory: ReviewMark[] = Array.isArray(entryResult.rows[0].markHistory) ? entryResult.rows[0].markHistory : [];
    if (existingHistory.length === 0) {
      await client.query('ROLLBACK');
      client.release();
      return res.status(409).json({
        error: 'No mark history available to undo',
        code: 'ERR_UNDO_NOT_AVAILABLE'
      });
    }

    const lastMark: ReviewMark = existingHistory[existingHistory.length - 1];
    if (lastMark.timestamp !== markTimestamp) {
      await client.query('ROLLBACK');
      client.release();
      return res.status(409).json({
        error: 'Undo target does not match the latest mark',
        code: 'ERR_UNDO_TARGET_MISMATCH'
      });
    }

    let revertedHistory: ReviewMark[] = existingHistory.slice(0, -1);
    const shouldRestoreDisplacedMark =
      displacedMark &&
      typeof displacedMark.timestamp === 'string' &&
      typeof displacedMark.isCorrect === 'boolean';

    if (shouldRestoreDisplacedMark) {
      revertedHistory = [displacedMark as ReviewMark, ...revertedHistory].slice(0, 16);
    }

    const currentTotalMarkCount: number = entryResult.rows[0].totalMarkCount || 0;
    const currentTotalCorrectCount: number = entryResult.rows[0].totalCorrectCount || 0;
    const newTotalMarkCount: number = Math.max(0, currentTotalMarkCount - 1);
    const newTotalCorrectCount: number = Math.max(0, currentTotalCorrectCount - (lastMark.isCorrect ? 1 : 0));
    const {
      totalSuccessRate,
      last8SuccessRate,
      last16SuccessRate
    } = calculateSuccessRates(revertedHistory, newTotalMarkCount, newTotalCorrectCount);

    // `category` is GENERATED from markHistory (migration 67) — never written here;
    // RETURNING gives back the value re-derived from the reverted history.
    const updateQuery = `
      UPDATE ${lockedVetTable}
      SET "markHistory" = $1,
          "totalMarkCount" = $2,
          "totalCorrectCount" = $3,
          "totalSuccessRate" = $4,
          "last8SuccessRate" = $5,
          "last16SuccessRate" = $6
      WHERE id = $7 AND "userId" = $8
      RETURNING category
    `;

    const updateResult = await client.query(updateQuery, [
      JSON.stringify(revertedHistory),
      newTotalMarkCount,
      newTotalCorrectCount,
      totalSuccessRate,
      last8SuccessRate,
      last16SuccessRate,
      cardId,
      userId
    ]);
    const category: FlashcardCategory = updateResult.rows[0].category;

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
});

export default router;
