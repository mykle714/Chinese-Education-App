import { Router } from 'express';
import { authenticateToken } from '../authMiddleware.js';
import { validationController } from '../dal/setup.js';

/**
 * Data-validation routes — /api/validation/*
 *
 * LAYER: HTTP route layer (registration only). Validator-status is enforced in
 * ValidationService, not here. See docs/DATA_VALIDATION_SYSTEM.md.
 */
const router = Router();

// Download (compose) a new validation document for the authenticated validator.
// @ts-ignore
router.post('/api/validation/download', authenticateToken, async (req, res) => {
  await validationController.downloadValidationDoc(req, res);
});

// Submit an approval or flag for a validation document.
// @ts-ignore
router.post('/api/validation/:textId/submit', authenticateToken, async (req, res) => {
  await validationController.submitValidation(req, res);
});

// Submit an approval or flag directly against a dictionary entry's field — the
// inline Approve/Flag buttons on the est/definition UI, no document involved.
// @ts-ignore
router.post('/api/validation/entry-submit', authenticateToken, async (req, res) => {
  await validationController.submitEntryValidation(req, res);
});

export default router;
