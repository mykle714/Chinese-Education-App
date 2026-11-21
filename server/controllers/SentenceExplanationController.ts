import { Request, Response } from 'express';
import { requireUserId, handleControllerError } from '../utils/controllerUtils.js';
import { resolveTimezone, streakDateOf } from '../utils/streakDate.js';
import { RateLimitError } from '../types/dal.js';
import { EXPLAIN_SENTENCE_MAX_LENGTH, type SentenceExplanationResult } from '../contracts/wire.js';
import type { SentenceExplanationService } from '../services/SentenceExplanationService.js';

/**
 * POST /api/texts/explainSentence { sentence, language, tz } → SentenceExplanationResult
 *
 * The Reader's sentence Explain (docs/USER_DOCUMENT_FEATURE_SUMMARY.md § "Sentence Explain").
 * Thin: validates the body, derives the shared AI budget's day from `tz` (the same 04:00-local
 * streak-day as the dictionary AI fallback and Compare), and maps the daily-limit error to a 429
 * whose message the rdb shows as-is.
 *
 * Layer: controller. Depends on SentenceExplanationService.
 */
export class SentenceExplanationController {
  constructor(private sentenceExplanationService: SentenceExplanationService) {}

  async explain(req: Request, res: Response): Promise<void> {
    try {
      const userId = requireUserId(req, res);
      if (!userId) return;

      const { sentence, language, tz } = req.body ?? {};
      const trimmed = typeof sentence === 'string' ? sentence.trim() : '';
      if (!trimmed) {
        res.status(400).json({ error: 'sentence is required', code: 'ERR_INVALID_INPUT' });
        return;
      }
      if (trimmed.length > EXPLAIN_SENTENCE_MAX_LENGTH) {
        res.status(400).json({ error: `sentence is longer than ${EXPLAIN_SENTENCE_MAX_LENGTH} characters`, code: 'ERR_INVALID_INPUT' });
        return;
      }
      if (typeof language !== 'string' || !language) {
        res.status(400).json({ error: 'language is required', code: 'ERR_INVALID_INPUT' });
        return;
      }

      const usageDate = streakDateOf(new Date(), resolveTimezone(tz));
      const result: SentenceExplanationResult = await this.sentenceExplanationService.explainSentence(
        userId, trimmed, language, usageDate,
      );
      res.json(result);
    } catch (error: any) {
      // The shared daily AI budget is spent → 429 with the user-facing message (the rdb shows it).
      if (error instanceof RateLimitError) {
        res.status(error.statusCode).json({ error: error.message, code: error.code });
        return;
      }
      handleControllerError(error, res, 'SentenceExplanationController.explain');
    }
  }
}
