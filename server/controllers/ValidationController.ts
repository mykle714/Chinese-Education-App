import { Request, Response } from 'express';
import { ValidationService } from '../services/ValidationService.js';
import { Language, ValidationField, isPerSenseValidationField } from '../types/index.js';
import { ValidationError, NotFoundError } from '../types/dal.js';

const VALID_LANGUAGES = new Set<Language>(['zh', 'es']);
// Every field the INLINE endpoints (entry-submit / entry-status) accept. The
// Reader-document queue picks its own, narrower set server-side (see
// ValidationService.composeValidationDoc), so this list is deliberately the wider one.
const VALID_FIELDS = new Set<ValidationField>([
  'definitions', 'exampleSentence0', 'exampleSentence1', 'exampleSentence2',
  'partsOfSpeech', 'difficulty', 'frequencyScore', 'senseFrequencyScore',
]);

// Upper bound on a `senseLabel` (a definitionClusters[].sense — a short English phrase
// like "to reckon accounts"). The column is TEXT, so this is not a storage limit; it is
// an input guard, since the label arrives from the client and is used as a lookup key.
const MAX_SENSE_LABEL_LENGTH = 200;

/**
 * Validate the `senseLabel` that accompanies a field: REQUIRED for the per-sense fields
 * (migration 139), ignored for entry-level ones (the service normalizes those to '').
 * Returns an error message, or null when the pair is acceptable.
 */
function senseLabelError(field: ValidationField, senseLabel: unknown): string | null {
  if (!isPerSenseValidationField(field)) return null;
  if (typeof senseLabel !== 'string' || senseLabel.trim().length === 0) {
    return 'senseLabel is required for this field';
  }
  if (senseLabel.length > MAX_SENSE_LABEL_LENGTH) return 'senseLabel is too long';
  return null;
}

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
   * POST /api/validation/:textId/submit  { action: 'approve' | 'flag' }
   * Approve copies the document's content verbatim server-side; flag stores no
   * content. Neither action takes content from the request body.
   */
  async submitValidation(req: Request, res: Response): Promise<void> {
    try {
      const userId = (req as any).user?.userId;
      if (!userId) {
        res.status(401).json({ error: 'User not authenticated', code: 'ERR_NOT_AUTHENTICATED' });
        return;
      }

      const { textId } = req.params;
      const { action } = req.body ?? {};

      if (action !== 'approve' && action !== 'flag') {
        res.status(400).json({ error: "action must be 'approve' or 'flag'", code: 'ERR_INVALID_ACTION' });
        return;
      }

      const record = await this.validationService.submitValidation(userId, textId, action);
      res.json({ success: true, record });
    } catch (error: any) {
      this.handleError(res, error, 'Failed to submit validation', 'ERR_SUBMIT_VALIDATION_FAILED');
    }
  }

  /**
   * Submit an approval or flag directly against a dictionary entry's field, with no
   * downloaded Reader document — the inline Approve/Flag buttons on the est/definition
   * UI (only shown to validators). POST /api/validation/entrySubmit
   * { word1, language: 'zh'|'es', field: ValidationField, action: 'approve'|'flag',
   *   senseLabel?: string }
   * `senseLabel` is REQUIRED for a per-sense field (senseFrequencyScore, migration 139)
   * and ignored otherwise.
   */
  async submitEntryValidation(req: Request, res: Response): Promise<void> {
    try {
      const userId = (req as any).user?.userId;
      if (!userId) {
        res.status(401).json({ error: 'User not authenticated', code: 'ERR_NOT_AUTHENTICATED' });
        return;
      }

      const { word1, language, field, action, senseLabel } = req.body ?? {};

      if (typeof word1 !== 'string' || word1.trim().length === 0) {
        res.status(400).json({ error: 'word1 is required', code: 'ERR_MISSING_WORD1' });
        return;
      }
      if (!VALID_LANGUAGES.has(language)) {
        res.status(400).json({ error: "language must be 'zh' or 'es'", code: 'ERR_INVALID_LANGUAGE' });
        return;
      }
      if (!VALID_FIELDS.has(field)) {
        res.status(400).json({ error: 'Invalid validation field', code: 'ERR_INVALID_FIELD' });
        return;
      }
      if (action !== 'approve' && action !== 'flag') {
        res.status(400).json({ error: "action must be 'approve' or 'flag'", code: 'ERR_INVALID_ACTION' });
        return;
      }
      const senseError = senseLabelError(field, senseLabel);
      if (senseError) {
        res.status(400).json({ error: senseError, code: 'ERR_INVALID_SENSE_LABEL' });
        return;
      }

      const record = await this.validationService.submitEntryValidation(userId, word1, language, field, action, senseLabel);
      res.json({ success: true, record });
    } catch (error: any) {
      this.handleError(res, error, 'Failed to submit validation', 'ERR_SUBMIT_VALIDATION_FAILED');
    }
  }

  /**
   * Undo the calling validator's own inline vote on a field — the "press the
   * filled icon again" affordance, leaving no signal in the DB.
   * DELETE /api/validation/entrySubmit?word1=&language=&field=&senseLabel=
   */
  async clearEntryValidation(req: Request, res: Response): Promise<void> {
    try {
      const userId = (req as any).user?.userId;
      if (!userId) {
        res.status(401).json({ error: 'User not authenticated', code: 'ERR_NOT_AUTHENTICATED' });
        return;
      }

      const { word1, language, field, senseLabel } = req.query as Record<string, string | undefined>;

      if (typeof word1 !== 'string' || word1.trim().length === 0) {
        res.status(400).json({ error: 'word1 is required', code: 'ERR_MISSING_WORD1' });
        return;
      }
      if (!VALID_LANGUAGES.has(language as Language)) {
        res.status(400).json({ error: "language must be 'zh' or 'es'", code: 'ERR_INVALID_LANGUAGE' });
        return;
      }
      if (!VALID_FIELDS.has(field as ValidationField)) {
        res.status(400).json({ error: 'Invalid validation field', code: 'ERR_INVALID_FIELD' });
        return;
      }

      const senseError = senseLabelError(field as ValidationField, senseLabel);
      if (senseError) {
        res.status(400).json({ error: senseError, code: 'ERR_INVALID_SENSE_LABEL' });
        return;
      }

      await this.validationService.clearEntryValidation(userId, word1, language as Language, field as ValidationField, senseLabel);
      res.json({ success: true });
    } catch (error: any) {
      this.handleError(res, error, 'Failed to clear validation', 'ERR_CLEAR_VALIDATION_FAILED');
    }
  }

  /**
   * The calling validator's own current vote on a field ('approve' | 'flag' | null)
   * — lets the inline Approve/Flag buttons show the right icon filled on mount,
   * instead of only after a same-session action.
   * GET /api/validation/entryStatus?word1=&language=&field=&senseLabel=
   */
  async getEntryValidationStatus(req: Request, res: Response): Promise<void> {
    try {
      const userId = (req as any).user?.userId;
      if (!userId) {
        res.status(401).json({ error: 'User not authenticated', code: 'ERR_NOT_AUTHENTICATED' });
        return;
      }

      const { word1, language, field, senseLabel } = req.query as Record<string, string | undefined>;

      if (typeof word1 !== 'string' || word1.trim().length === 0) {
        res.status(400).json({ error: 'word1 is required', code: 'ERR_MISSING_WORD1' });
        return;
      }
      if (!VALID_LANGUAGES.has(language as Language)) {
        res.status(400).json({ error: "language must be 'zh' or 'es'", code: 'ERR_INVALID_LANGUAGE' });
        return;
      }
      if (!VALID_FIELDS.has(field as ValidationField)) {
        res.status(400).json({ error: 'Invalid validation field', code: 'ERR_INVALID_FIELD' });
        return;
      }

      const senseError = senseLabelError(field as ValidationField, senseLabel);
      if (senseError) {
        res.status(400).json({ error: senseError, code: 'ERR_INVALID_SENSE_LABEL' });
        return;
      }

      const action = await this.validationService.getEntryValidationStatus(
        userId, word1, language as Language, field as ValidationField, senseLabel
      );
      res.json({ action });
    } catch (error: any) {
      this.handleError(res, error, 'Failed to load validation status', 'ERR_VALIDATION_STATUS_FAILED');
    }
  }

  /** Map service errors to HTTP responses (shared by both handlers). */
  private handleError(res: Response, error: any, fallbackMsg: string, fallbackCode: string): void {
    console.error(`[VALIDATION-CONTROLLER] ❌ ${fallbackMsg}:`, error);
    if (error instanceof ValidationError) {
      res.status(400).json({ error: error.message, code: error.code });
    } else if (error instanceof NotFoundError) {
      res.status(404).json({ error: error.message, code: 'ERR_NOT_FOUND' });
    } else {
      res.status(500).json({ error: fallbackMsg, code: fallbackCode });
    }
  }
}
