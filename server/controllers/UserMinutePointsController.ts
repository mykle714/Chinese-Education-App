import { Request, Response } from 'express';
import { UserMinutePointsService } from '../services/UserMinutePointsService.js';
import { requireUserId, handleControllerError } from '../utils/controllerUtils.js';

/**
 * UserMinutePoints Controller — HTTP handlers for minute-point operations.
 */
export class UserMinutePointsController {
  constructor(private userMinutePointsService: UserMinutePointsService) {}

  /**
   * POST /api/users/minute-points/increment
   * Body: { timestamp: ISO-8601, tz: IANA }
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
   * POST /api/users/minute-points/new-day
   * Body: { timestamp: ISO-8601, tz: IANA }
   */
  async newDayOperation(req: Request, res: Response): Promise<void> {
    try {
      const userId = requireUserId(req, res);
      if (!userId) return;

      const { timestamp, tz } = req.body || {};
      if (!timestamp) {
        res.status(400).json({ error: 'timestamp is required', code: 'ERR_MISSING_TIMESTAMP' });
        return;
      }

      await this.userMinutePointsService.newDayOperation(userId, { timestamp, tz });
      res.status(204).end();
    } catch (error) {
      handleControllerError(error, res, 'UserMinutePointsController.newDayOperation');
    }
  }

  /**
   * GET /api/users/minute-points/calendar/:yearMonth
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

      const calendar = await this.userMinutePointsService.getCalendar(userId, yearMonth);
      res.json(calendar);
    } catch (error) {
      handleControllerError(error, res, 'UserMinutePointsController.getCalendar');
    }
  }
}
