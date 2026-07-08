import { Request, Response } from 'express';
import { ValidationService } from '../services/ValidationService.js';
import { Language } from '../types/index.js';
import { ValidationError, NotFoundError } from '../types/dal.js';

/**
 * Validation Controller — HTTP layer for the data-validation feature.
 * Follows the DAL/controller pattern (see TextController). All routes are behind
 * `authenticateToken`; validator-status is enforced in ValidationService.
 * See docs/DATA_VALIDATION_SYSTEM.md.
 */
export class ValidationController {
  constructor(private validationService: ValidationService) {}

  /**
   * Download (compose) a new validation document for the current user.
   * POST /api/validation/download
   * The entry + field are chosen server-side from the user's selected language.
   */
  async downloadValidationDoc(req: Request, res: Response): Promise<void> {
    try {
      const userId = (req as any).user?.userId;
      if (!userId) {
        res.status(401).json({ error: 'User not authenticated', code: 'ERR_NOT_AUTHENTICATED' });
        return;
      }

      // Language may be passed by the client; otherwise the service uses the user's
      // selectedLanguage. We accept it explicitly so the Reader can validate in the
      // language it is currently showing.
      const language: Language = (req.body?.language as Language) || 'zh';

      const doc = await this.validationService.composeValidationDoc(userId, language);
      res.status(201).json(doc);
    } catch (error: any) {
      this.handleError(res, error, 'Failed to compose validation document', 'ERR_COMPOSE_VALIDATION_FAILED');
    }
  }

  /**
   * Submit an approval or flag for a validation document.
   * POST /api/validation/:textId/submit  { action: 'approve' | 'flag', content?: string }
   */
  async submitValidation(req: Request, res: Response): Promise<void> {
    try {
      const userId = (req as any).user?.userId;
      if (!userId) {
        res.status(401).json({ error: 'User not authenticated', code: 'ERR_NOT_AUTHENTICATED' });
        return;
      }

      const { textId } = req.params;
      const { action, content } = req.body ?? {};

      if (action !== 'approve' && action !== 'flag') {
        res.status(400).json({ error: "action must be 'approve' or 'flag'", code: 'ERR_INVALID_ACTION' });
        return;
      }
      // Both actions store the reviewed body: the approved data version, or the
      // suggested edit. So content is required regardless of action.
      if (typeof content !== 'string' || content.trim().length === 0) {
        res.status(400).json({ error: 'A validation requires a non-empty body', code: 'ERR_MISSING_CONTENT' });
        return;
      }

      const record = await this.validationService.submitValidation(userId, textId, action, content);
      res.json({ success: true, record });
    } catch (error: any) {
      this.handleError(res, error, 'Failed to submit validation', 'ERR_SUBMIT_VALIDATION_FAILED');
    }
  }

  /** Map service errors to HTTP responses (shared by both handlers). */
  private handleError(res: Response, error: any, fallbackMsg: string, fallbackCode: string): void {
    console.error(`[VALIDATION-CONTROLLER] ❌ ${fallbackMsg}:`, error);
    if (error instanceof ValidationError) {
      // Pass the concrete code through (e.g. ERR_VALIDATION_FORMAT_CHANGED) so the
      // client can special-case the "format changed → Revert" flow.
      res.status(400).json({ error: error.message, code: error.code });
    } else if (error instanceof NotFoundError) {
      res.status(404).json({ error: error.message, code: 'ERR_NOT_FOUND' });
    } else {
      res.status(500).json({ error: fallbackMsg, code: fallbackCode });
    }
  }
}
