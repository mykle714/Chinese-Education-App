import { Request, Response } from 'express';
import { DALError } from '../types/dal.js';
import { NightMarketSandboxService } from '../services/NightMarketSandboxService.js';

/**
 * Night Market template SANDBOX controller — HTTP layer for the desktop-only Template Sandbox
 * tool (docs/NIGHT_MARKET_TEMPLATE_SANDBOX.md). Thin: extracts the authenticated user, delegates
 * to NightMarketSandboxService, and maps DALErrors to their statusCode (403 non-author, 400
 * validation, 404 not found). Every operation is template-author-gated in the service.
 */
export class NightMarketSandboxController {
  constructor(private readonly service: NightMarketSandboxService) {}

  /** GET /api/nightmarket-sandbox → { placements: TemplateSandboxRow[] } */
  async listPlacements(req: Request, res: Response): Promise<void> {
    try {
      const userId = (req as any).user?.userId;
      if (!userId) {
        res.status(401).json({ error: 'User not authenticated', code: 'ERR_NOT_AUTHENTICATED' });
        return;
      }
      const placements = await this.service.listPlacements(userId);
      res.json({ placements });
    } catch (error: any) {
      this.handleError(res, error, 'Failed to list sandbox placements', 'ERR_SANDBOX_LIST_FAILED');
    }
  }

  /** POST /api/nightmarket-sandbox { templateName, activeVersion, offsetCol, offsetRow } → { placement } */
  async addPlacement(req: Request, res: Response): Promise<void> {
    try {
      const userId = (req as any).user?.userId;
      if (!userId) {
        res.status(401).json({ error: 'User not authenticated', code: 'ERR_NOT_AUTHENTICATED' });
        return;
      }
      const { templateName, activeVersion, offsetCol, offsetRow } = req.body ?? {};
      const placement = await this.service.addPlacement(userId, { templateName, activeVersion, offsetCol, offsetRow });
      res.status(201).json({ placement });
    } catch (error: any) {
      this.handleError(res, error, 'Failed to add sandbox placement', 'ERR_SANDBOX_ADD_FAILED');
    }
  }

  /** PATCH /api/nightmarket-sandbox/:id/position { offsetCol, offsetRow } → { placement } */
  async movePlacement(req: Request, res: Response): Promise<void> {
    try {
      const userId = (req as any).user?.userId;
      if (!userId) {
        res.status(401).json({ error: 'User not authenticated', code: 'ERR_NOT_AUTHENTICATED' });
        return;
      }
      const { offsetCol, offsetRow } = req.body ?? {};
      const placement = await this.service.movePlacement(userId, req.params.id, { offsetCol, offsetRow });
      res.json({ placement });
    } catch (error: any) {
      this.handleError(res, error, 'Failed to move sandbox placement', 'ERR_SANDBOX_MOVE_FAILED');
    }
  }

  /** PATCH /api/nightmarket-sandbox/:id/version { activeVersion } → { placement } */
  async setPlacementVersion(req: Request, res: Response): Promise<void> {
    try {
      const userId = (req as any).user?.userId;
      if (!userId) {
        res.status(401).json({ error: 'User not authenticated', code: 'ERR_NOT_AUTHENTICATED' });
        return;
      }
      const { activeVersion } = req.body ?? {};
      const placement = await this.service.setPlacementVersion(userId, req.params.id, activeVersion);
      res.json({ placement });
    } catch (error: any) {
      this.handleError(res, error, 'Failed to set sandbox placement version', 'ERR_SANDBOX_VERSION_FAILED');
    }
  }

  /** PATCH /api/nightmarket-sandbox/:id/lock { locked } → { placement } */
  async setPlacementLock(req: Request, res: Response): Promise<void> {
    try {
      const userId = (req as any).user?.userId;
      if (!userId) {
        res.status(401).json({ error: 'User not authenticated', code: 'ERR_NOT_AUTHENTICATED' });
        return;
      }
      const { locked } = req.body ?? {};
      const placement = await this.service.setPlacementLock(userId, req.params.id, locked);
      res.json({ placement });
    } catch (error: any) {
      this.handleError(res, error, 'Failed to set sandbox placement lock', 'ERR_SANDBOX_LOCK_FAILED');
    }
  }

  /** PATCH /api/nightmarket-sandbox/:id/settings { settings: {...} } → { placement } (merge patch) */
  async setPlacementSettings(req: Request, res: Response): Promise<void> {
    try {
      const userId = (req as any).user?.userId;
      if (!userId) {
        res.status(401).json({ error: 'User not authenticated', code: 'ERR_NOT_AUTHENTICATED' });
        return;
      }
      const { settings } = req.body ?? {};
      const placement = await this.service.setPlacementSettings(userId, req.params.id, settings);
      res.json({ placement });
    } catch (error: any) {
      this.handleError(res, error, 'Failed to set sandbox placement settings', 'ERR_SANDBOX_SETTINGS_FAILED');
    }
  }

  /** DELETE /api/nightmarket-sandbox/:id → { deleted: true } */
  async removePlacement(req: Request, res: Response): Promise<void> {
    try {
      const userId = (req as any).user?.userId;
      if (!userId) {
        res.status(401).json({ error: 'User not authenticated', code: 'ERR_NOT_AUTHENTICATED' });
        return;
      }
      await this.service.removePlacement(userId, req.params.id);
      res.json({ deleted: true });
    } catch (error: any) {
      this.handleError(res, error, 'Failed to delete sandbox placement', 'ERR_SANDBOX_DELETE_FAILED');
    }
  }

  /**
   * POST /api/nightmarket-sandbox/iterate → { placement, trace } | { placement: null, trace }
   * Steps the live growth algorithm once over the author's sandbox layout. A null placement is a
   * successful "nothing legal fits anywhere" answer, not an error — the client reports it.
   *
   * `trace` is the planner's decision log as pre-formatted console lines (see
   * NightMarketPlacementService.formatSpawnTrace). It is returned on BOTH outcomes — the failing
   * case is precisely when an author needs it — and the client prints it to the devtools console.
   * Author-only surface (the route is behind `assertTemplateAuthor`), so the internal geometry it
   * exposes is not player-visible.
   */
  async iteratePlacement(req: Request, res: Response): Promise<void> {
    try {
      const userId = (req as any).user?.userId;
      if (!userId) {
        res.status(401).json({ error: 'User not authenticated', code: 'ERR_NOT_AUTHENTICATED' });
        return;
      }
      const { placement, trace } = await this.service.iteratePlacement(userId);
      res.json({ placement, trace });
    } catch (error: any) {
      this.handleError(res, error, 'Failed to iterate sandbox placement', 'ERR_SANDBOX_ITERATE_FAILED');
    }
  }

  /** DELETE /api/nightmarket-sandbox → { deleted: <count> } — clears the caller's whole sandbox. */
  async clearPlacements(req: Request, res: Response): Promise<void> {
    try {
      const userId = (req as any).user?.userId;
      if (!userId) {
        res.status(401).json({ error: 'User not authenticated', code: 'ERR_NOT_AUTHENTICATED' });
        return;
      }
      const deleted = await this.service.clearPlacements(userId);
      res.json({ deleted });
    } catch (error: any) {
      this.handleError(res, error, 'Failed to clear sandbox', 'ERR_SANDBOX_CLEAR_FAILED');
    }
  }

  /** Map a DALError to its own statusCode/code; otherwise a 500 fallback. */
  private handleError(res: Response, error: any, fallbackMsg: string, fallbackCode: string): void {
    console.error(`[NM-SANDBOX-CONTROLLER] ❌ ${fallbackMsg}:`, error);
    if (error instanceof DALError) {
      res.status(error.statusCode || 500).json({ error: error.message, code: error.code });
    } else {
      res.status(500).json({ error: fallbackMsg, code: fallbackCode });
    }
  }
}
