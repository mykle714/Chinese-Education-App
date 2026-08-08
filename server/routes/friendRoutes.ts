import { Router } from 'express';
import { authenticateToken } from '../authMiddleware.js';
import { friendsController } from '../dal/setup.js';
import { handle } from './asyncHandler.js';

/**
 * Friend routes — /api/friends/*
 *
 * LAYER: HTTP route layer (registration only). See docs/FRIENDS_FEATURE.md.
 *
 * ⚠️ ORDERING MATTERS HERE. `DELETE /api/friends/:friendUserId` would swallow
 * `DELETE /api/friends/requests/:id` if it were registered first — "requests"
 * is a legal value for a `:friendUserId` segment. Every `/requests` route is
 * therefore declared ABOVE the parameterized friend routes. (The service also
 * rejects a non-UUID `:friendUserId`, so a mis-ordered match would 400 rather
 * than delete something, but ordering is the real guarantee.)
 */
const router = Router();

// ── Pending requests ──
router.get('/api/friends/requests/incoming', authenticateToken, handle(friendsController.getIncomingRequests, friendsController));
router.get('/api/friends/requests/outgoing', authenticateToken, handle(friendsController.getOutgoingRequests, friendsController));
router.post('/api/friends/requests', authenticateToken, handle(friendsController.sendRequest, friendsController));
router.post('/api/friends/requests/:id/accept', authenticateToken, handle(friendsController.acceptRequest, friendsController));
// Decline (caller is the addressee) and revoke (caller is the requester) are the
// same delete; the service decides which one the caller is entitled to.
router.delete('/api/friends/requests/:id', authenticateToken, handle(friendsController.deleteRequest, friendsController));

// ── The friend list itself ──
router.get('/api/friends', authenticateToken, handle(friendsController.getFriends, friendsController));
router.delete('/api/friends/:friendUserId', authenticateToken, handle(friendsController.removeFriend, friendsController));

export default router;
