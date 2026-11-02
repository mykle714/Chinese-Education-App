import { Request, Response } from 'express';
import { MAX_SEED_IDS, parseIdCsv, requireUserId, handleControllerError } from '../utils/controllerUtils.js';
import { FOCUS_ENDED_HEADER } from '../contracts/focusMode.js';
import type { FocusModeService } from '../services/FocusModeService.js';
import type { WritingGridDealOptions, WritingGridService } from '../services/WritingGridService.js';

/**
 * The break additions to a writing game's deal: `?seedIds=` and `?flpBreak=1`, the latter
 * resolving the writing world's focus state. Shared with SuperpositionController.
 */
export async function parseWritingDealOptions(
  req: Request,
  res: Response,
  userId: string,
  focusModeService: FocusModeService
): Promise<WritingGridDealOptions> {
  const options: WritingGridDealOptions = {
    seedIds: parseIdCsv(req.query.seedIds).slice(0, MAX_SEED_IDS),
  };
  if (String(req.query.flpBreak ?? '') === '1') {
    const focus = await focusModeService.resolveWorld(userId, 'zh', 'writing');
    if (focus.active) options.focusBreak = { setIds: focus.setIds, remainingIds: focus.ids };
    else if ('ended' in focus && focus.ended) res.setHeader(FOCUS_ENDED_HEADER, 'writing');
  }
  return options;
}

/**
 * GET /api/writingGrid/deal → { characters: WritingGridCharacter[] }
 * The Writing Grid game's board (docs/WRITING_PRACTICE_REWORK.md § 2). zh only, so no
 * language parameter.
 *
 * An flp game break adds `?seedIds=` (its working loop) and, on an unrestricted session,
 * `?flpBreak=1` (docs/FLP_GAME_BREAKS.md § 4). The game's own route sends neither, and
 * stays outside focus mode (docs/FOCUS_MODE.md § 4).
 */
export class WritingGridController {
  constructor(
    private writingGridService: WritingGridService,
    private focusModeService: FocusModeService
  ) {}

  async deal(req: Request, res: Response): Promise<void> {
    try {
      const userId = requireUserId(req, res);
      if (!userId) return;
      const options = await parseWritingDealOptions(req, res, userId, this.focusModeService);
      const characters = await this.writingGridService.deal(userId, options);
      res.json({ characters });
    } catch (error) {
      handleControllerError(error, res, 'WritingGridController.deal');
    }
  }
}
