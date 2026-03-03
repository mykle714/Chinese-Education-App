import { Request, Response } from 'express';
import { UserWorkPointsService } from '../services/UserWorkPointsService.js';
import { ValidationError, NotFoundError, DALError } from '../types/dal.js';

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
      const userId = (req as any).user?.userId;
      const { date } = req.body;

      if (!userId) {
        res.status(401).json({
          error: 'User not authenticated',
          code: 'ERR_NOT_AUTHENTICATED'
        });
        return;
      }

      if (!date) {
        res.status(400).json({
          error: 'Date is required',
          code: 'ERR_MISSING_DATE'
        });
        return;
      }

      await this.userWorkPointsService.incrementWorkPoints(userId, { date });
      res.status(204).end();
    } catch (error) {
      this.handleError(error, res);
    }
  }

  /**
   * Apply new-day boundary logic (streak penalty if 2+ days gap)
   * POST /api/users/work-points/new-day
   * Body: { date: "YYYY-MM-DD" }
   */
  async newDayOperation(req: Request, res: Response): Promise<void> {
    try {
      const userId = (req as any).user?.userId;
      const { date } = req.body;

      if (!userId) {
        res.status(401).json({
          error: 'User not authenticated',
          code: 'ERR_NOT_AUTHENTICATED'
        });
        return;
      }

      if (!date) {
        res.status(400).json({
          error: 'Date is required',
          code: 'ERR_MISSING_DATE'
        });
        return;
      }

      await this.userWorkPointsService.newDayOperation(userId, date);
      res.status(204).end();
    } catch (error) {
      this.handleError(error, res);
    }
  }

  /**
   * Check if user has work points for specific date
   * GET /api/users/work-points/check/:date
   */
  async hasWorkPointsForDate(req: Request, res: Response): Promise<void> {
    try {
      const userId = (req as any).user?.userId;
      const date = req.params.date;

      if (!userId) {
        res.status(401).json({
          error: 'User not authenticated',
          code: 'ERR_NOT_AUTHENTICATED'
        });
        return;
      }

      if (!date) {
        res.status(400).json({
          error: 'Date parameter is required',
          code: 'ERR_MISSING_DATE'
        });
        return;
      }

      const hasPoints = await this.userWorkPointsService.hasWorkPointsForDate(userId, date);
      res.json({ hasWorkPoints: hasPoints });
    } catch (error) {
      this.handleError(error, res);
    }
  }

  /**
   * Get total work points for specific date
   * GET /api/users/work-points/total/:date
   */
  async getTotalWorkPointsForDate(req: Request, res: Response): Promise<void> {
    try {
      const userId = (req as any).user?.userId;
      const date = req.params.date;

      if (!userId) {
        res.status(401).json({
          error: 'User not authenticated',
          code: 'ERR_NOT_AUTHENTICATED'
        });
        return;
      }

      if (!date) {
        res.status(400).json({
          error: 'Date parameter is required',
          code: 'ERR_MISSING_DATE'
        });
        return;
      }

      const totalPoints = await this.userWorkPointsService.getTotalWorkPointsForDate(userId, date);
      res.json({ totalWorkPoints: totalPoints, date });
    } catch (error) {
      this.handleError(error, res);
    }
  }

  /**
   * Generate device fingerprint (utility endpoint)
   * POST /api/users/work-points/generate-fingerprint
   */
  async generateDeviceFingerprint(req: Request, res: Response): Promise<void> {
    try {
      const userId = (req as any).user?.userId;

      if (!userId) {
        res.status(401).json({
          error: 'User not authenticated',
          code: 'ERR_NOT_AUTHENTICATED'
        });
        return;
      }

      const fingerprint = this.userWorkPointsService.generateDeviceFingerprint(
        req.get('User-Agent'),
        Date.now()
      );

      res.json({ deviceFingerprint: fingerprint });
    } catch (error) {
      this.handleError(error, res);
    }
  }

  private handleError(error: any, res: Response): void {
    console.error('UserWorkPointsController error:', {
      message: error.message,
      stack: error.stack,
      code: error.code,
      statusCode: error.statusCode,
      timestamp: new Date().toISOString()
    });

    if (error instanceof ValidationError) {
      const clientError = error.toClientError();
      res.status(clientError.statusCode).json({
        error: clientError.message,
        code: clientError.code
      });
      return;
    }

    if (error instanceof NotFoundError) {
      const clientError = error.toClientError();
      res.status(clientError.statusCode).json({
        error: clientError.message,
        code: clientError.code
      });
      return;
    }

    if (error instanceof DALError) {
      const clientError = error.toClientError();
      res.status(clientError.statusCode).json({
        error: clientError.message,
        code: clientError.code
      });
      return;
    }

    if (error.code && error.statusCode) {
      let sanitizedMessage = error.message;
      sanitizedMessage = sanitizedMessage.replace(/mykle\.database\.windows\.net/gi, '[server]');
      sanitizedMessage = sanitizedMessage.replace(/\b\d{1,3}\.\d{1,3}\.\d{1,3}\.\d{1,3}\b/g, '[server]');
      sanitizedMessage = sanitizedMessage.replace(/:\d{4,5}/g, '');
      sanitizedMessage = sanitizedMessage.replace(/in \d+ms/g, '');

      res.status(error.statusCode).json({
        error: sanitizedMessage,
        code: error.code
      });
      return;
    }

    res.status(500).json({
      error: 'Internal server error',
      code: 'ERR_INTERNAL_SERVER_ERROR'
    });
  }
}
