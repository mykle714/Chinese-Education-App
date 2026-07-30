import { Router } from 'express';
import { authenticateToken } from '../authMiddleware.js';
import { nightMarketSandboxController } from '../dal/setup.js';
import { handle } from './asyncHandler.js';

/**
 * Night Market template SANDBOX routes — /api/nightMarketSandbox/*
 *
 * LAYER: HTTP route layer (registration only). Template-author status is enforced in
 * NightMarketSandboxService, not here. See docs/NIGHT_MARKET_TEMPLATE_SANDBOX.md.
 */
const router = Router();

// List the author's sandbox placements.
router.get('/api/nightMarketSandbox', authenticateToken, handle(nightMarketSandboxController.listPlacements, nightMarketSandboxController));

// Add one placement (drop a template into the sandbox).
router.post('/api/nightMarketSandbox', authenticateToken, handle(nightMarketSandboxController.addPlacement, nightMarketSandboxController));

// Move one placement to a new SW-corner offset (drag).
router.patch('/api/nightMarketSandbox/:id/position', authenticateToken, handle(nightMarketSandboxController.movePlacement, nightMarketSandboxController));

// Set one placement's rendered version (the per-instance version switcher).
router.patch('/api/nightMarketSandbox/:id/version', authenticateToken, handle(nightMarketSandboxController.setPlacementVersion, nightMarketSandboxController));

// Lock / unlock one placement (the move-guard toggle).
router.patch('/api/nightMarketSandbox/:id/lock', authenticateToken, handle(nightMarketSandboxController.setPlacementLock, nightMarketSandboxController));

// Merge a render/view settings patch into one placement's settings bag (e.g. { houseMode }).
router.patch('/api/nightMarketSandbox/:id/settings', authenticateToken, handle(nightMarketSandboxController.setPlacementSettings, nightMarketSandboxController));

// Run the live growth algorithm once over the sandbox layout and place what it chose ("Iterate").
router.post('/api/nightMarketSandbox/iterate', authenticateToken, handle(nightMarketSandboxController.iteratePlacement, nightMarketSandboxController));

// Clear the caller's whole sandbox (the "Clear" action). Registered BEFORE the :id delete so the
// bare-collection DELETE is never mistaken for a placement id.
router.delete('/api/nightMarketSandbox', authenticateToken, handle(nightMarketSandboxController.clearPlacements, nightMarketSandboxController));

// Delete one placement (the "Delete selected" action).
router.delete('/api/nightMarketSandbox/:id', authenticateToken, handle(nightMarketSandboxController.removePlacement, nightMarketSandboxController));

export default router;
