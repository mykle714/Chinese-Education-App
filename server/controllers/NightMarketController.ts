import { Request, Response } from 'express';
import { NightMarketService } from '../services/NightMarketService.js';
import { requireUserId, handleControllerError } from '../utils/controllerUtils.js';

/**
 * Night Market Controller - Handles HTTP requests for night market unlock operations
 */
export class NightMarketController {
  constructor(private nightMarketService: NightMarketService) {}

  /**
   * Get all unlocked items for the authenticated user.
   * Seeds the base set on the user's first visit.
   * GET /api/night-market/unlocks
   */
  async getUnlocks(req: Request, res: Response): Promise<void> {
    try {
      const userId = requireUserId(req, res);
      if (!userId) return;

      const result = await this.nightMarketService.getUnlocks(userId);
      res.json(result);
    } catch (error) {
      handleControllerError(error, res, 'NightMarketController.getUnlocks');
    }
  }

  /**
   * Unlock the next random item.
   * Returns 400 if insufficient work points or pool is exhausted.
   * POST /api/night-market/unlock
   */
  async unlockNext(req: Request, res: Response): Promise<void> {
    try {
      const userId = requireUserId(req, res);
      if (!userId) return;

      const result = await this.nightMarketService.unlockNext(userId);
      res.status(201).json(result);
    } catch (error) {
      handleControllerError(error, res, 'NightMarketController.unlockNext');
    }
  }
}
