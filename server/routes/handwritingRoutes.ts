import { Router } from 'express';
import { authenticateToken } from '../authMiddleware.js';
import { proxyLimiter } from '../middleware/rateLimits.js';
import { recognizeChinese, validateInk } from '../utils/handwritingRecognizer.js';
import { recordCompletion, getCompletedLevels, isWritingPracticeLevel } from '../utils/writingPracticeStore.js';

/**
 * Handwriting recognition + writing-practice completion routes — /api/handwriting/*
 *
 * LAYER: HTTP route layer. The recognize handler validates + proxies to Google
 * Input Tools; the completions handlers read/write the writing-practice store.
 * Split out of server.ts; paths unchanged.
 * See docs/HANDWRITING_RECOGNITION.md and docs/PRACTICE_WRITING.md.
 */
const router = Router();

// Handwriting recognition proxy — converts canonical Ink to the Google Input
// Tools request, returns ranked candidate characters. Behind auth so it can't be
// abused as an open proxy to Google's endpoint; proxyLimiter caps quota burn.
// See server/utils/handwritingRecognizer.ts (the only file touching Google).
// @ts-ignore
router.post('/api/handwriting/recognize', authenticateToken, proxyLimiter, async (req, res) => {
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
});

// Writing-practice completions — read the completed levels for a character (drives
// the star in each popup tab + the star-count superscript on the practice button).
// @ts-ignore
router.get('/api/handwriting/completions', authenticateToken, async (req, res) => {
  try {
    const userId = (req as any).user?.userId;
    if (!userId) return res.status(401).json({ error: 'Unauthorized', code: 'ERR_UNAUTHORIZED' });
    const language = String(req.query.language || '');
    const entryKey = String(req.query.entryKey || '');
    if (!language || !entryKey) {
      return res.status(400).json({ error: 'language and entryKey are required', code: 'ERR_MISSING_FIELDS' });
    }
    const completedLevels = await getCompletedLevels(userId, language, entryKey);
    return res.json({ completedLevels });
  } catch (err: any) {
    console.error('Error fetching writing-practice completions:', err?.message || err);
    return res.status(500).json({ error: 'failed to fetch completions', code: 'ERR_DB' });
  }
});

// Record a first-time completion of a level for a character (idempotent). Returns
// the character's full completed-level set so the client updates stars in one hop.
// @ts-ignore
router.post('/api/handwriting/completions', authenticateToken, async (req, res) => {
  try {
    const userId = (req as any).user?.userId;
    if (!userId) return res.status(401).json({ error: 'Unauthorized', code: 'ERR_UNAUTHORIZED' });
    const { language, entryKey, level } = req.body || {};
    if (!language || !entryKey || !isWritingPracticeLevel(level)) {
      return res.status(400).json({
        error: 'language, entryKey, and a valid level are required',
        code: 'ERR_MISSING_FIELDS',
      });
    }
    const completedLevels = await recordCompletion(userId, language, entryKey, level);
    return res.json({ completedLevels });
  } catch (err: any) {
    console.error('Error recording writing-practice completion:', err?.message || err);
    return res.status(500).json({ error: 'failed to record completion', code: 'ERR_DB' });
  }
});

export default router;
