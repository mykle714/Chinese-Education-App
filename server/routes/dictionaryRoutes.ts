import { Router } from 'express';
import { authenticateToken } from '../authMiddleware.js';
import { dictionaryController } from '../dal/setup.js';
import { handle } from './asyncHandler.js';

/**
 * Dictionary routes — /api/dictionary/*
 *
 * LAYER: HTTP route layer (registration only). Split out of server.ts; paths unchanged.
 */
const router = Router();

// Search dictionary entries with pagination
router.get('/api/dictionary/search', authenticateToken, handle(dictionaryController.search, dictionaryController));

// Segment input text via GSA and return dictionary entries grouped by segment
router.get('/api/dictionary/segment', authenticateToken, handle(dictionaryController.segmentSearch, dictionaryController));

// Generate an AI synthetic dictionary entry for a pinyin query with no real match ("AI" button)
router.post('/api/dictionary/aiEntry', authenticateToken, handle(dictionaryController.aiEntry, dictionaryController));

// Generate (or return cached) a comparison paragraph for two words (eip Compare tab)
router.post('/api/dictionary/compare', authenticateToken, handle(dictionaryController.compare, dictionaryController));

// Lookup dictionary term by exact match
router.get('/api/dictionary/lookup/:term', authenticateToken, handle(dictionaryController.lookupTerm, dictionaryController));

// Get total dictionary entry count
router.get('/api/dictionary/count', authenticateToken, handle(dictionaryController.getCount, dictionaryController));

// Paginated "used in" list for a single character (infinite scroll on the eip/cdp Used In list)
router.get('/api/dictionary/usedIn', authenticateToken, handle(dictionaryController.usedIn, dictionaryController));

export default router;
