import { Router } from 'express';
import { authenticateToken } from '../authMiddleware.js';
import { writingGridController } from '../dal/setup.js';
import { handle } from './asyncHandler.js';

/**
 * Writing Grid game routes — /api/writingGrid/* (docs/WRITING_PRACTICE_REWORK.md § 2).
 * LAYER: HTTP route layer (registration only).
 */
const router = Router();

// Deal the 8 characters for one board.
router.get('/api/writingGrid/deal', authenticateToken, handle(writingGridController.deal, writingGridController));

export default router;
