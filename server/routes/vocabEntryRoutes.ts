import { Router } from 'express';
import { authenticateToken } from '../authMiddleware.js';
import { vocabEntryController } from '../dal/setup.js';
import { handle } from './asyncHandler.js';

/**
 * Vocab entry routes — /api/vocabEntries/*
 *
 * LAYER: HTTP route layer (registration only). Split out of server.ts; paths unchanged.
 *
 * Ordering note: literal paths (/addToLibrary, /libraryStatus, /removeFromLibrary,
 * /byTokens) are registered before the /:id param routes so they can't be shadowed.
 * (The list / paginated / search / create / CSV-import routes were deleted
 * 2026-11-23 — no client called them.)
 */
const router = Router();

// Add a dictionary entry to the user's library (idempotent; handles already-in-library,
// skip → library, and unsorted → library). Used by the dictionary EIP "+" button.
router.post('/api/vocabEntries/addToLibrary', authenticateToken, handle(vocabEntryController.addToLibrary, vocabEntryController));

// Learning membership + non-destructive removal (demotes to 'tracked'). Used by the
// dictionary cdp's add/added toggle. Literal paths — must stay above /:id.
router.get('/api/vocabEntries/libraryStatus', authenticateToken, handle(vocabEntryController.getLibraryStatus, vocabEntryController));
router.post('/api/vocabEntries/removeFromLibrary', authenticateToken, handle(vocabEntryController.removeFromLibrary, vocabEntryController));

// Get vocab entries by tokens
router.post('/api/vocabEntries/byTokens', authenticateToken, handle(vocabEntryController.getEntriesByTokens, vocabEntryController));

// Get vocab entry by ID
router.get('/api/vocabEntries/:id', authenticateToken, handle(vocabEntryController.getEntryById, vocabEntryController));

// Update vocab entry
router.put('/api/vocabEntries/:id', authenticateToken, handle(vocabEntryController.updateEntry, vocabEntryController));

// Persist (or clear) a custom flashcard icon arrangement for one vet row.
// body: { iconLayout: Item[] | null }. See docs/CARD_ICON_LAYOUT.md.
router.patch('/api/vocabEntries/:id/iconLayout', authenticateToken, handle(vocabEntryController.updateIconLayout, vocabEntryController));

// Persist (or clear) the chosen definition-cluster sense for one vet row.
// body: { selectedSense: string | null }. See docs/DEFINITION_CLUSTERS.md.
router.patch('/api/vocabEntries/:id/selectedSense', authenticateToken, handle(vocabEntryController.updateSelectedSense, vocabEntryController));

// No DELETE route: a card is never hard-deleted. Removing one from Learning demotes it
// to 'tracked' (POST /api/vocabEntries/removeFromLibrary) so its history survives.

export default router;
