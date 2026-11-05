import { Router } from 'express';
import { authenticateToken } from '../authMiddleware.js';
import { weatherController } from '../dal/setup.js';
import { handle } from './asyncHandler.js';

/**
 * Weather routes — /api/weather (docs/DECK_TOWER.md § "Weather").
 *
 * LAYER: HTTP route layer (registration only).
 *
 * Not feature-flagged on its own: it only reads `users."geoCell"`, which is WRITTEN
 * through POST /api/arena/location — so with the arena flag off, nobody new can store
 * a cell and this answers `no-location` for them.
 */
const router = Router();

router.get('/api/weather', authenticateToken, handle(weatherController.getWeather, weatherController));

export default router;
