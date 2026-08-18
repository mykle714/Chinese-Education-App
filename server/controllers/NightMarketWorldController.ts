import { Request, Response } from 'express';
import { NightMarketWorldService } from '../services/NightMarketWorldService.js';
import { requireUserId, getUserLanguage, handleControllerError } from '../utils/controllerUtils.js';
import { resolveLanguage } from '../utils/languageParam.js';

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
   * Return a rendered template layout. GET /api/nightMarket/layout[?userId=&language=]
   *
   * TWO MODES, and the difference is a WRITE:
   *  * No `?userId=` — the caller's own market. Seeds the origin hub on first load
   *    (safety net inside the service).
   *  * `?userId=<other>` — a VISIT (docs/USER_PROFILE_PAGE.md § Night market visit).
   *    Read-only: seeding is suppressed, so viewing a market that does not exist yet
   *    returns an empty layout rather than creating one in someone else's account.
   *
   * The visited user's own language is used, not the caller's — each language grows its
   * own continent (migration 130), and rendering a visitor's language would show an
   * empty continent for a market that is in fact well built.
   */
  async getLayout(req: Request, res: Response): Promise<void> {
    try {
      const userId = requireUserId(req, res);
      if (!userId) return;

      const visitedUserId =
        typeof req.query.userId === 'string' && req.query.userId.trim()
          ? req.query.userId.trim()
          : null;
      const isVisit = !!visitedUserId && visitedUserId.toLowerCase() !== userId.toLowerCase();

      if (isVisit) {
        // The visited account's OWN language decides which continent is rendered, so
        // it is resolved from their account and never from the query string.
        const language = await getUserLanguage(visitedUserId!);
        const result = await this.worldService.getUserLayout(visitedUserId!, language, {
          seedIfEmpty: false,
        });
        res.json(result);
        return;
      }

      // Each language grows its own market (migration 130), so the layout read is scoped to the
      // language the client is studying; ?language= defaults to 'zh' for older clients.
      const language = resolveLanguage(req.query.language);
      const result = await this.worldService.getUserLayout(userId, language);
      res.json(result);
    } catch (error) {
      handleControllerError(error, res, 'NightMarketWorldController.getLayout');
    }
  }
}
