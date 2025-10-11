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
   * Sync work points for a user (supports single or multiple dates)
   * POST /api/users/work-points/sync
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

        const syncResult = await this.userWorkPointsService.bulkSyncWorkPoints(userId, { 
          entries: processedEntries 
        });

        if (syncResult.success) {
          res.json(syncResult);
        } else {
          res.status(400).json(syncResult);
        }
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
   * Bulk sync work points for multiple days
   * POST /api/users/work-points/bulk-sync
   */
  async bulkSyncWorkPoints(req: Request, res: Response): Promise<void> {
    try {
      const userId = (req as any).user?.userId;
      const { entries } = req.body;

      if (!userId) {
        res.status(401).json({
          error: 'User not authenticated',
          code: 'ERR_NOT_AUTHENTICATED'
        });
        return;
      }

      console.log(`[WORK-POINTS-CONTROLLER] 📥 Bulk sync request received:`, {
        userId: `${userId.substring(0, 8)}...`,
        entriesCount: entries?.length || 0,
        timestamp: new Date().toISOString()
      });

      if (!entries || !Array.isArray(entries)) {
        res.status(400).json({
          error: 'Entries array is required',
          code: 'ERR_MISSING_ENTRIES'
        });
        return;
      }

      const syncResult = await this.userWorkPointsService.bulkSyncWorkPoints(userId, { entries });

      if (syncResult.success) {
        res.json(syncResult);
      } else {
        res.status(400).json(syncResult);
      }
    } catch (error) {
      this.handleError(error, res);
    }
  }

  /**
   * Get user work points statistics
   * GET /api/users/work-points/stats
   */
  async getUserStats(req: Request, res: Response): Promise<void> {
    try {
      const userId = (req as any).user?.userId;

      if (!userId) {
        res.status(401).json({
          error: 'User not authenticated',
          code: 'ERR_NOT_AUTHENTICATED'
        });
        return;
      }

      const stats = await this.userWorkPointsService.getUserWorkPointsStats(userId);
      res.json(stats);
    } catch (error) {
      this.handleError(error, res);
    }
  }

  /**
   * Get user work points analytics for date range
   * GET /api/users/work-points/analytics
   */
  async getUserAnalytics(req: Request, res: Response): Promise<void> {
    try {
      const userId = (req as any).user?.userId;
      const startDate = req.query.startDate as string;
      const endDate = req.query.endDate as string;

      if (!userId) {
        res.status(401).json({
          error: 'User not authenticated',
          code: 'ERR_NOT_AUTHENTICATED'
        });
        return;
      }

      if (!startDate || !endDate) {
        res.status(400).json({
          error: 'Start date and end date are required',
          code: 'ERR_MISSING_DATE_RANGE'
        });
        return;
      }

      const analytics = await this.userWorkPointsService.getUserAnalytics(userId, startDate, endDate);
      res.json(analytics);
    } catch (error) {
      this.handleError(error, res);
    }
  }

  /**
   * Get user device summary
   * GET /api/users/work-points/devices
   */
  async getUserDeviceSummary(req: Request, res: Response): Promise<void> {
    try {
      const userId = (req as any).user?.userId;

      if (!userId) {
        res.status(401).json({
          error: 'User not authenticated',
          code: 'ERR_NOT_AUTHENTICATED'
        });
        return;
      }

      const devices = await this.userWorkPointsService.getUserDeviceSummary(userId);
      res.json(devices);
    } catch (error) {
      this.handleError(error, res);
    }
  }

  /**
   * Get recent work points activity
   * GET /api/users/work-points/recent
   */
  async getRecentActivity(req: Request, res: Response): Promise<void> {
    try {
      const userId = (req as any).user?.userId;
      const days = parseInt(req.query.days as string) || 30;

      if (!userId) {
        res.status(401).json({
          error: 'User not authenticated',
          code: 'ERR_NOT_AUTHENTICATED'
        });
        return;
      }

      const recentActivity = await this.userWorkPointsService.getRecentActivity(userId, days);
      res.json(recentActivity);
    } catch (error) {
      this.handleError(error, res);
    }
  }

  /**
   * Get work points for specific date range
   * GET /api/users/work-points/range
   */
  async getWorkPointsInRange(req: Request, res: Response): Promise<void> {
    try {
      const userId = (req as any).user?.userId;
      const startDate = req.query.startDate as string;
      const endDate = req.query.endDate as string;
      const limit = parseInt(req.query.limit as string) || 100;
      const offset = parseInt(req.query.offset as string) || 0;

      if (!userId) {
        res.status(401).json({
          error: 'User not authenticated',
          code: 'ERR_NOT_AUTHENTICATED'
        });
        return;
      }

      if (!startDate || !endDate) {
        res.status(400).json({
          error: 'Start date and end date are required',
          code: 'ERR_MISSING_DATE_RANGE'
        });
        return;
      }

      const workPoints = await this.userWorkPointsService.getUserWorkPointsInRange(
        userId,
        startDate,
        endDate,
        limit,
        offset
      );

      res.json(workPoints);
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
