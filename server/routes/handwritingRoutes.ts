import { Router } from 'express';
import { authenticateToken } from '../authMiddleware.js';
import { proxyLimiter } from '../middleware/rateLimits.js';
import { recognizeChinese, validateInk } from '../utils/handwritingRecognizer.js';
import { recordCompletion, getCompletedLevels, isWritingPracticeLevel } from '../utils/writingPracticeStore.js';
import { handle } from './asyncHandler.js';
import { resolveWriteLanguage } from '../utils/languageParam.js';
import type { Language } from '../types/index.js';

/**
 * Handwriting recognition + writing-practice completion routes — /api/handwriting/*
 *
 * LAYER: HTTP route layer. The recognize handler validates + proxies to Google
 * Input Tools; the completions handlers read/write the writing-practice store.
 * Split out of server.ts; paths unchanged.
 * See docs/HANDWRITING_RECOGNITION.md and docs/PRACTICE_WRITING.md.
 */
const router = Router();

/**
 * Validate the (language, entryKey) pair a completions call is scoped to.
 *
 * Neither value used to be checked at all: `language` went straight into the query
 * and `entryKey` was an unbounded string, so `writing_practice_completions` accepted
 * rows for languages the app does not support and for keys of any length. Nothing
 * downstream reads those rows, which is exactly why it went unnoticed — junk that no
 * screen renders still occupies the table.
 *
 * `entryKey` is a SINGLE CHARACTER in practice (`PracticeWritingPopup` passes one),
 * so the cap is deliberately tight. It is not validated against the dictionary: a
 * learner may reasonably practise a component character that has no headword row of
 * its own, and rejecting those would break the feature to close a much smaller hole
 * than the length cap already closes.
 *
 * Returns the coerced language, or null when the pair is unusable.
 */
const MAX_PRACTICE_ENTRY_KEY_LENGTH = 8;

function validateCompletionTarget(language: unknown, entryKey: unknown): { language: Language; entryKey: string } | null {
  const resolved = resolveWriteLanguage(language);
  if (!resolved) return null;
  if (typeof entryKey !== 'string') return null;
  const trimmed = entryKey.trim();
  if (!trimmed || [...trimmed].length > MAX_PRACTICE_ENTRY_KEY_LENGTH) return null;
  return { language: resolved, entryKey: trimmed };
}


// Handwriting recognition proxy — converts canonical Ink to the Google Input
// Tools request, returns ranked candidate characters. Behind auth so it can't be
// abused as an open proxy to Google's endpoint; proxyLimiter caps quota burn.
// See server/utils/handwritingRecognizer.ts (the only file touching Google).
router.post('/api/handwriting/recognize', authenticateToken, proxyLimiter, handle(async (req, res) => {
  try {
    const body = req.body || {};
    const width = Number(body.writingAreaWidth);
    const height = Number(body.writingAreaHeight);
    if (!Number.isFinite(width) || !Number.isFinite(height) || width <= 0 || height <= 0) {
      return res.status(400).json({
        error: 'writingAreaWidth and writingAreaHeight must be positive numbers',
        code: 'ERR_BAD_WRITING_AREA',
      });
    }

    let ink;
    try {
      ink = validateInk(body.ink);
    } catch (validationErr: any) {
      return res.status(400).json({ error: validationErr.message, code: 'ERR_BAD_INK' });
    }

    const candidates = await recognizeChinese(ink, width, height);
    // top1 is what the practice popup grades against (correct iff target === top1).
    return res.json({ candidates, top1: candidates[0] ?? null });
  } catch (err: any) {
    console.error('Error in handwriting recognition proxy:', err?.message || err);
    return res.status(502).json({ error: 'handwriting recognition failed', code: 'ERR_UPSTREAM' });
  }
}));

// Writing-practice completions — read the completed levels for a character (drives
// the star in each popup tab + the star-count superscript on the practice button).
router.get('/api/handwriting/completions', authenticateToken, handle(async (req, res) => {
  try {
    const userId = (req as any).user?.userId;
    if (!userId) return res.status(401).json({ error: 'Unauthorized', code: 'ERR_UNAUTHORIZED' });
    const target = validateCompletionTarget(req.query.language, req.query.entryKey);
    if (!target) {
      return res.status(400).json({
        error: 'a supported language and a short entryKey are required',
        code: 'ERR_MISSING_FIELDS',
      });
    }
    const { language, entryKey } = target;
    const completedLevels = await getCompletedLevels(userId, language, entryKey);
    return res.json({ completedLevels });
  } catch (err: any) {
    console.error('Error fetching writing-practice completions:', err?.message || err);
    return res.status(500).json({ error: 'failed to fetch completions', code: 'ERR_DB' });
  }
}));

// Record a first-time completion of a level for a character (idempotent). Returns
// the character's full completed-level set so the client updates stars in one hop.
router.post('/api/handwriting/completions', authenticateToken, handle(async (req, res) => {
  try {
    const userId = (req as any).user?.userId;
    if (!userId) return res.status(401).json({ error: 'Unauthorized', code: 'ERR_UNAUTHORIZED' });
    const { level } = req.body || {};
    const target = validateCompletionTarget(req.body?.language, req.body?.entryKey);
    if (!target || !isWritingPracticeLevel(level)) {
      return res.status(400).json({
        error: 'a supported language, a short entryKey, and a valid level are required',
        code: 'ERR_MISSING_FIELDS',
      });
    }
    const completedLevels = await recordCompletion(userId, target.language, target.entryKey, level);
    return res.json({ completedLevels });
  } catch (err: any) {
    console.error('Error recording writing-practice completion:', err?.message || err);
    return res.status(500).json({ error: 'failed to record completion', code: 'ERR_DB' });
  }
}));

export default router;
