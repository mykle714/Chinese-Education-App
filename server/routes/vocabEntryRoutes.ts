import { Router } from 'express';
import multer from 'multer';
import { authenticateToken } from '../authMiddleware.js';
import { vocabEntryController } from '../dal/setup.js';
import { handle } from './asyncHandler.js';

/**
 * Vocab entry routes — /api/vocabEntries/*
 *
 * LAYER: HTTP route layer (registration only). Split out of server.ts; paths unchanged.
 *
 * Ordering note: literal paths (/paginated, /search, /add-to-library, /import,
 * /by-tokens) are registered before the /:id param routes so they can't be
 * shadowed.
 */
const router = Router();

// Multer only serves the CSV import on this router (in-memory, 5MB cap).
const upload = multer({
  storage: multer.memoryStorage(),
  limits: {
    fileSize: 5 * 1024 * 1024 // 5MB limit
  }
});

// Get all vocab entries
router.get('/api/vocabEntries', authenticateToken, handle(vocabEntryController.getAllEntries, vocabEntryController));

// Get paginated vocab entries
router.get('/api/vocabEntries/paginated', authenticateToken, handle(vocabEntryController.getPaginatedEntries, vocabEntryController));

// Search vocab entries
router.get('/api/vocabEntries/search', authenticateToken, handle(vocabEntryController.searchEntries, vocabEntryController));

// Create new vocab entry
router.post('/api/vocabEntries', authenticateToken, handle(vocabEntryController.createEntry, vocabEntryController));

// Add a dictionary entry to the user's library (idempotent; handles already-in-library,
// skip → library, and unsorted → library). Used by the dictionary EIP "+" button.
router.post('/api/vocabEntries/addToLibrary', authenticateToken, handle(vocabEntryController.addToLibrary, vocabEntryController));

// Import vocab entries from CSV file
router.post('/api/vocabEntries/import', authenticateToken, upload.single('file'), handle(vocabEntryController.importFromCSV, vocabEntryController));

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

// Delete vocab entry
router.delete('/api/vocabEntries/:id', authenticateToken, handle(vocabEntryController.deleteEntry, vocabEntryController));

export default router;
