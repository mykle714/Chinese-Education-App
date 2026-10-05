import { Request, Response } from 'express';
import { requireUserId, handleControllerError } from '../utils/controllerUtils.js';
import { resolveWriteLanguage } from '../utils/languageParam.js';
import type { PersonalBestService } from '../services/PersonalBestService.js';

/**
 * GET  /api/users/me/personal-bests?language=zh[&game=word-search] → { bests }
 * POST /api/users/me/personal-bests { language, game, mode, value } → SubmitPersonalBestResponse
 *
 * Docs: docs/WRITING_PRACTICE_REWORK.md § 2a. Thin: validation of game/mode/value is the
 * service's; this resolves the user and language and maps errors.
 */
export class PersonalBestController {
  constructor(private personalBestService: PersonalBestService) {}

  async list(req: Request, res: Response): Promise<void> {
    try {
      const userId = requireUserId(req, res);
      if (!userId) return;
      const language = resolveWriteLanguage(req.query.language);
      if (!language) {
        res.status(400).json({ error: 'language is required', code: 'ERR_INVALID_INPUT' });
        return;
      }
      const game = typeof req.query.game === 'string' ? req.query.game : undefined;
      const bests = await this.personalBestService.list(userId, language, game);
      res.json({ bests });
    } catch (error) {
      handleControllerError(error, res, 'PersonalBestController.list');
    }
  }

  async submit(req: Request, res: Response): Promise<void> {
    try {
      const userId = requireUserId(req, res);
      if (!userId) return;
      const { language: rawLanguage, game, mode, value } = req.body ?? {};
      const language = resolveWriteLanguage(rawLanguage);
      if (!language) {
        res.status(400).json({ error: 'language is required', code: 'ERR_INVALID_INPUT' });
        return;
      }
      const result = await this.personalBestService.submit(userId, language, game, mode, value);
      res.json(result);
    } catch (error) {
      handleControllerError(error, res, 'PersonalBestController.submit');
    }
  }
}
