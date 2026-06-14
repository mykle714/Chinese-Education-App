import { Request, Response } from 'express';
import { IWeekliesDAL } from '../dal/interfaces/IWeekliesDAL.js';
import { requireUserId, handleControllerError } from '../utils/controllerUtils.js';
import { WeekliesResponse } from '../types/weeklies.js';

/**
 * Weekly-achievement HTTP layer.
 *
 * GET  /api/users/me/weeklies          → list the user's achievements this week
 * POST /api/users/me/weeklies { key, value }
 *      → value truthy: record/stamp the `key` achievement
 *      → value === false: clear the `key` achievement
 *
 * Generic on purpose: `key` is an opaque activity string (e.g. 'bubbleMatch'),
 * so all weekly achievements flow through this one endpoint. Thin enough to take
 * the DAL directly with no service layer (mirrors Icons8Controller).
 */
export class WeekliesController {
  constructor(private weekliesDAL: IWeekliesDAL) {}

  /** GET /api/users/me/weeklies */
  async listWeeklies(req: Request, res: Response): Promise<void> {
    try {
      const userId = requireUserId(req, res);
      if (!userId) return;

      const weeklies = await this.weekliesDAL.listByUser(userId);
      const response: WeekliesResponse = { weeklies };
      res.json(response);
    } catch (error) {
      handleControllerError(error, res, 'WeekliesController.listWeeklies');
    }
  }

  /** POST /api/users/me/weeklies  body: { key: string, value?: boolean } */
  async setWeekly(req: Request, res: Response): Promise<void> {
    try {
      const userId = requireUserId(req, res);
      if (!userId) return;

      const { key, value } = req.body ?? {};
      if (typeof key !== 'string' || key.trim().length === 0) {
        res.status(400).json({ error: 'key is required', code: 'ERR_INVALID_INPUT' });
        return;
      }
      const activity = key.trim();

      // value defaults to true (the common "record this achievement" call);
      // an explicit false clears it.
      if (value === false) {
        await this.weekliesDAL.remove(userId, activity);
        res.status(200).json({ activity, recorded: false });
        return;
      }

      const weekly = await this.weekliesDAL.record(userId, activity);
      res.status(201).json({ activity, recorded: true, weekly });
    } catch (error) {
      handleControllerError(error, res, 'WeekliesController.setWeekly');
    }
  }
}
