import { Router } from 'express';
import { authenticateToken } from '../authMiddleware.js';
import { sentenceTilesController } from '../dal/setup.js';
import { handle } from './asyncHandler.js';

/**
 * Sentence Tiles routes — /api/sentenceTiles/*
 *
 * LAYER: HTTP route layer (registration only). Mounted in server.ts behind
 * FEATURE_FLAGS.sentenceTiles. See docs/SENTENCE_TILES_GAME.md § "Endpoints"; the controller
 * header lists the request/response shapes. Writes also pass the global writeLimiter.
 */
const router = Router();
const c = sentenceTilesController;

router.get('/api/sentenceTiles/games', authenticateToken, handle(c.listGames, c));
router.post('/api/sentenceTiles/games', authenticateToken, handle(c.createGame, c));
router.get('/api/sentenceTiles/games/:id', authenticateToken, handle(c.getGame, c));
router.post('/api/sentenceTiles/games/:id/play', authenticateToken, handle(c.play, c));
router.post('/api/sentenceTiles/games/:id/exchange', authenticateToken, handle(c.exchange, c));
router.post('/api/sentenceTiles/games/:id/pass', authenticateToken, handle(c.pass, c));
router.post('/api/sentenceTiles/games/:id/resign', authenticateToken, handle(c.resign, c));
router.post('/api/sentenceTiles/games/:id/decline', authenticateToken, handle(c.decline, c));
router.post('/api/sentenceTiles/games/:id/cancel', authenticateToken, handle(c.cancel, c));

export default router;
