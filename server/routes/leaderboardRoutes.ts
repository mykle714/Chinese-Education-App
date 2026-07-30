import { Router } from 'express';
import { authenticateToken } from '../authMiddleware.js';
import { leaderboardController } from '../dal/setup.js';
import { handle } from './asyncHandler.js';

/**
 * Leaderboard routes — /api/leaderboard/*
 *
 * LAYER: HTTP route layer (registration only).
 *
 * Split out of gamesRoutes.ts (docs/ARCHITECTURE_REVIEW.md finding 10). The
 * controller now comes from dal/setup.js like every other one — it used to be a
 * self-instantiating singleton exported from its own module (finding 8).
 *
 * NOTE on ordering: the literal `/api/leaderboard` is registered FIRST, and the two
 * parameterized paths below it are namespaced under distinct `/top/` and `/user/`
 * prefixes, so no route can shadow another regardless of registration order.
 */
const router = Router();

// Full leaderboard (paginated via querystring)
router.get('/api/leaderboard', authenticateToken, handle(leaderboardController.getLeaderboard, leaderboardController));

// Top N users
router.get('/api/leaderboard/top/:limit', authenticateToken, handle(leaderboardController.getTopUsers, leaderboardController));

// Leaderboard with a specific user highlighted
router.get('/api/leaderboard/user/:userId', authenticateToken, handle(leaderboardController.getLeaderboardForUser, leaderboardController));

export default router;
