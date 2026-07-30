import { Request, Response } from 'express';
import { NightMarketWorldService } from '../services/NightMarketWorldService.js';
import { requireUserId, handleControllerError } from '../utils/controllerUtils.js';
import { resolveLanguage } from '../utils/language.js';

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
   * Return the authenticated user's rendered template layout FOR ONE LANGUAGE. Seeds that
   * language's origin hub on first load if it has none (safety net inside the service).
   * GET /api/nightMarket/layout?language=<lang>
   *
   * Each (user, language) is an independent market (migration 136), so the language selects
   * which market is returned; an unsupported/absent param falls back to 'zh', matching the
   * market every pre-migration placement was backfilled into.
   */
  async getLayout(req: Request, res: Response): Promise<void> {
    try {
      const userId = requireUserId(req, res);
      if (!userId) return;

      const language = resolveLanguage(req.query.language);
      const result = await this.worldService.getUserLayout(userId, language);
      res.json(result);
    } catch (error) {
      handleControllerError(error, res, 'NightMarketWorldController.getLayout');
    }
  }
}
