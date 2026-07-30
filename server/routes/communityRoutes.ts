import { Router } from 'express';
import { authenticateToken } from '../authMiddleware.js';
import { communityLayoutController } from '../dal/setup.js';
import { handle } from './asyncHandler.js';

/**
 * Community routes — /api/community/*
 *
 * LAYER: HTTP route layer (registration only).
 *
 * Shareable advanced card-icon layouts. The three feeds are POST rather than GET so
 * the growing exclude lists aren't bound by URL length.
 *
 * Split out of gamesRoutes.ts (docs/ARCHITECTURE_REVIEW.md finding 10).
 * See docs/COMMUNITY_PAGE.md.
 */
const router = Router();

router.post('/api/community/learningFeed', authenticateToken, handle(communityLayoutController.learningFeed, communityLayoutController));
router.post('/api/community/topFeed', authenticateToken, handle(communityLayoutController.topFeed, communityLayoutController));
router.post('/api/community/entryFeed', authenticateToken, handle(communityLayoutController.entryFeed, communityLayoutController));
router.get('/api/community/myVotes', authenticateToken, handle(communityLayoutController.myVotes, communityLayoutController));
router.post('/api/community/vote', authenticateToken, handle(communityLayoutController.vote, communityLayoutController));
router.post('/api/community/unvote', authenticateToken, handle(communityLayoutController.unvote, communityLayoutController));
router.post('/api/community/applyDesign', authenticateToken, handle(communityLayoutController.applyDesign, communityLayoutController));

export default router;
