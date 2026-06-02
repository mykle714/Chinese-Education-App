import { Request, Response } from 'express';
import { UserMinutePointsService } from '../services/UserMinutePointsService.js';
import { requireUserId, handleControllerError } from '../utils/controllerUtils.js';
import { Language } from '../types/index.js';

// Languages whose minutes we track. Mirrors the server `Language` union
// (only zh/es are user-selectable today; ja/ko/vi are not yet enabled).
const SUPPORTED_LANGUAGES: Language[] = ['zh', 'es'];

/** Coerce a query param to a supported language, falling back to 'zh'. */
function resolveLanguage(raw: unknown): Language {
  return SUPPORTED_LANGUAGES.includes(raw as Language) ? (raw as Language) : 'zh';
}

/**
 * UserMinutePoints Controller — HTTP handlers for minute-point operations.
 */
export class UserMinutePointsController {
  constructor(private userMinutePointsService: UserMinutePointsService) {}

  /**
   * POST /api/users/minute-points/increment
   * Body: { timestamp: ISO-8601, tz: IANA }
   * The earned minute is attributed to the user's selectedLanguage server-side.
   */
  async incrementMinutePoints(req: Request, res: Response): Promise<void> {
    try {
      const userId = requireUserId(req, res);
      if (!userId) return;

      const { timestamp, tz } = req.body || {};
      if (!timestamp) {
        res.status(400).json({ error: 'timestamp is required', code: 'ERR_MISSING_TIMESTAMP' });
        return;
      }

      await this.userMinutePointsService.incrementMinutePoints(userId, { timestamp, tz });
      res.status(204).end();
    } catch (error) {
      handleControllerError(error, res, 'UserMinutePointsController.incrementMinutePoints');
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
   * Per-language lifetime total + today's minutes, plus the global current streak.
   * Powers the home screen and the fire badge for the selected language.
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
