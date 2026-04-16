import { Request, Response } from 'express';
import { UserWorkPointsService } from '../services/UserWorkPointsService.js';
import { requireUserId, handleControllerError } from '../utils/controllerUtils.js';

/**
 * UserWorkPoints Controller - Handles HTTP requests and responses for work points operations
 */
export class UserWorkPointsController {
  constructor(private userWorkPointsService: UserWorkPointsService) {}

  /**
   * Increment work points by exactly 1
   * POST /api/users/work-points/increment
   * Body: { date: "YYYY-MM-DD" }
   */
  async incrementWorkPoints(req: Request, res: Response): Promise<void> {
    try {
      const userId = requireUserId(req, res);
      if (!userId) return;

      const { date } = req.body;
      if (!date) {
        res.status(400).json({ error: 'Date is required', code: 'ERR_MISSING_DATE' });
        return;
      }

      await this.userWorkPointsService.incrementWorkPoints(userId, { date });
      res.status(204).end();
    } catch (error) {
      handleControllerError(error, res, 'UserWorkPointsController.incrementWorkPoints');
    }
  }

  /**
   * Apply new-day boundary logic (streak penalty if 2+ days gap)
   * POST /api/users/work-points/new-day
   * Body: { date: "YYYY-MM-DD" }
   */
  async newDayOperation(req: Request, res: Response): Promise<void> {
    try {
      const userId = requireUserId(req, res);
      if (!userId) return;

      const { date } = req.body;
      if (!date) {
        res.status(400).json({ error: 'Date is required', code: 'ERR_MISSING_DATE' });
        return;
      }

      await this.userWorkPointsService.newDayOperation(userId, date);
      res.status(204).end();
    } catch (error) {
      handleControllerError(error, res, 'UserWorkPointsController.newDayOperation');
    }
  }

  /**
   * Check if user has work points for specific date
   * GET /api/users/work-points/check/:date
   */
  async hasWorkPointsForDate(req: Request, res: Response): Promise<void> {
    try {
      const userId = requireUserId(req, res);
      if (!userId) return;

      const date = req.params.date;
      if (!date) {
        res.status(400).json({ error: 'Date parameter is required', code: 'ERR_MISSING_DATE' });
        return;
      }

      const hasPoints = await this.userWorkPointsService.hasWorkPointsForDate(userId, date);
      res.json({ hasWorkPoints: hasPoints });
    } catch (error) {
      handleControllerError(error, res, 'UserWorkPointsController.hasWorkPointsForDate');
    }
  }

  /**
   * Get total work points for specific date
   * GET /api/users/work-points/total/:date
   */
  async getTotalWorkPointsForDate(req: Request, res: Response): Promise<void> {
    try {
      const userId = requireUserId(req, res);
      if (!userId) return;

      const date = req.params.date;
      if (!date) {
        res.status(400).json({ error: 'Date parameter is required', code: 'ERR_MISSING_DATE' });
        return;
      }

      const totalPoints = await this.userWorkPointsService.getTotalWorkPointsForDate(userId, date);
      res.json({ totalWorkPoints: totalPoints, date });
    } catch (error) {
      handleControllerError(error, res, 'UserWorkPointsController.getTotalWorkPointsForDate');
    }
  }

  /**
   * Generate device fingerprint (utility endpoint)
   * POST /api/users/work-points/generate-fingerprint
   */
  async generateDeviceFingerprint(req: Request, res: Response): Promise<void> {
    try {
      const userId = requireUserId(req, res);
      if (!userId) return;

      const fingerprint = this.userWorkPointsService.generateDeviceFingerprint(
        req.get('User-Agent'),
        Date.now()
      );

      res.json({ deviceFingerprint: fingerprint });
    } catch (error) {
      handleControllerError(error, res, 'UserWorkPointsController.generateDeviceFingerprint');
    }
  }
}
