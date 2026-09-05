import { Request, Response } from 'express';
import { DALError } from '../types/dal.js';
import {
  ImmersiveWorldSceneService,
  IWSceneValidationError,
} from '../services/ImmersiveWorldSceneService.js';

/**
 * Immersive World Scene Controller — HTTP layer for the scene editor
 * (docs/IMMERSIVE_WORLD.md § 12 phase 1d).
 *
 * Thin by design: extract the authenticated user, delegate, map DALErrors to their
 * statusCode. The template-author gate lives in the SERVICE (phase 1e) — nothing here
 * checks a permission, exactly as `NightMarketTemplateController` does not.
 *
 * ONE ADDITION over that controller's shape: `IWSceneValidationError` carries a list of
 * per-field problems, and this is where that list becomes JSON. It is sent as `problems`
 * alongside the usual `error`/`code`, so an editor can mark up every offending field while
 * a dumb client still has a sentence to show.
 */
export class ImmersiveWorldSceneController {
  constructor(private readonly service: ImmersiveWorldSceneService) {}

  /** Pull the authenticated user id, answering 401 itself when there isn't one. */
  private userIdOr401(req: Request, res: Response): string | null {
    const userId = (req as any).user?.userId;
    if (!userId) {
      res.status(401).json({ error: 'User not authenticated', code: 'ERR_NOT_AUTHENTICATED' });
      return null;
    }
    return userId;
  }

  /** GET /api/immersiveWorld/scenes?language=zh → { scenes: IWSceneSummary[] } */
  async listScenes(req: Request, res: Response): Promise<void> {
    try {
      const userId = this.userIdOr401(req, res);
      if (!userId) return;
      const scenes = await this.service.listScenes(userId, req.query?.language);
      res.json({ scenes });
    } catch (error: any) {
      this.handleError(res, error, 'Failed to list scenes', 'ERR_IW_SCENE_LIST_FAILED');
    }
  }

  /** GET /api/immersiveWorld/npcs?language=zh → { npcs: IWNpcOption[] } — the picker source. */
  async listNpcs(req: Request, res: Response): Promise<void> {
    try {
      const userId = this.userIdOr401(req, res);
      if (!userId) return;
      const npcs = await this.service.listNpcOptions(userId, req.query?.language ?? 'zh');
      res.json({ npcs });
    } catch (error: any) {
      this.handleError(res, error, 'Failed to list NPCs', 'ERR_IW_NPC_LIST_FAILED');
    }
  }

  /** GET /api/immersiveWorld/scenes/nameAvailable?language=zh&name=...&exceptId=... → { available } */
  async checkNameAvailable(req: Request, res: Response): Promise<void> {
    try {
      const userId = this.userIdOr401(req, res);
      if (!userId) return;
      const available = await this.service.isNameAvailable(
        userId,
        req.query?.language ?? 'zh',
        req.query?.name ?? '',
        (req.query?.exceptId as string) || undefined,
      );
      res.json({ available });
    } catch (error: any) {
      this.handleError(res, error, 'Failed to check scene name', 'ERR_IW_SCENE_NAME_CHECK_FAILED');
    }
  }

  /** GET /api/immersiveWorld/scenes/:id → { scene } | 404 */
  async getScene(req: Request, res: Response): Promise<void> {
    try {
      const userId = this.userIdOr401(req, res);
      if (!userId) return;
      const scene = await this.service.getScene(userId, req.params.id);
      res.json({ scene });
    } catch (error: any) {
      this.handleError(res, error, 'Failed to load scene', 'ERR_IW_SCENE_LOAD_FAILED');
    }
  }

  /**
   * POST /api/immersiveWorld/scenes  { scene: IWScene } → { scene }
   * Create when `scene.id` is absent, overwrite when present.
   */
  async saveScene(req: Request, res: Response): Promise<void> {
    try {
      const userId = this.userIdOr401(req, res);
      if (!userId) return;
      const scene = await this.service.saveScene(userId, req.body?.scene);
      res.json({ scene });
    } catch (error: any) {
      this.handleError(res, error, 'Failed to save scene', 'ERR_IW_SCENE_SAVE_FAILED');
    }
  }

  /** DELETE /api/immersiveWorld/scenes/:id → { deleted: boolean } */
  async deleteScene(req: Request, res: Response): Promise<void> {
    try {
      const userId = this.userIdOr401(req, res);
      if (!userId) return;
      const deleted = await this.service.deleteScene(userId, req.params.id);
      res.json({ deleted });
    } catch (error: any) {
      this.handleError(res, error, 'Failed to delete scene', 'ERR_IW_SCENE_DELETE_FAILED');
    }
  }

  private handleError(res: Response, error: any, fallbackMsg: string, fallbackCode: string): void {
    console.error(`[IW-SCENE-CONTROLLER] ❌ ${fallbackMsg}:`, error);
    if (error instanceof IWSceneValidationError) {
      res.status(error.statusCode).json({
        error: error.message,
        code: error.code,
        problems: error.problems,
      });
      return;
    }
    if (error instanceof DALError) {
      res.status(error.statusCode || 500).json({ error: error.message, code: error.code });
      return;
    }
    res.status(500).json({ error: fallbackMsg, code: fallbackCode });
  }
}
