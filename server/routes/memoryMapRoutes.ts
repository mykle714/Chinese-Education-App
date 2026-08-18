import { Router } from 'express';
import { authenticateToken } from '../authMiddleware.js';
import { memoryMapController } from '../dal/setup.js';
import { handle } from './asyncHandler.js';

/**
 * Memory Map routes — /api/memoryMap/*
 *
 * LAYER: HTTP route layer (registration only). See docs/MEMORY_MAP_GAME.md § 9.
 *
 * camelCase path per docs/BACKEND_LAYERING.md. Registered under its own namespace
 * rather than `/api/games/:gameId/...`, because those routes are the game-AGNOSTIC
 * framework endpoints (assets, progress) and these are specific to this game's tables.
 */
const router = Router();

// The whole map, topped up to capacity. One call per game entry.
router.get('/api/memoryMap', authenticateToken, handle(memoryMapController.getMap, memoryMapController));

// A word graduated (reading-mastered): retire it and hand back its replacement.
router.post(
  '/api/memoryMap/graduate',
  authenticateToken,
  handle(memoryMapController.graduate, memoryMapController)
);

export default router;
