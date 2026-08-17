import { Router } from 'express';
import { authenticateToken } from '../authMiddleware.js';
import { arenaController } from '../dal/setup.js';
import { handle } from './asyncHandler.js';

/**
 * Arena routes — /api/arena/*
 *
 * LAYER: HTTP route layer (registration only). See docs/ARENA_FEATURE.md § 10.
 *
 * ⚠️ ORDERING. Static segments are declared ABOVE anything parameterized, the
 * same rule friendRoutes follows: a future `GET /api/arena/:id` would otherwise
 * swallow both `/optIn` and `/admin/tick`. There is no `:id` route today; the
 * ordering is here so adding one later cannot silently break these.
 *
 * Paths are camelCase (`optIn`), per docs/BACKEND_LAYERING.md.
 */
const router = Router();

// ── Opt-in (static, declared first) ──
router.post('/api/arena/optIn', authenticateToken, handle(arenaController.optIn, arenaController));
router.delete('/api/arena/optIn', authenticateToken, handle(arenaController.withdraw, arenaController));

// ── Coarse location (opt-in, clearable) ──
router.post('/api/arena/location', authenticateToken, handle(arenaController.setLocation, arenaController));

// ── Manual tick. The cron is prod-only, so dev needs this or the feature
//    cannot be exercised locally at all. Validator-gated inside the controller.
router.post('/api/arena/admin/tick', authenticateToken, handle(arenaController.adminTick, arenaController));

// ── The board ──
router.get('/api/arena', authenticateToken, handle(arenaController.getBoard, arenaController));

export default router;
