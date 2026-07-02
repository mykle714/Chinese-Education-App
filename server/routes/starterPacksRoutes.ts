import { Router } from 'express';
import { authenticateToken } from '../authMiddleware.js';
import { starterPacksController } from '../dal/setup.js';

/**
 * Starter pack (sort cards) routes — /api/starter-packs/*
 *
 * LAYER: HTTP route layer (registration only). Split out of server.ts; paths unchanged.
 */
const router = Router();

// Sort a card into a bucket
// @ts-ignore
router.post('/api/starter-packs/sort', authenticateToken, async (req, res) => {
  await starterPacksController.sortCard(req, res);
});

// Undo last card sort
// @ts-ignore
router.post('/api/starter-packs/undo', authenticateToken, async (req, res) => {
  await starterPacksController.undoSort(req, res);
});

// Refill one sort pack after the client's on-deck pack completes
// @ts-ignore
router.post('/api/starter-packs/next-pack', authenticateToken, async (req, res) => {
  await starterPacksController.nextPack(req, res);
});

// Skip a whole pack — defer all remaining unsorted cards at once
// @ts-ignore
router.post('/api/starter-packs/skip-pack', authenticateToken, async (req, res) => {
  await starterPacksController.skipPack(req, res);
});

// Get starter pack cards for a specific language
// (Replenishment is folded into the POST /sort response, which returns the
// single replacement card for the queue.)
// @ts-ignore
router.get('/api/starter-packs/:language', authenticateToken, async (req, res) => {
  await starterPacksController.getStarterPackCards(req, res);
});

// Get user's progress on a starter pack
// @ts-ignore
router.get('/api/starter-packs/:language/progress', authenticateToken, async (req, res) => {
  await starterPacksController.getProgress(req, res);
});

// List the user's currently-skipped words for a language (Skipped page)
// @ts-ignore
router.get('/api/starter-packs/:language/skipped', authenticateToken, async (req, res) => {
  await starterPacksController.getSkipped(req, res);
});

// Recycle ALL of the user's skips for a language back into the supply
// @ts-ignore
router.post('/api/starter-packs/:language/recycle-skips', authenticateToken, async (req, res) => {
  await starterPacksController.recycleSkips(req, res);
});

export default router;
