import { Router } from 'express';
import { authenticateToken } from '../authMiddleware.js';
import { textController } from '../dal/setup.js';
import { handle } from './asyncHandler.js';

/**
 * Text (user document) routes — /api/texts/*
 *
 * LAYER: HTTP route layer (registration only). Split out of server.ts; paths unchanged.
 * See docs/USER_DOCUMENT_FEATURE_SUMMARY.md.
 */
const router = Router();

// Get all texts for authenticated user
router.get('/api/texts', authenticateToken, handle(textController.getAllTexts, textController));

// Get text statistics for authenticated user
router.get('/api/texts/stats', authenticateToken, handle(textController.getUserTextStats, textController));

// Get a specific text by ID
router.get('/api/texts/:id', authenticateToken, handle(textController.getTextById, textController));

// Create new text document
router.post('/api/texts', authenticateToken, handle(textController.createText, textController));

// Update text document
router.put('/api/texts/:id', authenticateToken, handle(textController.updateText, textController));

// Delete text document
router.delete('/api/texts/:id', authenticateToken, handle(textController.deleteText, textController));

export default router;
