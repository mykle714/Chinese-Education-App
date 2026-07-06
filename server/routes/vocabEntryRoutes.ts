import { Router } from 'express';
import multer from 'multer';
import { authenticateToken } from '../authMiddleware.js';
import { vocabEntryController } from '../dal/setup.js';

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
// @ts-ignore
router.get('/api/vocabEntries', authenticateToken, async (req, res) => {
  await vocabEntryController.getAllEntries(req, res);
});

// Get paginated vocab entries
// @ts-ignore
router.get('/api/vocabEntries/paginated', authenticateToken, async (req, res) => {
  await vocabEntryController.getPaginatedEntries(req, res);
});

// Search vocab entries
// @ts-ignore
router.get('/api/vocabEntries/search', authenticateToken, async (req, res) => {
  await vocabEntryController.searchEntries(req, res);
});

// Create new vocab entry
// @ts-ignore
router.post('/api/vocabEntries', authenticateToken, async (req, res) => {
  await vocabEntryController.createEntry(req, res);
});

// Add a dictionary entry to the user's library (idempotent; handles already-in-library,
// skip → library, and unsorted → library). Used by the dictionary EIP "+" button.
// @ts-ignore
router.post('/api/vocabEntries/add-to-library', authenticateToken, async (req, res) => {
  await vocabEntryController.addToLibrary(req, res);
});

// Import vocab entries from CSV file
// @ts-ignore
router.post('/api/vocabEntries/import', authenticateToken, upload.single('file'), async (req, res) => {
  await vocabEntryController.importFromCSV(req, res);
});

// Get vocab entries by tokens
// @ts-ignore
router.post('/api/vocabEntries/by-tokens', authenticateToken, async (req, res) => {
  await vocabEntryController.getEntriesByTokens(req, res);
});

// Get vocab entry by ID
// @ts-ignore
router.get('/api/vocabEntries/:id', authenticateToken, async (req, res) => {
  await vocabEntryController.getEntryById(req, res);
});

// Update vocab entry
// @ts-ignore
router.put('/api/vocabEntries/:id', authenticateToken, async (req, res) => {
  await vocabEntryController.updateEntry(req, res);
});

// Persist (or clear) a custom flashcard icon arrangement for one vet row.
// body: { iconLayout: Item[] | null }. See docs/CARD_ICON_LAYOUT.md.
// @ts-ignore
router.patch('/api/vocabEntries/:id/icon-layout', authenticateToken, async (req, res) => {
  await vocabEntryController.updateIconLayout(req, res);
});

// Persist (or clear) the chosen definition-cluster sense for one vet row.
// body: { selectedSense: string | null }. See docs/DEFINITION_CLUSTERS.md.
// @ts-ignore
router.patch('/api/vocabEntries/:id/selected-sense', authenticateToken, async (req, res) => {
  await vocabEntryController.updateSelectedSense(req, res);
});

// Delete vocab entry
// @ts-ignore
router.delete('/api/vocabEntries/:id', authenticateToken, async (req, res) => {
  await vocabEntryController.deleteEntry(req, res);
});

export default router;
