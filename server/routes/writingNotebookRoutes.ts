import { Router } from 'express';
import { authenticateToken } from '../authMiddleware.js';
import { proxyLimiter } from '../middleware/rateLimits.js';
import { writingNotebookController } from '../dal/setup.js';
import { handle } from './asyncHandler.js';

/**
 * Writing Notebook routes — /api/writingNotebook/* (docs/WRITING_NOTEBOOK.md § "API").
 * LAYER: HTTP route layer (registration only). Mounted behind the `writingNotebook`
 * feature flag in server/server.ts.
 */
const router = Router();
const c = writingNotebookController;

router.get('/api/writingNotebook/summary', authenticateToken, handle(c.summary, c));
router.post('/api/writingNotebook/sheets/open', authenticateToken, handle(c.openSheet, c));
router.get('/api/writingNotebook/cells', authenticateToken, handle(c.listCells, c));
router.get('/api/writingNotebook/nextEmpty', authenticateToken, handle(c.nextEmpty, c));
// A cell save calls the third-party handwriting recogniser, so it carries the same
// quota guard as POST /api/handwriting/recognize.
router.put('/api/writingNotebook/cells/:cellIndex', authenticateToken, proxyLimiter, handle(c.saveCell, c));

export default router;
