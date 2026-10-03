import { Request, Response } from 'express';
import { WordOfTheDayService } from '../services/WordOfTheDayService.js';
import { requireUserId, handleControllerError } from '../utils/controllerUtils.js';

/**
 * Word of the Day HTTP layer (docs/READING_WRITING_CENTERS.md § Phase 3).
 *
 *   GET /api/dictionary/word-of-the-day?day=YYYY-MM-DD → WordOfTheDay
 *
 * `day` is the caller's LOCAL calendar date. LAYER: controller — reads the query,
 * hands off to WordOfTheDayService; validation errors map to 400 via
 * handleControllerError.
 */
export class WordOfTheDayController {
  constructor(private wordOfTheDayService: WordOfTheDayService) {}

  /** GET /api/dictionary/word-of-the-day */
  async get(req: Request, res: Response): Promise<void> {
    try {
      // Signed-in only (the route is behind authenticateToken); the word itself is global.
      const userId = requireUserId(req, res);
      if (!userId) return;
      const day = typeof req.query.day === 'string' ? req.query.day : '';
      res.json(await this.wordOfTheDayService.getForDay(day));
    } catch (error) {
      handleControllerError(error, res, 'WordOfTheDayController.get');
    }
  }
}
