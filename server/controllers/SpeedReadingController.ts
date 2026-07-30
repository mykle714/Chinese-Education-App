import { Request, Response } from 'express';
import { SpeedReadingService } from '../services/SpeedReadingService.js';
import { requireUserId, getUserLanguage, handleControllerError } from '../utils/controllerUtils.js';

/**
 * Speed Reading game HTTP layer — /api/games/speedReading/*
 *
 * LAYER: controller. Parses/validates request shape, delegates every decision to
 * SpeedReadingService, and does no SQL.
 *
 * WHY NOT GamesController: that controller is deliberately game-AGNOSTIC — "one
 * controller serves all games, each request scoped by :gameId" — and serves only
 * the framework-level assets/progress endpoints. This endpoint is specific to one
 * game's data model, so folding it in would break that invariant and make the
 * shared controller grow per game. See docs/SPEED_READING_GAME.md.
 */
export class SpeedReadingController {
  constructor(private speedReadingService: SpeedReadingService) {}

  /**
   * The distractor pool — real characters from the caller's own library, each
   * flagged with whether its reading track is mastered.
   * GET /api/games/speedReading/distractors
   *   → { chars: [{ char, difficultyBand, readingMastered }, ...], masteredReadingExcluded: n }
   *
   * Fetched once at game load; the pool doesn't shrink, so there is no top-up.
   */
  getDistractors = async (req: Request, res: Response): Promise<void> => {
    try {
      const userId = requireUserId(req, res);
      if (!userId) return;

      const language = await getUserLanguage(userId);
      const pool = await this.speedReadingService.getDistractors(userId, language);
      res.json(pool);
    } catch (error: any) {
      handleControllerError(error, res, 'SpeedReadingController.getDistractors');
    }
  };
}
