import { Request, Response } from 'express';
import { UserWorkPointsService } from '../services/UserWorkPointsService.js';
import { ValidationError, NotFoundError, DALError } from '../types/dal.js';

/**
 * UserWorkPoints Controller - Handles HTTP requests and responses for work points operations
 * Delegates business logic to UserWorkPointsService
 */
export class UserWorkPointsController {
  constructor(private userWorkPointsService: UserWorkPointsService) {}

  /**
   * NEW: Increment work points by exactly 1
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

      console.log(`[WORK-POINTS-CONTROLLER] ➕ Increment request received:`, {
        userId: `${userId.substring(0, 8)}...`,
        date,
        userAgent: req.get('User-Agent')?.substring(0, 50) + '...',
        timestamp: new Date().toISOString()
      });

      const incrementResult = await this.userWorkPointsService.incrementWorkPoints(userId, { date });

      res.json(incrementResult);
    } catch (error) {
      this.handleError(error, res);
    }
  }

  /**
   * DEPRECATED: Sync work points for a user (supports single or multiple dates)
   * POST /api/users/work-points/sync
   * Use /api/users/work-points/increment instead
   */
  async syncWorkPoints(req: Request, res: Response): Promise<void> {
    try {
      const userId = (req as any).user?.userId;
      const requestBody = req.body;

      if (!userId) {
        res.status(401).json({
          error: 'User not authenticated',
          code: 'ERR_NOT_AUTHENTICATED'
        });
        return;
      }

      // Check if request contains single entry or multiple entries
      const isMultipleEntries = Array.isArray(requestBody.entries);
      const isSingleEntry = requestBody.date && typeof requestBody.workPoints === 'number';

      if (!isMultipleEntries && !isSingleEntry) {
        res.status(400).json({
          error: 'Request must contain either single entry (date, workPoints) or multiple entries array',
          code: 'ERR_INVALID_REQUEST_FORMAT'
        });
        return;
      }

      if (isMultipleEntries) {
        // Handle multiple entries (bulk sync)
        const { entries } = requestBody;

        console.log(`[WORK-POINTS-CONTROLLER] 📥 Bulk sync request received:`, {
          userId: `${userId.substring(0, 8)}...`,
          entriesCount: entries?.length || 0,
          userAgent: req.get('User-Agent')?.substring(0, 50) + '...',
          timestamp: new Date().toISOString()
        });

        if (!entries || !Array.isArray(entries) || entries.length === 0) {
          res.status(400).json({
            error: 'Entries array is required and must not be empty',
            code: 'ERR_MISSING_ENTRIES'
          });
          return;
        }

        // Generate device fingerprint for entries that don't have one
        const processedEntries = entries.map((entry: any) => ({
          ...entry,
          deviceFingerprint: entry.deviceFingerprint || this.userWorkPointsService.generateDeviceFingerprint(
            req.get('User-Agent'),
            Date.now()
          )
        }));

        // For now, just return an error for bulk operations since the method doesn't exist
        res.status(501).json({
          error: 'Bulk sync not implemented yet',
          code: 'ERR_BULK_SYNC_NOT_IMPLEMENTED'
        });
        return;
      } else {
        // Handle single entry
        const { date, workPoints, deviceFingerprint } = requestBody;

        console.log(`[WORK-POINTS-CONTROLLER] 📥 Single sync request received:`, {
          userId: `${userId.substring(0, 8)}...`,
          date,
          workPoints,
          device: deviceFingerprint ? `${deviceFingerprint.substring(0, 8)}...` : 'undefined',
          userAgent: req.get('User-Agent')?.substring(0, 50) + '...',
          timestamp: new Date().toISOString()
        });

        // Generate device fingerprint if not provided
        let finalDeviceFingerprint = deviceFingerprint;
        if (!finalDeviceFingerprint) {
          finalDeviceFingerprint = this.userWorkPointsService.generateDeviceFingerprint(
            req.get('User-Agent'),
            Date.now()
          );
          console.log(`[WORK-POINTS-CONTROLLER] 🔧 Generated device fingerprint:`, {
            userId: `${userId.substring(0, 8)}...`,
            generatedFingerprint: `${finalDeviceFingerprint.substring(0, 8)}...`
          });
        }

        const syncResult = await this.userWorkPointsService.syncWorkPoints(userId, {
          date,
          workPoints,
          deviceFingerprint: finalDeviceFingerprint
        });

        if (syncResult.success) {
          res.json(syncResult);
        } else {
          res.status(400).json(syncResult);
        }
      }
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

  /**
   * Get calendar data for a specific month showing work points and penalties
   * GET /api/users/work-points/calendar/:month
   */
  async getCalendarData(req: Request, res: Response): Promise<void> {
    try {
      const userId = (req as any).user?.userId;
      const month = req.params.month; // Expected format: YYYY-MM

      if (!userId) {
        res.status(401).json({
          error: 'User not authenticated',
          code: 'ERR_NOT_AUTHENTICATED'
        });
        return;
      }

      if (!month || !/^\d{4}-\d{2}$/.test(month)) {
        res.status(400).json({
          error: 'Month parameter is required in YYYY-MM format',
          code: 'ERR_INVALID_MONTH_FORMAT'
        });
        return;
      }

      const calendarData = await this.userWorkPointsService.getCalendarData(userId, month);
      res.json(calendarData);
    } catch (error) {
      this.handleError(error, res);
    }
  }

  /**
   * Health check endpoint for work points service
   * GET /api/users/work-points/health
   */
  async healthCheck(req: Request, res: Response): Promise<void> {
    try {
      res.json({
        service: 'UserWorkPoints',
        status: 'healthy',
        timestamp: new Date().toISOString(),
        version: '1.0.0'
      });
    } catch (error) {
      this.handleError(error, res);
    }
  }

  /**
   * Handle and convert errors to appropriate HTTP responses
   */
  private handleError(error: any, res: Response): void {
    // Log full error details server-side for debugging
    console.error('UserWorkPointsController error:', {
      message: error.message,
      stack: error.stack,
      code: error.code,
      statusCode: error.statusCode,
      timestamp: new Date().toISOString()
    });

    // Handle known DAL errors
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

    // Handle legacy custom errors
    if (error.code && error.statusCode) {
      // Sanitize error messages to remove sensitive information
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

    // Generic server error - never expose internal details
    res.status(500).json({
      error: 'Internal server error',
      code: 'ERR_INTERNAL_SERVER_ERROR'
    });
  }
}
