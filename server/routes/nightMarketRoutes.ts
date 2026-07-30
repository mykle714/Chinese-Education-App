import { Router } from 'express';
import { authenticateToken } from '../authMiddleware.js';
import {
  nightMarketController,
  nightMarketWorldController,
  userMinutePointsController,
} from '../dal/setup.js';
import { handle } from './asyncHandler.js';

/**
 * Night Market routes — /api/nightMarket/*
 *
 * LAYER: HTTP route layer (registration only).
 *
 * Split out of gamesRoutes.ts so the feature's three namespaces sit together and each
 * route file maps 1:1 to its namespace (docs/ARCHITECTURE_REVIEW.md finding 10). The
 * sibling files are nightMarketTemplateRoutes.ts (/api/nightMarketTemplates) and
 * nightMarketSandboxRoutes.ts (/api/nightMarketSandbox) — all three now share one
 * spelling of the feature name, where the paths used to read `night-market`,
 * `nightmarket-templates` and `nightmarket-sandbox`.
 *
 * See docs/NIGHT_MARKET_FEATURE.md.
 */
const router = Router();

// Get the user's unlocked night market items (seeds the base set on first call)
router.get('/api/nightMarket/unlocks', authenticateToken, handle(nightMarketController.getUnlocks, nightMarketController));

// Unlock the next random night market item
router.post('/api/nightMarket/unlock', authenticateToken, handle(nightMarketController.unlockNext, nightMarketController));

// Get the authenticated user's rendered template LAYOUT (placements → world). Seeds the
// origin hub on first load if the user has none. (Migrations 112/113; runtime plan slice 3.)
router.get('/api/nightMarket/layout', authenticateToken, handle(nightMarketWorldController.getLayout, nightMarketWorldController));

// Template-author-only DEV tool: emit an artificial ±N minute signal (the nmp buttons) and
// reconcile the market to the new balance. Gated on isTemplateAuthor inside the service (403).
router.post('/api/nightMarket/dev/adjustMinutes', authenticateToken, handle(userMinutePointsController.adjustMinutesForAuthor, userMinutePointsController));

export default router;
