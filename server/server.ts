import cors from 'cors';
import express from 'express';
import dotenv from 'dotenv';
import cookieParser from 'cookie-parser';
import multer from 'multer';
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import { authenticateToken } from './authMiddleware.js';
import { User, VocabEntry, VocabEntryCreateData, VocabEntryUpdateData, UserCreateData, UserLoginData, Text, ReviewMark, FlashcardCategory } from './types/index.js';
import db from './db.js';

// ES module equivalent of __dirname
const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

// Import DAL architecture
import { userController, vocabEntryController, onDeckVocabController, userWorkPointsController, textController, dictionaryController, starterPacksController, onDeckVocabService } from './dal/setup.js';
import { leaderboardController } from './controllers/LeaderboardController.js';

// Configure multer for file uploads
const upload = multer({ 
  storage: multer.memoryStorage(),
  limits: {
    fileSize: 5 * 1024 * 1024 // 5MB limit
  }
});

// CSV parsing function
function parseCSV(csvContent: string): { entryKey: string; entryValue: string }[] {
  const lines = csvContent.split('\n');
  const entries: { entryKey: string; entryValue: string }[] = [];
  
  // Skip header row (assuming first line is header)
  for (let i = 1; i < lines.length; i++) {
    const line = lines[i].trim();
    if (!line) continue;
    
    // Parse CSV line - handle quoted fields
    const fields = parseCSVLine(line);
    if (fields.length >= 2) {
      const entryKey = fields[0].trim();
      const entryValue = fields[1].trim();
      
      if (entryKey && entryValue) {
        entries.push({ entryKey, entryValue });
      }
    }
  }
  
  return entries;
}

// Helper function to parse a single CSV line with proper quote handling
function parseCSVLine(line: string): string[] {
  const fields: string[] = [];
  let current = '';
  let inQuotes = false;
  let i = 0;
  
  while (i < line.length) {
    const char = line[i];
    
    if (char === '"') {
      if (inQuotes && line[i + 1] === '"') {
        // Escaped quote
        current += '"';
        i += 2;
      } else {
        // Toggle quote state
        inQuotes = !inQuotes;
        i++;
      }
    } else if (char === ',' && !inQuotes) {
      // Field separator
      fields.push(current);
      current = '';
      i++;
    } else {
      current += char;
      i++;
    }
  }
  
  // Add the last field
  fields.push(current);
  
  return fields;
}

// Load environment variables
dotenv.config();

const app = express();
const PORT = parseInt(process.env.PORT || '5000');

// Enable CORS for all routes with credentials
app.use(cors({
  origin: function(origin, callback) {
    // Allow requests with no origin (like mobile apps or curl requests)
    if(!origin) return callback(null, true);
    
    // Define allowed origins
    const allowedOrigins = [
      process.env.CLIENT_URL || 'http://localhost:3000',
      'http://localhost:5175',  // Original frontend port
      'http://127.0.0.1:5175',  // Also allow 127.0.0.1 equivalent
      'http://localhost:5174',  // Vite dev server port
      'http://127.0.0.1:5174',  // Also allow 127.0.0.1 equivalent
      'http://localhost:5173',  // Fallback for development
      'http://127.0.0.1:5173',  // Also allow 127.0.0.1 equivalent for development
      'http://localhost:3000',  // Docker frontend development port
      'http://127.0.0.1:3000',  // Docker frontend development port
      'http://frontend:3000',   // Docker container networking
      'http://cow-frontend-local:3000', // Docker container name
      'http://mren.me', // Production domain
      'https://mren.me' // Production domain with HTTPS
    ];
    
    if(allowedOrigins.indexOf(origin) !== -1) {
      callback(null, true);
    } else {
      console.warn(`Origin ${origin} not allowed by CORS`);
      callback(null, false);
    }
  },
  credentials: true
}));

// Middleware to parse JSON bodies and cookies
app.use(express.json());
app.use(cookieParser());

// Add JWT secret to environment variables
process.env.JWT_SECRET = process.env.JWT_SECRET;

// Get all vocab entries - USING NEW DAL ARCHITECTURE
// @ts-ignore
app.get('/api/vocabEntries', authenticateToken, async (req, res) => {
  console.log('🔄 Using NEW DAL architecture for get all vocab entries');
  await vocabEntryController.getAllEntries(req, res);
});

// Get paginated vocab entries - USING NEW DAL ARCHITECTURE
// @ts-ignore
app.get('/api/vocabEntries/paginated', authenticateToken, async (req, res) => {
  console.log('🔄 Using NEW DAL architecture for get paginated vocab entries');
  await vocabEntryController.getPaginatedEntries(req, res);
});

// Search vocab entries - USING NEW DAL ARCHITECTURE
// @ts-ignore
app.get('/api/vocabEntries/search', authenticateToken, async (req, res) => {
  console.log('🔄 Using NEW DAL architecture for search vocab entries');
  await vocabEntryController.searchEntries(req, res);
});

// Get vocab entry by ID - USING NEW DAL ARCHITECTURE
// @ts-ignore
app.get('/api/vocabEntries/:id', authenticateToken, async (req, res) => {
  console.log('🔄 Using NEW DAL architecture for get vocab entry by ID');
  await vocabEntryController.getEntryById(req, res);
});

// Create new vocab entry - USING NEW DAL ARCHITECTURE
// @ts-ignore
app.post('/api/vocabEntries', authenticateToken, async (req, res) => {
  console.log('🔄 Using NEW DAL architecture for create vocab entry');
  await vocabEntryController.createEntry(req, res);
});

// Update vocab entry - USING NEW DAL ARCHITECTURE
// @ts-ignore
app.put('/api/vocabEntries/:id', authenticateToken, async (req, res) => {
  console.log('🔄 Using NEW DAL architecture for update vocab entry');
  await vocabEntryController.updateEntry(req, res);
});

// Delete vocab entry - USING NEW DAL ARCHITECTURE
// @ts-ignore
app.delete('/api/vocabEntries/:id', authenticateToken, async (req, res) => {
  console.log('🔄 Using NEW DAL architecture for delete vocab entry');
  await vocabEntryController.deleteEntry(req, res);
});

// Authentication routes
// Register a new user - USING NEW DAL ARCHITECTURE
// @ts-ignore
app.post('/api/auth/register', async (req, res) => {
  console.log('🔄 Using NEW DAL architecture for user registration');
  await userController.register(req, res);
});

// Login user - USING NEW DAL ARCHITECTURE
// @ts-ignore
app.post('/api/auth/login', async (req, res) => {
  console.log('🔄 Using NEW DAL architecture for login');
  await userController.login(req, res);
});

// Logout user
// @ts-ignore
app.post('/api/auth/logout', (req, res) => {
  res.clearCookie('token');
  res.status(200).json({ message: 'Logged out successfully' });
});

// Get current authenticated user - USING NEW DAL ARCHITECTURE
// @ts-ignore
app.get('/api/auth/me', authenticateToken, async (req, res) => {
  console.log('🔄 Using NEW DAL architecture for get current user');
  await userController.getCurrentUser(req, res);
});

// Change user password - USING NEW DAL ARCHITECTURE
// @ts-ignore
app.post('/api/auth/change-password', authenticateToken, async (req, res) => {
  console.log('🔄 Using NEW DAL architecture for change password');
  await userController.changePassword(req, res);
});

// Delete user account - USING NEW DAL ARCHITECTURE
// @ts-ignore
app.delete('/api/auth/delete-account', authenticateToken, async (req, res) => {
  console.log('🔄 Using NEW DAL architecture for delete account');
  await userController.deleteAccount(req, res);
});

// Get all users - USING NEW DAL ARCHITECTURE
// @ts-ignore
app.get('/api/users', authenticateToken, async (req, res) => {
  console.log('🔄 Using NEW DAL architecture for get all users');
  await userController.getAllUsers(req, res);
});

// Get user by ID - USING NEW DAL ARCHITECTURE
// @ts-ignore
app.get('/api/users/:id', authenticateToken, async (req, res) => {
  console.log('🔄 Using NEW DAL architecture for get user by ID');
  await userController.getUserById(req, res);
});

// Create new user (admin only) - USING NEW DAL ARCHITECTURE
// @ts-ignore
app.post('/api/users', authenticateToken, async (req, res) => {
  console.log('🔄 Using NEW DAL architecture for create user');
  await userController.createUser(req, res);
});

// Get total work points for a user - USING NEW DAL ARCHITECTURE
// @ts-ignore
app.get('/api/users/:id/total-work-points', authenticateToken, async (req, res) => {
  console.log('🔄 Using NEW DAL architecture for get total work points');
  await userController.getTotalWorkPoints(req, res);
});

// Update user preferred language - USING NEW DAL ARCHITECTURE
// @ts-ignore
app.put('/api/users/language', authenticateToken, async (req, res) => {
  console.log('🔄 Using NEW DAL architecture for update user language');
  await userController.updateLanguage(req, res);
});

// Text API Routes - USING NEW DAL ARCHITECTURE

// Get all texts for authenticated user (protected route)
// @ts-ignore
app.get('/api/texts', authenticateToken, async (req, res) => {
  console.log('🔄 Using NEW DAL architecture for get all texts');
  await textController.getAllTexts(req, res);
});

// Get text statistics for authenticated user (protected route)
// @ts-ignore
app.get('/api/texts/stats', authenticateToken, async (req, res) => {
  console.log('🔄 Using NEW DAL architecture for get text stats');
  await textController.getUserTextStats(req, res);
});

// Get a specific text by ID (protected route)
// @ts-ignore
app.get('/api/texts/:id', authenticateToken, async (req, res) => {
  console.log('🔄 Using NEW DAL architecture for get text by ID');
  await textController.getTextById(req, res);
});

// Create new text document (protected route)
// @ts-ignore
app.post('/api/texts', authenticateToken, async (req, res) => {
  console.log('🔄 Using NEW DAL architecture for create text');
  await textController.createText(req, res);
});

// Update text document (protected route)
// @ts-ignore
app.put('/api/texts/:id', authenticateToken, async (req, res) => {
  console.log('🔄 Using NEW DAL architecture for update text');
  await textController.updateText(req, res);
});

// Delete text document (protected route)
// @ts-ignore
app.delete('/api/texts/:id', authenticateToken, async (req, res) => {
  console.log('🔄 Using NEW DAL architecture for delete text');
  await textController.deleteText(req, res);
});

// Import vocab entries from CSV file - USING NEW DAL ARCHITECTURE
// @ts-ignore
app.post('/api/vocabEntries/import', authenticateToken, upload.single('file'), async (req, res) => {
  console.log('🔄 Using NEW DAL architecture for CSV import');
  await vocabEntryController.importFromCSV(req, res);
});

// Get vocab entries by tokens - USING NEW DAL ARCHITECTURE
// @ts-ignore
app.post('/api/vocabEntries/by-tokens', authenticateToken, async (req, res) => {
  console.log('🔄 Using NEW DAL architecture for token-based vocab lookup');
  await vocabEntryController.getEntriesByTokens(req, res);
});

// OnDeck Vocab Sets API Routes - USING NEW DAL ARCHITECTURE

// Get all library cards (vocab entries from *-library OnDeck sets)
// @ts-ignore
app.get('/api/onDeck/library-cards', authenticateToken, async (req, res) => {
  console.log('🔄 Using NEW DAL architecture for OnDeck getLibraryCards');
  await onDeckVocabController.getLibraryCards(req, res);
});

// Get all learn later cards (vocab entries from *-learn-later OnDeck sets)
// @ts-ignore
app.get('/api/onDeck/learn-later-cards', authenticateToken, async (req, res) => {
  console.log('🔄 Using NEW DAL architecture for OnDeck getLearnLaterCards');
  await onDeckVocabController.getLearnLaterCards(req, res);
});

// Get mastered library cards (library cards with category = 'Mastered')
// @ts-ignore
app.get('/api/onDeck/mastered-library-cards', authenticateToken, async (req, res) => {
  console.log('🔄 Using NEW DAL architecture for OnDeck getMasteredLibraryCards');
  await onDeckVocabController.getMasteredLibraryCards(req, res);
});

// Get non-mastered library cards (library cards without category = 'Mastered')
// @ts-ignore
app.get('/api/onDeck/non-mastered-library-cards', authenticateToken, async (req, res) => {
  console.log('🔄 Using NEW DAL architecture for OnDeck getNonMasteredLibraryCards');
  await onDeckVocabController.getNonMasteredLibraryCards(req, res);
});

// Get distributed working loop (1 Mastered, 2 Comfortable, 2 Unfamiliar, 5 Target)
// @ts-ignore
app.get('/api/onDeck/distributed-working-loop', authenticateToken, async (req, res) => {
  console.log('🔄 Using NEW DAL architecture for OnDeck getDistributedWorkingLoop');
  await onDeckVocabController.getDistributedWorkingLoop(req, res);
});

// Get all on-deck vocab sets for authenticated user (protected route)
// @ts-ignore
app.get('/api/onDeckPage', authenticateToken, async (req, res) => {
  console.log('🔄 Using NEW DAL architecture for OnDeck getAllSets');
  await onDeckVocabController.getAllSets(req, res);
});

// Get a specific on-deck vocab set by feature name (protected route)
// @ts-ignore
app.get('/api/onDeckPage/:featureName', authenticateToken, async (req, res) => {
  console.log('🔄 Using NEW DAL architecture for OnDeck getSetByFeatureName');
  await onDeckVocabController.getSetByFeatureName(req, res);
});

// Create or update an on-deck vocab set (protected route)
// @ts-ignore
app.put('/api/onDeckPage/:featureName', authenticateToken, async (req, res) => {
  console.log('🔄 Using NEW DAL architecture for OnDeck createOrUpdateSet');
  await onDeckVocabController.createOrUpdateSet(req, res);
});

// Delete an on-deck vocab set (protected route)
// @ts-ignore
app.delete('/api/onDeckPage/:featureName', authenticateToken, async (req, res) => {
  console.log('🔄 Using NEW DAL architecture for OnDeck deleteSet');
  await onDeckVocabController.deleteSet(req, res);
});

// Get user's on-deck set statistics (protected route)
// @ts-ignore
app.get('/api/onDeckPage/stats', authenticateToken, async (req, res) => {
  console.log('🔄 Using NEW DAL architecture for OnDeck getUserStats');
  await onDeckVocabController.getUserStats(req, res);
});

// Get all feature names for the user (protected route)
// @ts-ignore
app.get('/api/onDeckPage/features', authenticateToken, async (req, res) => {
  console.log('🔄 Using NEW DAL architecture for OnDeck getFeatureNames');
  await onDeckVocabController.getFeatureNames(req, res);
});

// Add entries to an existing set (protected route)
// @ts-ignore
app.post('/api/onDeckPage/:featureName/add', authenticateToken, async (req, res) => {
  console.log('🔄 Using NEW DAL architecture for OnDeck addEntriesToSet');
  await onDeckVocabController.addEntriesToSet(req, res);
});

// Remove entries from an existing set (protected route)
// @ts-ignore
app.post('/api/onDeckPage/:featureName/remove', authenticateToken, async (req, res) => {
  console.log('🔄 Using NEW DAL architecture for OnDeck removeEntriesFromSet');
  await onDeckVocabController.removeEntriesFromSet(req, res);
});

// Clear all entries from a set (protected route)
// @ts-ignore
app.post('/api/onDeckPage/:featureName/clear', authenticateToken, async (req, res) => {
  console.log('🔄 Using NEW DAL architecture for OnDeck clearSet');
  await onDeckVocabController.clearSet(req, res);
});

// Work Points API Routes - USING NEW DAL ARCHITECTURE

// NEW: Increment work points by 1 (replaces sync)
// @ts-ignore
app.post('/api/users/work-points/increment', authenticateToken, async (req, res) => {
  console.log('🔄 Using NEW DAL architecture for work points increment');
  await userWorkPointsController.incrementWorkPoints(req, res);
});

// DEPRECATED: Sync work points (main milestone sync endpoint)
// This endpoint is deprecated. Use /api/users/work-points/increment instead
// @ts-ignore
app.post('/api/users/work-points/sync', authenticateToken, async (req, res) => {
  console.log('⚠️  DEPRECATED: Using old sync endpoint. Please migrate to /increment');
  await userWorkPointsController.syncWorkPoints(req, res);
});

// Get calendar data for work points visualization
// @ts-ignore
app.get('/api/users/work-points/calendar/:month', authenticateToken, async (req, res) => {
  console.log('🔄 Using NEW DAL architecture for calendar data');
  await userWorkPointsController.getCalendarData(req, res);
});

// Leaderboard API Routes - USING NEW DAL ARCHITECTURE

// Get leaderboard data (protected route)
// @ts-ignore
app.get('/api/leaderboard', authenticateToken, async (req, res) => {
  console.log('🔄 Using NEW DAL architecture for leaderboard');
  await leaderboardController.getLeaderboard(req, res);
});

// Get top N users from leaderboard (protected route)
// @ts-ignore
app.get('/api/leaderboard/top/:limit', authenticateToken, async (req, res) => {
  console.log('🔄 Using NEW DAL architecture for top users leaderboard');
  await leaderboardController.getTopUsers(req, res);
});

// Get leaderboard with specific user highlighted (protected route)
// @ts-ignore
app.get('/api/leaderboard/user/:userId', authenticateToken, async (req, res) => {
  console.log('🔄 Using NEW DAL architecture for user-specific leaderboard');
  await leaderboardController.getLeaderboardForUser(req, res);
});

// Flashcards API Routes - USING NEW DAL ARCHITECTURE

// Mark a flashcard as correct or incorrect (protected route)
// @ts-ignore
app.post('/api/flashcards/mark', authenticateToken, async (req, res) => {
  const client = await db.getClient();
  
  try {
    const userId = (req as any).user?.userId;
    const { cardId, isCorrect } = req.body;

    if (!userId) {
      return res.status(401).json({ error: 'Unauthorized', code: 'ERR_UNAUTHORIZED' });
    }

    if (typeof cardId !== 'number' || typeof isCorrect !== 'boolean') {
      return res.status(400).json({ 
        error: 'Invalid request body. Expected { cardId: number, isCorrect: boolean }',
        code: 'ERR_INVALID_REQUEST'
      });
    }

    console.log(`Card ${cardId} marked as ${isCorrect ? 'correct' : 'incorrect'} by user ${userId}`);

    // Fetch the current vocab entry to get its mark history, counts, rates, AND CURRENT CATEGORY
    const entryQuery = 'SELECT "markHistory", "totalMarkCount", "totalCorrectCount", "totalSuccessRate", "last8SuccessRate", "last16SuccessRate", "category" FROM vocabentries WHERE id = $1 AND "userId" = $2';
    const entryResult = await client.query(entryQuery, [cardId, userId]);

    if (entryResult.rows.length === 0) {
      client.release();
      return res.status(404).json({ 
        error: 'Vocab entry not found',
        code: 'ERR_ENTRY_NOT_FOUND'
      });
    }

    // Get existing mark history or initialize empty array
    const existingHistory: ReviewMark[] = entryResult.rows[0].markHistory || [];
    
    // Get current counts and rates
    const currentTotalMarkCount: number = entryResult.rows[0].totalMarkCount || 0;
    const currentTotalCorrectCount: number = entryResult.rows[0].totalCorrectCount || 0;
    const currentTotalSuccessRate: number | null = entryResult.rows[0].totalSuccessRate;
    const currentLast8SuccessRate: number | null = entryResult.rows[0].last8SuccessRate;
    const currentLast16SuccessRate: number | null = entryResult.rows[0].last16SuccessRate;
    
    // CAPTURE THE CATEGORY BEFORE THE MARK IS APPLIED
    const categoryBeforeMark: string = entryResult.rows[0].category || 'Unfamiliar';

    // Add new mark
    const newMark: ReviewMark = {
      timestamp: new Date().toISOString(),
      isCorrect
    };

    // Append new mark and keep only last 16
    const updatedHistory = [...existingHistory, newMark].slice(-16);

    // Calculate new counts
    const newTotalMarkCount: number = currentTotalMarkCount + 1;
    const newTotalCorrectCount: number = currentTotalCorrectCount + (isCorrect ? 1 : 0);

    // Calculate success rates
    const newTotalSuccessRate: number = newTotalCorrectCount / newTotalMarkCount;
    
    // Calculate last8SuccessRate from last 8 marks
    const last8Marks: ReviewMark[] = updatedHistory.slice(-8);
    const last8Correct: number = last8Marks.filter(m => m.isCorrect).length;
    const newLast8SuccessRate: number = last8Marks.length > 0 ? last8Correct / last8Marks.length : 0;
    
    // Calculate last16SuccessRate from all available marks (up to 16)
    const last16Correct: number = updatedHistory.filter(m => m.isCorrect).length;
    const newLast16SuccessRate: number = updatedHistory.length > 0 ? last16Correct / updatedHistory.length : 0;

    // Determine category based on last 8 performance (with zero-padding)
    // Always treat as out of 8, padding remaining spots with incorrect marks
    let category: FlashcardCategory;
    
    if (last8Correct <= 2) {
      category = FlashcardCategory.UNFAMILIAR;
    } else if (last8Correct <= 5) {
      category = FlashcardCategory.TARGET;
    } else if (last8Correct <= 7) {
      category = FlashcardCategory.COMFORTABLE;
    } else { // last8Correct === 8
      category = FlashcardCategory.MASTERED;
    }

    // Update the database with new mark history, counts, success rates, and category
    const updateQuery = `
      UPDATE vocabentries 
      SET "markHistory" = $1, 
          "totalMarkCount" = $2,
          "totalCorrectCount" = $3,
          "totalSuccessRate" = $4,
          "last8SuccessRate" = $5,
          "last16SuccessRate" = $6,
          category = $7
      WHERE id = $8 AND "userId" = $9
    `;
    await client.query(updateQuery, [
      JSON.stringify(updatedHistory), 
      newTotalMarkCount,
      newTotalCorrectCount,
      newTotalSuccessRate,
      newLast8SuccessRate,
      newLast16SuccessRate,
      category,
      cardId, 
      userId
    ]);

    console.log(`Updated card ${cardId}: ${updatedHistory.length} recent marks, total: ${newTotalMarkCount}, correct: ${newTotalCorrectCount}, rates: ${(newTotalSuccessRate * 100).toFixed(1)}% / ${(newLast8SuccessRate * 100).toFixed(1)}% / ${(newLast16SuccessRate * 100).toFixed(1)}%, category BEFORE: ${categoryBeforeMark}, category AFTER: ${category}`);

    // If correct, return a card from the same category as BEFORE the mark (with fallback priority)
    if (isCorrect) {
      const newCard = await onDeckVocabService.getNextLibraryCardWithFallback(userId, categoryBeforeMark);
      
      if (!newCard) {
        client.release();
        return res.status(404).json({ 
          error: 'No library cards available',
          code: 'ERR_NO_CARDS_AVAILABLE'
        });
      }

      console.log(`Returning ${newCard.category} card (ID: ${newCard.id}) for user who marked ${categoryBeforeMark} card correct`);

      client.release();
      return res.status(200).json({ 
        success: true,
        category,
        newCard 
      });
    } else {
      // If incorrect, just return success with category
      client.release();
      return res.status(200).json({ 
        success: true,
        category
      });
    }
  } catch (error: any) {
    console.error('Error marking flashcard:', error);
    client.release();
    res.status(500).json({ 
      error: error.message || 'Failed to mark flashcard',
      code: error.code || 'ERR_MARK_FAILED'
    });
  }
});

// Starter Packs API Routes - USING NEW DAL ARCHITECTURE

// Get starter pack cards for a specific language (protected route)
// @ts-ignore
app.get('/api/starter-packs/:language', authenticateToken, async (req, res) => {
  console.log('🔄 Using NEW DAL architecture for get starter pack cards');
  await starterPacksController.getStarterPackCards(req, res);
});

// Get user's progress on a starter pack (protected route)
// @ts-ignore
app.get('/api/starter-packs/:language/progress', authenticateToken, async (req, res) => {
  console.log('🔄 Using NEW DAL architecture for get starter pack progress');
  await starterPacksController.getProgress(req, res);
});

// Sort a card into a bucket (protected route)
// @ts-ignore
app.post('/api/starter-packs/sort', authenticateToken, async (req, res) => {
  console.log('🔄 Using NEW DAL architecture for sort card');
  await starterPacksController.sortCard(req, res);
});

// Undo last card sort (protected route)
// @ts-ignore
app.post('/api/starter-packs/undo', authenticateToken, async (req, res) => {
  console.log('🔄 Using NEW DAL architecture for undo sort');
  await starterPacksController.undoSort(req, res);
});

// Dictionary API Routes - USING NEW DAL ARCHITECTURE

// Search dictionary entries with pagination (protected route)
// @ts-ignore
app.get('/api/dictionary/search', authenticateToken, async (req, res) => {
  console.log('🔄 Using NEW DAL architecture for dictionary search');
  await dictionaryController.search(req, res);
});

// Lookup dictionary term by exact match (protected route)
// @ts-ignore
app.get('/api/dictionary/lookup/:term', authenticateToken, async (req, res) => {
  console.log('🔄 Using NEW DAL architecture for dictionary lookup');
  await dictionaryController.lookupTerm(req, res);
});

// Get total dictionary entry count (protected route)
// @ts-ignore
app.get('/api/dictionary/count', authenticateToken, async (req, res) => {
  console.log('🔄 Using NEW DAL architecture for dictionary count');
  await dictionaryController.getCount(req, res);
});

// Get changelog content
app.get('/api/changelog', (req, res) => {
  try {
    // Try multiple possible paths for the changelog file in Docker environment
    const possiblePaths = [
      path.join('/app/project-root', 'CHANGELOG.md'),          // Docker mounted project root
      path.join(process.cwd(), '..', 'CHANGELOG.md'),          // Original path
      path.join(process.cwd(), 'CHANGELOG.md'),                // Same level as server
      path.join(__dirname, '..', '..', 'CHANGELOG.md'),        // Using __dirname
      path.join('/app', 'CHANGELOG.md'),                       // Docker absolute path
      path.join('/home/cow', 'CHANGELOG.md')                   // Host absolute path
    ];

    let changelogFilePath = '';
    let fileFound = false;

    // Try each possible path
    for (const testPath of possiblePaths) {
      if (fs.existsSync(testPath)) {
        changelogFilePath = testPath;
        fileFound = true;
        console.log('Found changelog file at:', testPath);
        break;
      }
    }
    
    if (!fileFound) {
      console.error('Changelog file not found in any of the expected locations:', possiblePaths);
      return res.status(404).json({
        error: 'Changelog file not found',
        code: 'ERR_CHANGELOG_FILE_NOT_FOUND',
        debug: {
          cwd: process.cwd(),
          dirname: __dirname,
          searchedPaths: possiblePaths
        }
      });
    }

    const fileContent = fs.readFileSync(changelogFilePath, 'utf-8');
    
    console.log(`Successfully loaded changelog from ${changelogFilePath}`);
    res.json({ content: fileContent });
  } catch (error: any) {
    console.error('Error fetching changelog:', error);
    const errorCode = error.code || 'ERR_FETCH_CHANGELOG_FAILED';
    const errorMessage = error.message || 'Failed to retrieve changelog';
    res.status(error.statusCode || 500).json({
      error: errorMessage,
      code: errorCode,
      debug: {
        cwd: process.cwd(),
        dirname: __dirname
      }
    });
  }
});

// Health check endpoint for Docker
app.get('/api/health', (req, res) => {
  res.status(200).json({ 
    status: 'healthy', 
    timestamp: new Date().toISOString(),
    uptime: process.uptime()
  });
});

// Start the server - bind to 0.0.0.0 to accept connections from all interfaces (required for Docker networking)
app.listen(PORT, '0.0.0.0', () => {
  console.log(`Server running on port ${PORT} on all interfaces (0.0.0.0)`);
});
