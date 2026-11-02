import { Request, Response } from 'express';
import { handleControllerError, requireUserId } from '../utils/controllerUtils.js';
import type { FocusModeService } from '../services/FocusModeService.js';
import type { SuperpositionService } from '../services/SuperpositionService.js';
import { parseWritingDealOptions } from './WritingGridController.js';

/**
 * GET /api/superposition/deal → { words: SuperpositionWord[] }
 * A Superposition board (docs/SUPERPOSITION_GAME.md). zh only, so no language parameter.
 * Takes the same break additions as the Writing Grid's deal (`parseWritingDealOptions`).
 */
export class SuperpositionController {
  constructor(
    private superpositionService: SuperpositionService,
    private focusModeService: FocusModeService
  ) {}

  async deal(req: Request, res: Response): Promise<void> {
    try {
      const userId = requireUserId(req, res);
      if (!userId) return;
      const options = await parseWritingDealOptions(req, res, userId, this.focusModeService);
      const words = await this.superpositionService.deal(userId, options);
      res.json({ words });
    } catch (error) {
      handleControllerError(error, res, 'SuperpositionController.deal');
    }
  }
}
