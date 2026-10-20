import { Router } from 'express';
import { authenticateToken } from '../authMiddleware.js';
import { focusModeController } from '../dal/setup.js';
import { handle } from './asyncHandler.js';

/**
 * Focus mode routes — /api/focus/* (docs/FOCUS_MODE.md § 6).
 *
 * LAYER: HTTP route layer (registration only).
 */
const router = Router();

// Every world's focus state (and today's snapshot, taken on demand).
router.get('/api/focus', authenticateToken, handle(focusModeController.getStatus, focusModeController));

// The Deck Tower lever: { world, on }.
router.post('/api/focus', authenticateToken, handle(focusModeController.setFocus, focusModeController));

// The "focus mode turned off" popups the client has shown: { worlds }.
router.post(
  '/api/focus/notices/ack',
  authenticateToken,
  handle(focusModeController.acknowledgeNotices, focusModeController)
);

export default router;
