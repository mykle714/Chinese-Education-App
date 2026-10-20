import { Request, Response } from 'express';
import { FocusModeService } from '../services/FocusModeService.js';
import { requireUserId, getUserLanguage, handleControllerError } from '../utils/controllerUtils.js';
import { parseMasteryWorld, type MasteryWorldId } from '../contracts/wire.js';
import { ValidationError } from '../types/dal.js';

/**
 * Focus mode HTTP layer — /api/focus/* (docs/FOCUS_MODE.md § 6).
 *
 * LAYER: controller. Parses request shape and delegates every rule to FocusModeService.
 * The language is the ACCOUNT's selected one, never a request field: focus is per
 * (user, language), and the client must not flip the other language's switch.
 */
export class FocusModeController {
  constructor(private focusModeService: FocusModeService) {}

  /**
   * GET /api/focus → FocusStatusResponse
   * Takes today's snapshot for any focused world that has none yet.
   */
  getStatus = async (req: Request, res: Response): Promise<void> => {
    try {
      const userId = requireUserId(req, res);
      if (!userId) return;
      const language = await getUserLanguage(userId);
      res.json(await this.focusModeService.getStatus(userId, language));
    } catch (error: any) {
      handleControllerError(error, res, 'FocusModeController.getStatus');
    }
  };

  /**
   * POST /api/focus  { world, on } → FocusStatusResponse
   * The Deck Tower lever, after the learner confirms the popup.
   */
  setFocus = async (req: Request, res: Response): Promise<void> => {
    try {
      const userId = requireUserId(req, res);
      if (!userId) return;
      const world = parseMasteryWorld(typeof req.body?.world === 'string' ? req.body.world : undefined);
      if (!world) throw new ValidationError('world must be core, reading or writing');
      if (typeof req.body?.on !== 'boolean') throw new ValidationError('on must be a boolean');
      const language = await getUserLanguage(userId);
      res.json(await this.focusModeService.setFocus(userId, language, world, req.body.on));
    } catch (error: any) {
      handleControllerError(error, res, 'FocusModeController.setFocus');
    }
  };

  /**
   * POST /api/focus/notices/ack  { worlds: string[] } → 204
   * The client showed these worlds' "focus mode turned off" popups.
   */
  acknowledgeNotices = async (req: Request, res: Response): Promise<void> => {
    try {
      const userId = requireUserId(req, res);
      if (!userId) return;
      const raw: unknown[] = Array.isArray(req.body?.worlds) ? req.body.worlds : [];
      const worlds = raw
        .map((value) => parseMasteryWorld(typeof value === 'string' ? value : undefined))
        .filter((world): world is MasteryWorldId => world !== null);
      const language = await getUserLanguage(userId);
      await this.focusModeService.acknowledgeNotices(userId, language, worlds);
      res.status(204).end();
    } catch (error: any) {
      handleControllerError(error, res, 'FocusModeController.acknowledgeNotices');
    }
  };
}
