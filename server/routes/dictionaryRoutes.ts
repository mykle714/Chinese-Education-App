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

export default router;
