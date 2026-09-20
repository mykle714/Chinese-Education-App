import { Request, Response } from 'express';
import { GameAssetService } from '../services/GameAssetService.js';
import { GameProgressService } from '../services/GameProgressService.js';
import { requireUserId, handleControllerError } from '../utils/controllerUtils.js';
import { GameAssetsResponse, GameProgressResponse } from '../types/games.js';
import { isKnownGameId } from '../constants.js';
import { isGameEnabled } from '../contracts/featureFlags.js';

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
      // Per-game flag (GAME_FLAGS, server/contracts/featureFlags.ts). Gated on the
      // reads too, not just the write below: otherwise a disabled game's asset list
      // and save state stay probeable by anyone with the URL, which discloses
      // unshipped work. Note these two reads carry no `isKnownGameId` check at all —
      // they are harmless for an unknown slug (empty list / null), unlike the write.
      if (!isGameEnabled(gameId)) {
        res.status(404).json({ error: 'Unknown game', code: 'ERR_UNKNOWN_GAME' });
        return;
      }
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
      // Per-game flag — see the note in getAssets.
      if (!isGameEnabled(gameId)) {
        res.status(404).json({ error: 'Unknown game', code: 'ERR_UNKNOWN_GAME' });
        return;
      }
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

      // Whitelisted, not passed through: `gameId` is a raw path segment keying a
      // (userId, gameId) upsert, so an unrecognised slug writes a save row for a
      // game that does not exist — unbounded rows per account for the cost of a
      // loop. See KNOWN_GAME_IDS.
      if (!isKnownGameId(gameId)) {
        res.status(404).json({ error: 'Unknown game', code: 'ERR_UNKNOWN_GAME' });
        return;
      }

      // Per-game flag (GAME_FLAGS, server/contracts/featureFlags.ts). Hiding the hub
      // tile is not a gate on its own — a bookmarked game page would still POST save
      // state for a game that is switched off, which is the same unbounded-rows
      // problem the whitelist above exists to prevent. Reported as 404 rather than
      // 403: to a client, a disabled game is indistinguishable from one that does not
      // exist, and saying "this exists but is turned off" discloses unshipped work.
      if (!isGameEnabled(gameId)) {
        res.status(404).json({ error: 'Unknown game', code: 'ERR_UNKNOWN_GAME' });
        return;
      }

      const progress = await this.gameProgressService.save(userId, gameId, state);
      res.status(201).json({ gameId, progress });
    } catch (error) {
      handleControllerError(error, res, 'GamesController.saveProgress');
    }
  }
}
