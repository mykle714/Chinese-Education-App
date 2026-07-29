import { Request, Response } from 'express';
import { UserMinutePointsService } from '../services/UserMinutePointsService.js';
import { requireUserId, handleControllerError } from '../utils/controllerUtils.js';
import { resolveLanguage, resolveWriteLanguage } from '../utils/languageParam.js';

/**
 * UserMinutePoints Controller — HTTP handlers for minute-point operations.
 */
export class UserMinutePointsController {
  constructor(private userMinutePointsService: UserMinutePointsService) {}

  /**
   * POST /api/users/minute-points/increment
   * Body: { timestamp: ISO-8601, tz: IANA, language?: <supported> }
   * The earned minute is attributed to the client-supplied language (what the
   * user was actually studying); falls back to selectedLanguage if omitted.
   */
  async incrementMinutePoints(req: Request, res: Response): Promise<void> {
    try {
      const userId = requireUserId(req, res);
      if (!userId) return;

      const { timestamp, tz, language } = req.body || {};
      if (!timestamp) {
        res.status(400).json({ error: 'timestamp is required', code: 'ERR_MISSING_TIMESTAMP' });
        return;
      }

      await this.userMinutePointsService.incrementMinutePoints(userId, {
        timestamp,
        tz,
        language: resolveWriteLanguage(language),
      });
      res.status(204).end();
    } catch (error) {
      handleControllerError(error, res, 'UserMinutePointsController.incrementMinutePoints');
    }
  }

  /**
   * POST /api/night-market/dev/adjust-minutes  (template-author only)
   * Body: { delta: integer, timestamp: ISO-8601, tz: IANA }
   * Emits an artificial earn (+) or loss (−) minute signal and reconciles the night market.
   * Returns { totalMinutePoints (net), grossMinutesEarned }.
   */
  async adjustMinutesForAuthor(req: Request, res: Response): Promise<void> {
    try {
      const userId = requireUserId(req, res);
      if (!userId) return;

      const { delta, timestamp, tz } = req.body || {};
      if (!timestamp) {
        res.status(400).json({ error: 'timestamp is required', code: 'ERR_MISSING_TIMESTAMP' });
        return;
      }
      if (typeof delta !== 'number' || !Number.isInteger(delta)) {
        res.status(400).json({ error: 'delta must be an integer', code: 'ERR_INVALID_DELTA' });
        return;
      }

      const result = await this.userMinutePointsService.adjustMinutesForAuthor(userId, delta, timestamp, tz);
      res.json(result);
    } catch (error) {
      handleControllerError(error, res, 'UserMinutePointsController.adjustMinutesForAuthor');
    }
  }

  /**
   * GET /api/users/minute-points/calendar/:yearMonth?language=<lang>
   * Calendar is scoped to one language (defaults to 'zh').
   */
  async getCalendar(req: Request, res: Response): Promise<void> {
    try {
      const userId = requireUserId(req, res);
      if (!userId) return;

      const { yearMonth } = req.params;
      if (!yearMonth) {
        res.status(400).json({ error: 'yearMonth path param is required', code: 'ERR_MISSING_YEAR_MONTH' });
        return;
      }

      const language = resolveLanguage(req.query.language);
      const calendar = await this.userMinutePointsService.getCalendar(userId, language, yearMonth);
      res.json(calendar);
    } catch (error) {
      handleControllerError(error, res, 'UserMinutePointsController.getCalendar');
    }
  }

  /**
   * GET /api/users/minute-points/summary?language=<lang>&tz=<IANA>&timestamp=<ISO>
   * That language's lifetime total, today's minutes, NET wallet and streak — every
   * figure scoped to the one language (migration 130). Powers the home screen and the
   * fire badge for the selected language.
   */
  async getSummary(req: Request, res: Response): Promise<void> {
    try {
      const userId = requireUserId(req, res);
      if (!userId) return;

      const language = resolveLanguage(req.query.language);
      const tz = typeof req.query.tz === 'string' ? req.query.tz : 'UTC';
      // Client may pass its own "now"; otherwise resolve today on the server.
      const timestamp = typeof req.query.timestamp === 'string'
        ? req.query.timestamp
        : new Date().toISOString();

      const summary = await this.userMinutePointsService.getLanguageSummary(userId, language, timestamp, tz);
      res.json(summary);
    } catch (error) {
      handleControllerError(error, res, 'UserMinutePointsController.getSummary');
    }
  }
}
