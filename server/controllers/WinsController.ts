import { Request, Response } from 'express';
import { IWinsDAL } from '../dal/interfaces/IWinsDAL.js';
import { requireUserId, handleControllerError } from '../utils/controllerUtils.js';
import { WinsResponse } from '../types/wins.js';

/**
 * Game-win HTTP layer.
 *
 * GET  /api/users/me/wins              → this week's earned (game, level) badges
 *                                         + lifetime win counts
 * POST /api/users/me/wins { game, level }
 *                                       → append one win to the log
 *
 * Generic on purpose: `game`/`level` are opaque keys (e.g. 'bubbleMatch' / '1'),
 * so every game logs and reads wins through this one endpoint. Thin enough to
 * take the DAL directly with no service layer (mirrors Icons8Controller /
 * the former WeekliesController).
 */
export class WinsController {
  constructor(private winsDAL: IWinsDAL) {}

  /** GET /api/users/me/wins */
  async listWins(req: Request, res: Response): Promise<void> {
    try {
      const userId = requireUserId(req, res);
      if (!userId) return;

      const [weekly, lifetimeAgg] = await Promise.all([
        this.winsDAL.getWeeklyWins(userId),
        this.winsDAL.getLifetimeCounts(userId),
      ]);

      // Fold the flat lifetime aggregate rows into a nested { game: { level: count } }.
      const lifetime: Record<string, Record<string, number>> = {};
      for (const agg of lifetimeAgg) {
        (lifetime[agg.game] ??= {})[agg.level] = agg.winCount;
      }

      const response: WinsResponse = { weekly, lifetime };
      res.json(response);
    } catch (error) {
      handleControllerError(error, res, 'WinsController.listWins');
    }
  }

  /** POST /api/users/me/wins  body: { game: string, level: string | number } */
  async recordWin(req: Request, res: Response): Promise<void> {
    try {
      const userId = requireUserId(req, res);
      if (!userId) return;

      const { game, level } = req.body ?? {};
      if (typeof game !== 'string' || game.trim().length === 0) {
        res.status(400).json({ error: 'game is required', code: 'ERR_INVALID_INPUT' });
        return;
      }
      // level is coerced to a string so numeric ('1') and named levels share one
      // shape; reject only genuinely empty input.
      if (level === undefined || level === null || String(level).trim().length === 0) {
        res.status(400).json({ error: 'level is required', code: 'ERR_INVALID_INPUT' });
        return;
      }

      const win = await this.winsDAL.recordWin(userId, game.trim(), String(level).trim());
      res.status(201).json({ win });
    } catch (error) {
      handleControllerError(error, res, 'WinsController.recordWin');
    }
  }
}
