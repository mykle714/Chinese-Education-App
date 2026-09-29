import { Request, Response } from 'express';
import { UsageDashboardService } from '../services/UsageDashboardService.js';
import { requireUserId, handleControllerError } from '../utils/controllerUtils.js';
import { DEFAULT_USAGE_WINDOW } from '../contracts/usage.js';

/**
 * UsageDashboardController — HTTP adapter for the User Usage dashboard
 * (docs/USAGE_DASHBOARD.md).
 *
 * LAYER: controller. Parses `?days=`, delegates; the isAdmin gate lives in the
 * service (a non-admin gets 403 via ForbiddenError → handleControllerError).
 */
export class UsageDashboardController {
  constructor(private usageDashboardService: UsageDashboardService) {}

  /** GET /api/admin/usage?days=7|30|90|0 (0 = all time; omitted = 30). */
  async getUsage(req: Request, res: Response): Promise<void> {
    try {
      const userId = requireUserId(req, res);
      if (!userId) return;
      const windowDays = UsageDashboardService.parseWindow(req.query.days) ?? DEFAULT_USAGE_WINDOW;
      res.json(await this.usageDashboardService.getDashboard(userId, windowDays));
    } catch (error) {
      handleControllerError(error, res, 'UsageDashboardController.getUsage');
    }
  }
}
