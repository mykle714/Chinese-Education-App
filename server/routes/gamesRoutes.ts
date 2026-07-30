import { Router } from 'express';
import { authenticateToken } from '../authMiddleware.js';
import { gamesController } from '../dal/setup.js';
import { handle } from './asyncHandler.js';

/**
 * Games framework routes — /api/games/*
 *
 * LAYER: HTTP route layer (registration only).
 *
 * One controller serves every game; `:gameId` scopes each request. See
 * docs/GAMES_FEATURE.md.
 *
 * This file previously ALSO registered /api/nightMarket, /api/community and
 * /api/leaderboard — four unrelated namespaces in one file, while Night Market's
 * other two namespaces each had their own. Every route file now maps 1:1 to its
 * namespace. See docs/ARCHITECTURE_REVIEW.md finding 10.
 */
const router = Router();

// List assets registered for a game (used to preload textures)
router.get('/api/games/:gameId/assets', authenticateToken, handle(gamesController.getAssets, gamesController));

// Fetch the authenticated user's save state for a game
router.get('/api/games/:gameId/progress', authenticateToken, handle(gamesController.getProgress, gamesController));

// Upsert the authenticated user's save state for a game
router.post('/api/games/:gameId/progress', authenticateToken, handle(gamesController.saveProgress, gamesController));

export default router;
