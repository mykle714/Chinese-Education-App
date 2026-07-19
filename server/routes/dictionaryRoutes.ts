import { Router } from 'express';
import { authenticateToken } from '../authMiddleware.js';
import { dictionaryController } from '../dal/setup.js';

/**
 * Dictionary routes — /api/dictionary/*
 *
 * LAYER: HTTP route layer (registration only). Split out of server.ts; paths unchanged.
 */
const router = Router();

// Search dictionary entries with pagination
// @ts-ignore
router.get('/api/dictionary/search', authenticateToken, async (req, res) => {
  await dictionaryController.search(req, res);
});

// Segment input text via GSA and return dictionary entries grouped by segment
// @ts-ignore
router.get('/api/dictionary/segment', authenticateToken, async (req, res) => {
  await dictionaryController.segmentSearch(req, res);
});

// Generate an AI synthetic dictionary entry for a pinyin query with no real match ("AI" button)
// @ts-ignore
router.post('/api/dictionary/ai-entry', authenticateToken, async (req, res) => {
  await dictionaryController.aiEntry(req, res);
});

// Generate (or return cached) a comparison paragraph for two words (eip Compare tab)
// @ts-ignore
router.post('/api/dictionary/compare', authenticateToken, async (req, res) => {
  await dictionaryController.compare(req, res);
});

// Lookup dictionary term by exact match
// @ts-ignore
router.get('/api/dictionary/lookup/:term', authenticateToken, async (req, res) => {
  await dictionaryController.lookupTerm(req, res);
});

// Get total dictionary entry count
// @ts-ignore
router.get('/api/dictionary/count', authenticateToken, async (req, res) => {
  await dictionaryController.getCount(req, res);
});

// Paginated "used in" list for a single character (infinite scroll on the eip/cdp Used In list)
// @ts-ignore
router.get('/api/dictionary/used-in', authenticateToken, async (req, res) => {
  await dictionaryController.usedIn(req, res);
});

export default router;
