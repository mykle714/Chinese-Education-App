import { Router } from 'express';
import { authenticateToken } from '../authMiddleware.js';
import { validationController } from '../dal/setup.js';
import { handle } from './asyncHandler.js';

/**
 * Data-validation routes — /api/validation/*
 *
 * LAYER: HTTP route layer (registration only). Validator-status is enforced in
 * ValidationService, not here. See docs/DATA_VALIDATION_SYSTEM.md.
 */
const router = Router();

// Download (compose) a new validation document for the authenticated validator.
router.post('/api/validation/download', authenticateToken, handle(validationController.downloadValidationDoc, validationController));

// Submit an approval or flag for a validation document.
router.post('/api/validation/:textId/submit', authenticateToken, handle(validationController.submitValidation, validationController));

// Submit an approval or flag directly against a dictionary entry's field — the
// inline Approve/Flag buttons on the est/definition UI, no document involved.
// A repeat call from the same validator overwrites their prior vote in place.
router.post('/api/validation/entrySubmit', authenticateToken, handle(validationController.submitEntryValidation, validationController));

// Undo the calling validator's own inline vote, leaving no signal in the DB.
router.delete('/api/validation/entrySubmit', authenticateToken, handle(validationController.clearEntryValidation, validationController));

// The calling validator's own current vote on a field, so the inline buttons
// can render the right icon filled on mount (not just after a same-session action).
router.get('/api/validation/entryStatus', authenticateToken, handle(validationController.getEntryValidationStatus, validationController));

export default router;
