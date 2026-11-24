import { Router } from 'express';
import { authenticateToken } from '../authMiddleware.js';
import { speedReadingController } from '../dal/setup.js';
import { handle } from './asyncHandler.js';

/**
 * Speed Reading game routes — /api/games/speedReading/*
 *
 * LAYER: HTTP route layer (registration only). See docs/SPEED_READING_GAME.md.
 */
const router = Router();

// The distractor pool: real characters from the caller's own library.
router.get(
  '/api/games/speedReading/distractors',
  authenticateToken,
  handle(speedReadingController.getDistractors, speedReadingController)
);

export default router;
