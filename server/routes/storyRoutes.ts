import { Router } from 'express';
import { authenticateToken } from '../authMiddleware.js';
import { storyController } from '../dal/setup.js';
import { handle } from './asyncHandler.js';

/**
 * Adventures (cyoa) routes — /api/stories/*
 *
 * LAYER: HTTP route layer (registration only). Mounted in server/server.ts only when
 * FEATURE_FLAGS.cyoa is on (docs/FEATURE_FLAGS.md). The endpoint table is on
 * StoryController; design in docs/CYOA_FEATURE.md § 6.3.
 *
 * Every path below `/api/stories/:id` has a fixed trailing segment (`/play`, `/edit`,
 * `/passages`, …), so no parameterized route can swallow another — there is no bare
 * `GET /api/stories/:id` on purpose (learner and author reads are different shapes).
 */
const router = Router();

// ── Learner ──
router.get('/api/stories', authenticateToken, handle(storyController.list, storyController));
router.get('/api/stories/:id/play', authenticateToken, handle(storyController.play, storyController));
router.post('/api/stories/:id/choose', authenticateToken, handle(storyController.choose, storyController));

// ── Author ──
router.post('/api/stories', authenticateToken, handle(storyController.create, storyController));
router.get('/api/stories/:id/edit', authenticateToken, handle(storyController.getForEdit, storyController));
router.patch('/api/stories/:id', authenticateToken, handle(storyController.update, storyController));
router.delete('/api/stories/:id', authenticateToken, handle(storyController.remove, storyController));
router.post('/api/stories/:id/passages', authenticateToken, handle(storyController.createPassage, storyController));
// Registered BEFORE /passages/:passageId so "order" is never read as a passage id.
router.put('/api/stories/:id/passages/order', authenticateToken, handle(storyController.reorderPassages, storyController));
router.post('/api/stories/:id/passages/:passageId/duplicate', authenticateToken, handle(storyController.duplicatePassage, storyController));
router.put('/api/stories/:id/passages/:passageId', authenticateToken, handle(storyController.savePassage, storyController));
router.delete('/api/stories/:id/passages/:passageId', authenticateToken, handle(storyController.deletePassage, storyController));
router.post('/api/stories/:id/publish', authenticateToken, handle(storyController.publish, storyController));
router.post('/api/stories/:id/unpublish', authenticateToken, handle(storyController.unpublish, storyController));

export default router;
