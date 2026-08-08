import { Request, Response } from 'express';
import { ICategoryPromotionDAL } from '../dal/interfaces/ICategoryPromotionDAL.js';
import { IUserDAL } from '../dal/interfaces/IUserDAL.js';
import { requireUserId, handleControllerError } from '../utils/controllerUtils.js';
import { resolveWriteLanguage } from '../utils/languageParam.js';
import { VELOCITY_WINDOW_DAYS, VelocityResponse } from '../types/velocity.js';

/**
 * Velocity HTTP layer.
 *
 * GET /api/users/me/velocity[?language=zh]
 *   → { velocity, language, byLanguage, total, windowDays }
 *
 * Velocity is the number of utcm band-steps climbed in the last 7 days for one
 * (user, language). Thin enough to take the DALs directly with no service layer —
 * the only "business rule" is which language the headline number belongs to
 * (mirrors WinsController / Icons8Controller). See docs/VELOCITY.md.
 */
export class VelocityController {
  constructor(
    private categoryPromotionDAL: ICategoryPromotionDAL,
    private userDAL: IUserDAL
  ) {}

  /** GET /api/users/me/velocity */
  async getVelocity(req: Request, res: Response): Promise<void> {
    try {
      const userId = requireUserId(req, res);
      if (!userId) return;

      const byLanguageMap = await this.categoryPromotionDAL.getVelocityByLanguage(
        userId,
        VELOCITY_WINDOW_DAYS
      );

      // Headline language: an explicit ?language wins (a caller viewing one
      // language's stats), else the account's selected language. Same precedence
      // as the minute-point write path, and for the same reason — never silently
      // report Chinese numbers to a Spanish learner.
      const requested = resolveWriteLanguage(req.query.language);
      const user = requested ? null : await this.userDAL.findById(userId);
      const language = requested || user?.selectedLanguage || 'zh';

      const byLanguage: Record<string, number> = {};
      let total = 0;
      for (const [lang, steps] of byLanguageMap) {
        byLanguage[lang] = steps;
        total += steps;
      }

      const response: VelocityResponse = {
        velocity: byLanguage[language] ?? 0,
        language,
        byLanguage,
        total,
        windowDays: VELOCITY_WINDOW_DAYS,
      };
      res.json(response);
    } catch (error) {
      handleControllerError(error, res, 'VelocityController.getVelocity');
    }
  }
}
