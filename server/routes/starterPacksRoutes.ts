import { Router } from 'express';
import { authenticateToken } from '../authMiddleware.js';
import { starterPacksController } from '../dal/setup.js';
import { handle } from './asyncHandler.js';

/**
 * Starter pack (sort cards) routes — /api/starterPacks/*
 *
 * LAYER: HTTP route layer (registration only). Split out of server.ts; paths unchanged.
 */
const router = Router();

// Sort a card into a bucket
router.post('/api/starterPacks/sort', authenticateToken, handle(starterPacksController.sortCard, starterPacksController));

// Undo last card sort
router.post('/api/starterPacks/undo', authenticateToken, handle(starterPacksController.undoSort, starterPacksController));

// Refill one sort pack after the client's on-deck pack completes
router.post('/api/starterPacks/nextPack', authenticateToken, handle(starterPacksController.nextPack, starterPacksController));

// Skip a whole pack — defer all remaining unsorted cards at once
router.post('/api/starterPacks/skipPack', authenticateToken, handle(starterPacksController.skipPack, starterPacksController));

// Get starter pack cards for a specific language
// (Replenishment is folded into the POST /sort response, which returns the
// single replacement card for the queue.)
router.get('/api/starterPacks/:language', authenticateToken, handle(starterPacksController.getStarterPackCards, starterPacksController));

// Get user's progress on a starter pack
router.get('/api/starterPacks/:language/progress', authenticateToken, handle(starterPacksController.getProgress, starterPacksController));

// Quick Mark: one paginated page of not-yet-sorted words at an exact level
router.get('/api/starterPacks/:language/quickMark', authenticateToken, handle(starterPacksController.getQuickMarkCards, starterPacksController));

// Quick Mark: batch-reconcile marked cards into their buckets
router.post('/api/starterPacks/quickMarkBatch', authenticateToken, handle(starterPacksController.quickMarkBatch, starterPacksController));

// List the user's currently-skipped words for a language (Skipped page)
router.get('/api/starterPacks/:language/skipped', authenticateToken, handle(starterPacksController.getSkipped, starterPacksController));

// Recycle ALL of the user's skips for a language back into the supply
router.post('/api/starterPacks/:language/recycleSkips', authenticateToken, handle(starterPacksController.recycleSkips, starterPacksController));

export default router;
