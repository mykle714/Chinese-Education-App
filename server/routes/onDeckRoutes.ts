import { Router } from 'express';
import { authenticateToken } from '../authMiddleware.js';
import { onDeckVocabController } from '../dal/setup.js';
import { handle } from './asyncHandler.js';

/**
 * OnDeck vocab set routes — /api/onDeck/*
 *
 * LAYER: HTTP route layer (registration only). Split out of server.ts; paths unchanged.
 * "library" in these paths is the internal name for the user-facing "Learn Now"
 * bucket — backend contract, do not rename (see CLAUDE.md).
 */
const router = Router();

// Get all library cards (vocab entries from *-library OnDeck sets)
router.get('/api/onDeck/libraryCards', authenticateToken, handle(onDeckVocabController.getLibraryCards, onDeckVocabController));

// Get mastered library cards (library cards with category = 'Mastered')
router.get('/api/onDeck/masteredLibraryCards', authenticateToken, handle(onDeckVocabController.getMasteredLibraryCards, onDeckVocabController));

// Get non-mastered library cards (library cards without category = 'Mastered')
router.get('/api/onDeck/nonMasteredLibraryCards', authenticateToken, handle(onDeckVocabController.getNonMasteredLibraryCards, onDeckVocabController));

// Get distributed working loop (1 Mastered, 2 Comfortable, 2 Unfamiliar, 5 Target)
router.get('/api/onDeck/distributedWorkingLoop', authenticateToken, handle(onDeckVocabController.getDistributedWorkingLoop, onDeckVocabController));

// Per-category library card counts (drives the decks page bucket counts)
router.get('/api/onDeck/categoryCounts', authenticateToken, handle(onDeckVocabController.getCategoryCounts, onDeckVocabController));

// Bubble-match game pool (15 Target + 10 Comfortable by default)
router.get('/api/onDeck/gamePool', authenticateToken, handle(onDeckVocabController.getGamePool, onDeckVocabController));

// Word Search game grid (2 Unfamiliar + 10 Target + 6 Comfortable + 2 Mastered by default)
router.get('/api/onDeck/wordSearchGrid', authenticateToken, handle(onDeckVocabController.getWordSearchGrid, onDeckVocabController));

export default router;
