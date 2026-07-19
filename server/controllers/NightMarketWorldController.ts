import { Request, Response } from 'express';
import { NightMarketWorldService } from '../services/NightMarketWorldService.js';
import { requireUserId, handleControllerError } from '../utils/controllerUtils.js';

/**
 * Night Market World Controller — the runtime LAYOUT read endpoint.
 *
 * LAYER: controller. Thin HTTP adapter over {@link NightMarketWorldService}. Not validator-gated:
 * the layout is a per-user read every authenticated user performs to render their market (guarded
 * by authenticateToken at the route). Distinct from NightMarketController (retired asset-unlock
 * economy) and NightMarketTemplateController (validator-authored catalog).
 */
export class NightMarketWorldController {
  constructor(private worldService: NightMarketWorldService) {}

  /**
   * Return the authenticated user's rendered template layout. Seeds the origin hub on first
   * load if the user has none (safety net inside the service). GET /api/night-market/layout
   */
  async getLayout(req: Request, res: Response): Promise<void> {
    try {
      const userId = requireUserId(req, res);
      if (!userId) return;

      const result = await this.worldService.getUserLayout(userId);
      res.json(result);
    } catch (error) {
      handleControllerError(error, res, 'NightMarketWorldController.getLayout');
    }
  }
}
