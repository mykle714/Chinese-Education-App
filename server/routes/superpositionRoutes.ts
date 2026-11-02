import { Router } from 'express';
import { authenticateToken } from '../authMiddleware.js';
import { superpositionController } from '../dal/setup.js';
import { handle } from './asyncHandler.js';

/**
 * Superposition game routes — /api/superposition/* (docs/SUPERPOSITION_GAME.md).
 * LAYER: HTTP route layer (registration only).
 */
const router = Router();

// Deal one board: words holding four distinct characters.
router.get('/api/superposition/deal', authenticateToken, handle(superpositionController.deal, superpositionController));

export default router;
