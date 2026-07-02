import { Router } from 'express';
import { authenticateToken } from '../authMiddleware.js';
import { textController } from '../dal/setup.js';

/**
 * Text (user document) routes — /api/texts/*
 *
 * LAYER: HTTP route layer (registration only). Split out of server.ts; paths unchanged.
 * See docs/USER_DOCUMENT_FEATURE_SUMMARY.md.
 */
const router = Router();

// Get all texts for authenticated user
// @ts-ignore
router.get('/api/texts', authenticateToken, async (req, res) => {
  await textController.getAllTexts(req, res);
});

// Get text statistics for authenticated user
// @ts-ignore
router.get('/api/texts/stats', authenticateToken, async (req, res) => {
  await textController.getUserTextStats(req, res);
});

// Get a specific text by ID
// @ts-ignore
router.get('/api/texts/:id', authenticateToken, async (req, res) => {
  await textController.getTextById(req, res);
});

// Create new text document
// @ts-ignore
router.post('/api/texts', authenticateToken, async (req, res) => {
  await textController.createText(req, res);
});

// Update text document
// @ts-ignore
router.put('/api/texts/:id', authenticateToken, async (req, res) => {
  await textController.updateText(req, res);
});

// Delete text document
// @ts-ignore
router.delete('/api/texts/:id', authenticateToken, async (req, res) => {
  await textController.deleteText(req, res);
});

export default router;
