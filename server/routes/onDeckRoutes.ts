import { Router } from 'express';
import { authenticateToken } from '../authMiddleware.js';
import { onDeckVocabController } from '../dal/setup.js';

/**
 * OnDeck vocab set routes — /api/onDeck/*
 *
 * LAYER: HTTP route layer (registration only). Split out of server.ts; paths unchanged.
 * "library" in these paths is the internal name for the user-facing "Learn Now"
 * bucket — backend contract, do not rename (see CLAUDE.md).
 */
const router = Router();

// Get all library cards (vocab entries from *-library OnDeck sets)
// @ts-ignore
router.get('/api/onDeck/library-cards', authenticateToken, async (req, res) => {
  await onDeckVocabController.getLibraryCards(req, res);
});

// Get mastered library cards (library cards with category = 'Mastered')
// @ts-ignore
router.get('/api/onDeck/mastered-library-cards', authenticateToken, async (req, res) => {
  await onDeckVocabController.getMasteredLibraryCards(req, res);
});

// Get non-mastered library cards (library cards without category = 'Mastered')
// @ts-ignore
router.get('/api/onDeck/non-mastered-library-cards', authenticateToken, async (req, res) => {
  await onDeckVocabController.getNonMasteredLibraryCards(req, res);
});

// Get distributed working loop (1 Mastered, 2 Comfortable, 2 Unfamiliar, 5 Target)
// @ts-ignore
router.get('/api/onDeck/distributed-working-loop', authenticateToken, async (req, res) => {
  await onDeckVocabController.getDistributedWorkingLoop(req, res);
});

// Per-category library card counts (drives the decks page bucket counts)
// @ts-ignore
router.get('/api/onDeck/category-counts', authenticateToken, async (req, res) => {
  await onDeckVocabController.getCategoryCounts(req, res);
});

// Bubble-match game pool (15 Target + 10 Comfortable by default)
// @ts-ignore
router.get('/api/onDeck/game-pool', authenticateToken, async (req, res) => {
  await onDeckVocabController.getGamePool(req, res);
});

// Word Search game grid (2 Unfamiliar + 10 Target + 6 Comfortable + 2 Mastered by default)
// @ts-ignore
router.get('/api/onDeck/word-search-grid', authenticateToken, async (req, res) => {
  await onDeckVocabController.getWordSearchGrid(req, res);
});

export default router;
