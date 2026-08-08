import { Router } from 'express';
import { authenticateToken } from '../authMiddleware.js';
import { decksController } from '../dal/setup.js';
import { handle } from './asyncHandler.js';

/**
 * Deck routes — /api/decks/*
 *
 * LAYER: HTTP route layer (registration only). See docs/DECKS_FEATURE.md.
 *
 * ⚠️ ORDERING MATTERS HERE, exactly as it does in friendRoutes.ts. Both
 * `/api/decks/memberships` routes MUST be declared above `/api/decks/:id`:
 * "memberships" is a legal value for an `:id` segment, so a mis-ordered GET would
 * be swallowed by the deck-cards route and answered with a 400 about an invalid
 * deck id. (The service does reject a non-numeric id, so the failure would be
 * loud rather than dangerous — but ordering is the real guarantee.)
 */
const router = Router();

// ── Card ↔ deck membership (the Add-to-deck checkbox menu) ──
router.get('/api/decks/memberships', authenticateToken, handle(decksController.getCardMemberships, decksController));
router.put('/api/decks/memberships', authenticateToken, handle(decksController.setCardMemberships, decksController));

// ── The decks themselves ──
router.get('/api/decks', authenticateToken, handle(decksController.getDecks, decksController));
router.post('/api/decks', authenticateToken, handle(decksController.createDeck, decksController));
router.get('/api/decks/:id/cards', authenticateToken, handle(decksController.getDeckCards, decksController));
router.patch('/api/decks/:id', authenticateToken, handle(decksController.updateDeck, decksController));
router.delete('/api/decks/:id', authenticateToken, handle(decksController.deleteDeck, decksController));

export default router;
