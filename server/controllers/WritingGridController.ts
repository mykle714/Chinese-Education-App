import { Request, Response } from 'express';
import { requireUserId, handleControllerError } from '../utils/controllerUtils.js';
import type { WritingGridService } from '../services/WritingGridService.js';

/**
 * GET /api/writingGrid/deal → { characters: WritingGridCharacter[] }
 * The Writing Grid game's board (docs/WRITING_PRACTICE_REWORK.md § 2). zh only, so no
 * language parameter.
 */
export class WritingGridController {
  constructor(private writingGridService: WritingGridService) {}

  async deal(req: Request, res: Response): Promise<void> {
    try {
      const userId = requireUserId(req, res);
      if (!userId) return;
      const characters = await this.writingGridService.deal(userId);
      res.json({ characters });
    } catch (error) {
      handleControllerError(error, res, 'WritingGridController.deal');
    }
  }
}
