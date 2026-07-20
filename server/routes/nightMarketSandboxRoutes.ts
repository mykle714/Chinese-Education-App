import { Router } from 'express';
import { authenticateToken } from '../authMiddleware.js';
import { nightMarketSandboxController } from '../dal/setup.js';

/**
 * Night Market template SANDBOX routes — /api/nightmarket-sandbox/*
 *
 * LAYER: HTTP route layer (registration only). Template-author status is enforced in
 * NightMarketSandboxService, not here. See docs/NIGHT_MARKET_TEMPLATE_SANDBOX.md.
 */
const router = Router();

// List the author's sandbox placements.
// @ts-ignore
router.get('/api/nightmarket-sandbox', authenticateToken, async (req, res) => {
  await nightMarketSandboxController.listPlacements(req, res);
});

// Add one placement (drop a template into the sandbox).
// @ts-ignore
router.post('/api/nightmarket-sandbox', authenticateToken, async (req, res) => {
  await nightMarketSandboxController.addPlacement(req, res);
});

// Move one placement to a new SW-corner offset (drag).
// @ts-ignore
router.patch('/api/nightmarket-sandbox/:id/position', authenticateToken, async (req, res) => {
  await nightMarketSandboxController.movePlacement(req, res);
});

// Set one placement's rendered version (the per-instance version switcher).
// @ts-ignore
router.patch('/api/nightmarket-sandbox/:id/version', authenticateToken, async (req, res) => {
  await nightMarketSandboxController.setPlacementVersion(req, res);
});

// Lock / unlock one placement (the move-guard toggle).
// @ts-ignore
router.patch('/api/nightmarket-sandbox/:id/lock', authenticateToken, async (req, res) => {
  await nightMarketSandboxController.setPlacementLock(req, res);
});

// Merge a render/view settings patch into one placement's settings bag (e.g. { houseMode }).
// @ts-ignore
router.patch('/api/nightmarket-sandbox/:id/settings', authenticateToken, async (req, res) => {
  await nightMarketSandboxController.setPlacementSettings(req, res);
});

// Run the live growth algorithm once over the sandbox layout and place what it chose ("Iterate").
// @ts-ignore
router.post('/api/nightmarket-sandbox/iterate', authenticateToken, async (req, res) => {
  await nightMarketSandboxController.iteratePlacement(req, res);
});

// Clear the caller's whole sandbox (the "Clear" action). Registered BEFORE the :id delete so the
// bare-collection DELETE is never mistaken for a placement id.
// @ts-ignore
router.delete('/api/nightmarket-sandbox', authenticateToken, async (req, res) => {
  await nightMarketSandboxController.clearPlacements(req, res);
});

// Delete one placement (the "Delete selected" action).
// @ts-ignore
router.delete('/api/nightmarket-sandbox/:id', authenticateToken, async (req, res) => {
  await nightMarketSandboxController.removePlacement(req, res);
});

export default router;
