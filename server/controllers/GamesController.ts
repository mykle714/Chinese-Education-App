import { Request, Response } from 'express';
import { GameAssetService } from '../services/GameAssetService.js';
import { GameProgressService } from '../services/GameProgressService.js';
import { requireUserId, handleControllerError } from '../utils/controllerUtils.js';
import { GameAssetsResponse, GameProgressResponse } from '../types/games.js';

/**
 * Games framework HTTP layer.
 * One controller serves all games — each request is scoped by the :gameId path param.
 */
export class GamesController {
  constructor(
    private gameAssetService: GameAssetService,
    private gameProgressService: GameProgressService
  ) {}

  /**
   * List assets registered for a given game.
   * GET /api/games/:gameId/assets
   */
  async getAssets(req: Request, res: Response): Promise<void> {
    try {
      const userId = requireUserId(req, res);
      if (!userId) return;

      const { gameId } = req.params;
      const assets = await this.gameAssetService.listForGame(gameId);

      const response: GameAssetsResponse = { gameId, assets };
      res.json(response);
    } catch (error) {
      handleControllerError(error, res, 'GamesController.getAssets');
    }
  }

  /**
   * Fetch the user's save state for a game; returns progress=null if not yet saved.
   * GET /api/games/:gameId/progress
   */
  async getProgress(req: Request, res: Response): Promise<void> {
    try {
      const userId = requireUserId(req, res);
      if (!userId) return;

      const { gameId } = req.params;
      const progress = await this.gameProgressService.get(userId, gameId);

      const response: GameProgressResponse = { gameId, progress };
      res.json(response);
    } catch (error) {
      handleControllerError(error, res, 'GamesController.getProgress');
    }
  }

  /**
   * Upsert the user's save state for a game.
   * Body: { state: <game-defined json object> }
   * POST /api/games/:gameId/progress
   */
  async saveProgress(req: Request, res: Response): Promise<void> {
    try {
      const userId = requireUserId(req, res);
      if (!userId) return;

      const { gameId } = req.params;
      const { state } = req.body ?? {};

      const progress = await this.gameProgressService.save(userId, gameId, state);
      res.status(201).json({ gameId, progress });
    } catch (error) {
      handleControllerError(error, res, 'GamesController.saveProgress');
    }
  }
}
