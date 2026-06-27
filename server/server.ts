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
import { VET_PHYSICAL_TABLES, vetTableForLanguage } from './dal/shared/vetTable.js';

// ES module equivalent of __dirname
const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

// Import DAL architecture
import { userController, vocabEntryController, onDeckVocabController, userMinutePointsController, textController, dictionaryController, starterPacksController, onDeckVocabService, nightMarketController, gamesController, icons8Controller, winsController, communityLayoutController } from './dal/setup.js';
import { leaderboardController } from './controllers/LeaderboardController.js';
import { ttsController } from './controllers/TTSController.js';
import { recognizeChinese, validateInk } from './utils/handwritingRecognizer.js';
import { recordCompletion, getCompletedLevels, isWritingPracticeLevel } from './utils/writingPracticeStore.js';
import { MODE_CONFIGS, type StudyMode } from './services/OnDeckVocabService.js';

// Configure multer for file uploads
const upload = multer({ 
  storage: multer.memoryStorage(),
  limits: {
    fileSize: 5 * 1024 * 1024 // 5MB limit
  }
});

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

// Add a dictionary entry to the user's library (idempotent; handles already-in-library,
// skip → library, and unsorted → library). Used by the dictionary EIP "+" button.
// @ts-ignore
app.post('/api/vocabEntries/add-to-library', authenticateToken, async (req, res) => {
  await vocabEntryController.addToLibrary(req, res);
});

// Persist (or clear) a custom flashcard icon arrangement for one vet row.
// body: { iconLayout: Item[] | null }. See docs/CARD_ICON_LAYOUT.md.
// @ts-ignore
app.patch('/api/vocabEntries/:id/icon-layout', authenticateToken, async (req, res) => {
  await vocabEntryController.updateIconLayout(req, res);
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

// Logout user — revokes the refresh token server-side, then clears both cookies.
// @ts-ignore
app.post('/api/auth/logout', async (req, res) => {
  await userController.logout(req, res);
});

// Refresh access token — exchanges the refresh-token cookie for a new access
// token (with refresh-token rotation). Deliberately NOT behind authenticateToken:
// the access token is expired by design at this point, so the refresh cookie is
// the credential the handler validates.
// @ts-ignore
app.post('/api/auth/refresh', async (req, res) => {
  await userController.refresh(req, res);
});

// Post-login hook — refresh tz and any other client-supplied session context
// @ts-ignore
app.post('/api/auth/on-login', authenticateToken, async (req, res) => {
  await userController.onLogin(req, res);
});

// ---------------------------------------------------------------------------
// Client performance diagnostics sink
// ---------------------------------------------------------------------------
// Receives batched interaction-latency telemetry from the browser (see
// src/utils/perfDiagnostics.ts). Used to diagnose the prod-only "buttons take
// 1–2s before working" lag on the mobile-demo footer/decks. Deliberately
// UNAUTHENTICATED: the payload arrives via navigator.sendBeacon, which cannot
// attach an Authorization header, and the lag also affects public/demo
// sessions. It only appends to a git-ignored JSONL log + prints a one-line
// summary; it never touches the database or returns data.
const CLIENT_PERF_LOG = path.join(__dirname, 'logs', 'client-perf.jsonl');
// @ts-ignore
app.post('/api/diagnostics/perf', (req, res) => {
  try {
    const body = req.body || {};
    const records = Array.isArray(body.records) ? body.records : [];
    // Cap to avoid a malicious/buggy client flooding the log in one request.
    if (records.length === 0 || records.length > 100) {
      return res.status(204).end();
    }

    const entry = {
      receivedAt: new Date().toISOString(),
      ip: req.headers['x-forwarded-for'] || req.socket?.remoteAddress,
      userAgent: typeof body.userAgent === 'string' ? body.userAgent.slice(0, 400) : undefined,
      deviceMemory: body.deviceMemory,
      hardwareConcurrency: body.hardwareConcurrency,
      connection: body.connection,
      records,
    };

    fs.mkdirSync(path.dirname(CLIENT_PERF_LOG), { recursive: true });
    fs.appendFile(CLIENT_PERF_LOG, JSON.stringify(entry) + '\n', () => {});

    // Compact console summary: the worst interaction in this batch, so prod logs
    // surface the lag without needing to open the JSONL.
    const worst = records
      .filter((r: any) => r && r.kind === 'interaction')
      .sort((a: any, b: any) => (b.duration || 0) - (a.duration || 0))[0];
    if (worst) {
      console.log(
        `⏱️  client-perf: ${worst.duration}ms on ${worst.path} ` +
        `[${worst.target || worst.name}] ` +
        `(inputDelay=${worst.inputDelay}ms, processing=${worst.processing}ms, present=${worst.presentation}ms)`
      );
    }

    // 204 keeps the beacon response empty; the client ignores the body anyway.
    return res.status(204).end();
  } catch (err) {
    console.error('Error handling client perf diagnostics:', err);
    return res.status(204).end();
  }
});

// Handwriting recognition proxy — converts canonical Ink to the Google Input
// Tools request, returns ranked candidate characters. Behind auth so it can't be
// abused as an open proxy to Google's endpoint. See docs/HANDWRITING_RECOGNITION.md
// and server/utils/handwritingRecognizer.ts (the only file touching Google).
// @ts-ignore
app.post('/api/handwriting/recognize', authenticateToken, async (req, res) => {
  try {
    const body = req.body || {};
    const width = Number(body.writingAreaWidth);
    const height = Number(body.writingAreaHeight);
    if (!Number.isFinite(width) || !Number.isFinite(height) || width <= 0 || height <= 0) {
      return res.status(400).json({
        error: 'writingAreaWidth and writingAreaHeight must be positive numbers',
        code: 'ERR_BAD_WRITING_AREA',
      });
    }

    let ink;
    try {
      ink = validateInk(body.ink);
    } catch (validationErr: any) {
      return res.status(400).json({ error: validationErr.message, code: 'ERR_BAD_INK' });
    }

    const candidates = await recognizeChinese(ink, width, height);
    // top1 is what the practice popup grades against (correct iff target === top1).
    return res.json({ candidates, top1: candidates[0] ?? null });
  } catch (err: any) {
    console.error('Error in handwriting recognition proxy:', err?.message || err);
    return res.status(502).json({ error: 'handwriting recognition failed', code: 'ERR_UPSTREAM' });
  }
});

// Writing-practice completions — read the completed levels for a character (drives
// the star in each popup tab + the star-count superscript on the practice button).
// @ts-ignore
app.get('/api/handwriting/completions', authenticateToken, async (req, res) => {
  try {
    const userId = (req as any).user?.userId;
    if (!userId) return res.status(401).json({ error: 'Unauthorized', code: 'ERR_UNAUTHORIZED' });
    const language = String(req.query.language || '');
    const entryKey = String(req.query.entryKey || '');
    if (!language || !entryKey) {
      return res.status(400).json({ error: 'language and entryKey are required', code: 'ERR_MISSING_FIELDS' });
    }
    const completedLevels = await getCompletedLevels(userId, language, entryKey);
    return res.json({ completedLevels });
  } catch (err: any) {
    console.error('Error fetching writing-practice completions:', err?.message || err);
    return res.status(500).json({ error: 'failed to fetch completions', code: 'ERR_DB' });
  }
});

// Record a first-time completion of a level for a character (idempotent). Returns
// the character's full completed-level set so the client updates stars in one hop.
// @ts-ignore
app.post('/api/handwriting/completions', authenticateToken, async (req, res) => {
  try {
    const userId = (req as any).user?.userId;
    if (!userId) return res.status(401).json({ error: 'Unauthorized', code: 'ERR_UNAUTHORIZED' });
    const { language, entryKey, level } = req.body || {};
    if (!language || !entryKey || !isWritingPracticeLevel(level)) {
      return res.status(400).json({
        error: 'language, entryKey, and a valid level are required',
        code: 'ERR_MISSING_FIELDS',
      });
    }
    const completedLevels = await recordCompletion(userId, language, entryKey, level);
    return res.json({ completedLevels });
  } catch (err: any) {
    console.error('Error recording writing-practice completion:', err?.message || err);
    return res.status(500).json({ error: 'failed to record completion', code: 'ERR_DB' });
  }
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

// Get total minute points for a user - USING NEW DAL ARCHITECTURE
// @ts-ignore
app.get('/api/users/:id/total-minute-points', authenticateToken, async (req, res) => {
  console.log('🔄 Using NEW DAL architecture for get total minute points');
  await userController.getTotalMinutePoints(req, res);
});

// Update user preferred language - USING NEW DAL ARCHITECTURE
// @ts-ignore
app.put('/api/users/language', authenticateToken, async (req, res) => {
  console.log('🔄 Using NEW DAL architecture for update user language');
  await userController.updateLanguage(req, res);
});

// Update the user's profile avatar (icons8 icon id, or null to clear)
// @ts-ignore
app.put('/api/users/avatar', authenticateToken, async (req, res) => {
  await userController.updateAvatar(req, res);
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

// Per-category library card counts (drives the decks page bucket counts)
// @ts-ignore
app.get('/api/onDeck/category-counts', authenticateToken, async (req, res) => {
  await onDeckVocabController.getCategoryCounts(req, res);
});

// Bubble-match game pool (15 Target + 10 Comfortable by default)
// @ts-ignore
app.get('/api/onDeck/game-pool', authenticateToken, async (req, res) => {
  await onDeckVocabController.getGamePool(req, res);
});

// Minute Points API Routes - USING NEW DAL ARCHITECTURE

// Increment minute points by 1
// @ts-ignore
app.post('/api/users/minute-points/increment', authenticateToken, async (req, res) => {
  await userMinutePointsController.incrementMinutePoints(req, res);
});

// Calendar of minutes earned + penalties for a given month
// @ts-ignore
app.get('/api/users/minute-points/calendar/:yearMonth', authenticateToken, async (req, res) => {
  await userMinutePointsController.getCalendar(req, res);
});

// Per-language summary (lifetime total + today's minutes + global streak)
// @ts-ignore
app.get('/api/users/minute-points/summary', authenticateToken, async (req, res) => {
  await userMinutePointsController.getSummary(req, res);
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

// Night Market API Routes

// Get user's unlocked night market items (seeds base set on first call)
// @ts-ignore
app.get('/api/night-market/unlocks', authenticateToken, async (req, res) => {
  await nightMarketController.getUnlocks(req, res);
});

// Unlock the next random night market item
// @ts-ignore
app.post('/api/night-market/unlock', authenticateToken, async (req, res) => {
  await nightMarketController.unlockNext(req, res);
});

// Games framework API Routes
// One controller serves all games; the :gameId path param scopes each request.

// List assets registered for a game (used by GameStage to preload textures)
// @ts-ignore
app.get('/api/games/:gameId/assets', authenticateToken, async (req, res) => {
  await gamesController.getAssets(req, res);
});

// Fetch the authenticated user's save state for a game
// @ts-ignore
app.get('/api/games/:gameId/progress', authenticateToken, async (req, res) => {
  await gamesController.getProgress(req, res);
});

// Upsert the authenticated user's save state for a game
// @ts-ignore
app.post('/api/games/:gameId/progress', authenticateToken, async (req, res) => {
  await gamesController.saveProgress(req, res);
});

// Game wins (append-only lifetime log; "this week" is a timestamp filter).
// List this week's earned (game, level) badges + lifetime win counts.
// @ts-ignore
app.get('/api/users/me/wins', authenticateToken, async (req, res) => {
  await winsController.listWins(req, res);
});

// Record one win: body { game, level }.
// @ts-ignore
app.post('/api/users/me/wins', authenticateToken, async (req, res) => {
  await winsController.recordWin(req, res);
});

// Community — shareable advanced card-icon layouts (docs/COMMUNITY_PAGE.md).
// Feeds are POST so the growing exclude lists aren't bound by URL length.
// @ts-ignore
app.post('/api/community/learning-feed', authenticateToken, async (req, res) => {
  await communityLayoutController.learningFeed(req, res);
});
// @ts-ignore
app.post('/api/community/top-feed', authenticateToken, async (req, res) => {
  await communityLayoutController.topFeed(req, res);
});
// @ts-ignore
app.get('/api/community/my-votes', authenticateToken, async (req, res) => {
  await communityLayoutController.myVotes(req, res);
});
// @ts-ignore
app.post('/api/community/vote', authenticateToken, async (req, res) => {
  await communityLayoutController.vote(req, res);
});
// @ts-ignore
app.post('/api/community/unvote', authenticateToken, async (req, res) => {
  await communityLayoutController.unvote(req, res);
});
// @ts-ignore
app.post('/api/community/apply-design', authenticateToken, async (req, res) => {
  await communityLayoutController.applyDesign(req, res);
});

// Flashcards API Routes - USING NEW DAL ARCHITECTURE

const DEFAULT_FLASHCARD_TIMEZONE = 'UTC';

function resolveUserTimeZone(rawTimeZone: unknown): string {
  if (typeof rawTimeZone !== 'string' || rawTimeZone.trim().length === 0) {
    return DEFAULT_FLASHCARD_TIMEZONE;
  }

  const timeZone = rawTimeZone.trim();
  try {
    // Validate IANA timezone string
    new Intl.DateTimeFormat('en-US', { timeZone }).format(new Date());
    return timeZone;
  } catch {
    return DEFAULT_FLASHCARD_TIMEZONE;
  }
}

// NOTE: category is no longer computed in app code. It is a GENERATED STORED column
// (migration 67) derived from markHistory by the SQL function compute_flashcard_category().
// The mark/undo endpoints read the freshly-derived value back via `RETURNING category`.

function calculateSuccessRates(markHistory: ReviewMark[], totalMarkCount: number, totalCorrectCount: number): {
  totalSuccessRate: number;
  last8SuccessRate: number;
  last16SuccessRate: number;
} {
  const totalSuccessRate = totalMarkCount > 0 ? totalCorrectCount / totalMarkCount : 0;
  const last8Marks: ReviewMark[] = markHistory.slice(-8);
  const last8Correct: number = last8Marks.filter(m => m.isCorrect).length;
  const last8SuccessRate = last8Marks.length > 0 ? last8Correct / last8Marks.length : 0;
  const last16Correct: number = markHistory.filter(m => m.isCorrect).length;
  const last16SuccessRate = markHistory.length > 0 ? last16Correct / markHistory.length : 0;

  return {
    totalSuccessRate,
    last8SuccessRate,
    last16SuccessRate
  };
}

// Mark a flashcard as correct or incorrect (protected route)
// @ts-ignore
app.post('/api/flashcards/mark', authenticateToken, async (req, res) => {
  const client = await db.getClient();
  
  try {
    const userId = (req as any).user?.userId;
    const { cardId, isCorrect, excludeIds: rawExcludeIds, mode: rawMode } = req.body;

    // Optional difficulty mode (Easy/Hard). When set, the replacement card must
    // stay within the mode's allowed categories so a banned category never leaks
    // back into the loop via a correct-mark refill.
    const mode: StudyMode | undefined =
      rawMode === 'easy' || rawMode === 'hard' ? rawMode : undefined;

    if (!userId) {
      client.release();
      return res.status(401).json({ error: 'Unauthorized', code: 'ERR_UNAUTHORIZED' });
    }

    if (typeof cardId !== 'number' || typeof isCorrect !== 'boolean') {
      client.release();
      return res.status(400).json({
        error: 'Invalid request body. Expected { cardId: number, isCorrect: boolean }',
        code: 'ERR_INVALID_REQUEST'
      });
    }

    // excludeIds is the list of card ids currently in the client's working loop,
    // so the replacement picker avoids handing back a duplicate.
    const excludeIds: number[] = Array.isArray(rawExcludeIds)
      ? rawExcludeIds.filter((n): n is number => typeof n === 'number')
      : [];

    console.log(`Card ${cardId} marked as ${isCorrect ? 'correct' : 'incorrect'} by user ${userId}`);

    // Fetch the current vocab entry to get its mark history, counts, rates, AND CURRENT CATEGORY
    // vet is split per language; the client sends only a cardId, so probe each
    // physical table (ids are globally unique) — exactly one holds the row.
    let entryResult: any = { rows: [] };
    for (const t of VET_PHYSICAL_TABLES) {
      const r = await client.query(
        `SELECT "markHistory", "totalMarkCount", "totalCorrectCount", "totalSuccessRate", "last8SuccessRate", "last16SuccessRate", "category", "language" FROM ${t} WHERE id = $1 AND "userId" = $2`,
        [cardId, userId]
      );
      if (r.rows.length > 0) { entryResult = r; break; }
    }

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
    // CAPTURE THE CATEGORY BEFORE THE MARK IS APPLIED
    const categoryBeforeMark: string = entryResult.rows[0].category || 'Unfamiliar';
    // The replacement card must be in the same language as the card just marked.
    const cardLanguage: string = entryResult.rows[0].language || 'zh';

    // Preserve the displaced oldest mark when history is already at capacity.
    const displacedMark: ReviewMark | null = existingHistory.length >= 16 ? existingHistory[0] : null;

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

    const {
      totalSuccessRate: newTotalSuccessRate,
      last8SuccessRate: newLast8SuccessRate,
      last16SuccessRate: newLast16SuccessRate
    } = calculateSuccessRates(updatedHistory, newTotalMarkCount, newTotalCorrectCount);

    // Update the database with new mark history, counts, and success rates.
    // `category` is a GENERATED column (migration 67) derived from markHistory, so
    // we never write it — instead RETURNING hands back the freshly-derived value.
    // We know the row's language (read above), so route to its per-language vet table.
    const updateQuery = `
      UPDATE ${vetTableForLanguage(cardLanguage)}
      SET "markHistory" = $1,
          "totalMarkCount" = $2,
          "totalCorrectCount" = $3,
          "totalSuccessRate" = $4,
          "last8SuccessRate" = $5,
          "last16SuccessRate" = $6
      WHERE id = $7 AND "userId" = $8
      RETURNING category
    `;
    const updateResult = await client.query(updateQuery, [
      JSON.stringify(updatedHistory),
      newTotalMarkCount,
      newTotalCorrectCount,
      newTotalSuccessRate,
      newLast8SuccessRate,
      newLast16SuccessRate,
      cardId,
      userId
    ]);
    const category: FlashcardCategory = updateResult.rows[0].category;

    console.log(`Updated card ${cardId}: ${updatedHistory.length} recent marks, total: ${newTotalMarkCount}, correct: ${newTotalCorrectCount}, rates: ${(newTotalSuccessRate * 100).toFixed(1)}% / ${(newLast8SuccessRate * 100).toFixed(1)}% / ${(newLast16SuccessRate * 100).toFixed(1)}%, category BEFORE: ${categoryBeforeMark}, category AFTER: ${category}`);

    // If correct, return a card from the same category as BEFORE the mark (with fallback priority).
    // In a mode session the replacement pool is capped to the mode's allowed categories.
    if (isCorrect) {
      const allowedCategories = mode ? MODE_CONFIGS[mode].allowed : undefined;
      const newCard = await onDeckVocabService.getNextLibraryCardWithFallback(userId, categoryBeforeMark, cardLanguage, excludeIds, allowedCategories);

      if (!newCard) {
        // In a mode session, "no eligible replacement" is the expected end-of-pool
        // state, not an error: return success with newCard:null so the client winds
        // the loop down ("no more easy/hard cards remaining"). Mix keeps the 404.
        if (mode) {
          client.release();
          return res.status(200).json({
            success: true,
            category,
            markTimestamp: newMark.timestamp,
            displacedMark,
            newCard: null,
          });
        }
        client.release();
        return res.status(404).json({
          error: 'No library cards available',
          code: 'ERR_NO_CARDS_AVAILABLE'
        });
      }

      console.log(`Returning ${newCard.category} card (ID: ${newCard.id}) for user who marked ${categoryBeforeMark} card correct`);

      // Pre-warm the TTS disk cache for the replacement card so its audio is a
      // guaranteed cache hit on the client's follow-up /api/tts/synthesize call.
      // Same graceful-degrade semantics as the working-loop endpoint.
      await onDeckVocabService.prewarmAudio([newCard]);

      client.release();
      return res.status(200).json({
        success: true,
        category,
        markTimestamp: newMark.timestamp,
        displacedMark,
        newCard
      });
    } else {
      // If incorrect, just return success with category
      client.release();
      return res.status(200).json({ 
        success: true,
        category,
        markTimestamp: newMark.timestamp,
        displacedMark
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

// Undo the most recently saved flashcard mark (protected route)
// @ts-ignore
app.post('/api/flashcards/undo-last-mark', authenticateToken, async (req, res) => {
  const client = await db.getClient();
  try {
    const userId = (req as any).user?.userId;
    const { cardId, markTimestamp, displacedMark } = req.body || {};

    if (!userId) {
      client.release();
      return res.status(401).json({ error: 'Unauthorized', code: 'ERR_UNAUTHORIZED' });
    }

    if (typeof cardId !== 'number' || typeof markTimestamp !== 'string') {
      client.release();
      return res.status(400).json({
        error: 'Invalid request body. Expected { cardId: number, markTimestamp: string }',
        code: 'ERR_INVALID_REQUEST'
      });
    }

    await client.query('BEGIN');

    // FOR UPDATE can't run against the union view, and we don't yet know the row's
    // language, so probe each per-language vet table; the one holding this id
    // returns (and locks) the row. ids are globally unique across the pair.
    let entryResult: any = { rows: [] };
    let lockedVetTable: string | null = null;
    for (const t of VET_PHYSICAL_TABLES) {
      const r = await client.query(
        `SELECT "markHistory", "totalMarkCount", "totalCorrectCount" FROM ${t} WHERE id = $1 AND "userId" = $2 FOR UPDATE`,
        [cardId, userId]
      );
      if (r.rows.length > 0) { entryResult = r; lockedVetTable = t; break; }
    }

    if (entryResult.rows.length === 0) {
      await client.query('ROLLBACK');
      client.release();
      return res.status(404).json({
        error: 'Vocab entry not found',
        code: 'ERR_ENTRY_NOT_FOUND'
      });
    }

    const existingHistory: ReviewMark[] = Array.isArray(entryResult.rows[0].markHistory) ? entryResult.rows[0].markHistory : [];
    if (existingHistory.length === 0) {
      await client.query('ROLLBACK');
      client.release();
      return res.status(409).json({
        error: 'No mark history available to undo',
        code: 'ERR_UNDO_NOT_AVAILABLE'
      });
    }

    const lastMark: ReviewMark = existingHistory[existingHistory.length - 1];
    if (lastMark.timestamp !== markTimestamp) {
      await client.query('ROLLBACK');
      client.release();
      return res.status(409).json({
        error: 'Undo target does not match the latest mark',
        code: 'ERR_UNDO_TARGET_MISMATCH'
      });
    }

    let revertedHistory: ReviewMark[] = existingHistory.slice(0, -1);
    const shouldRestoreDisplacedMark =
      displacedMark &&
      typeof displacedMark.timestamp === 'string' &&
      typeof displacedMark.isCorrect === 'boolean';

    if (shouldRestoreDisplacedMark) {
      revertedHistory = [displacedMark as ReviewMark, ...revertedHistory].slice(0, 16);
    }

    const currentTotalMarkCount: number = entryResult.rows[0].totalMarkCount || 0;
    const currentTotalCorrectCount: number = entryResult.rows[0].totalCorrectCount || 0;
    const newTotalMarkCount: number = Math.max(0, currentTotalMarkCount - 1);
    const newTotalCorrectCount: number = Math.max(0, currentTotalCorrectCount - (lastMark.isCorrect ? 1 : 0));
    const {
      totalSuccessRate,
      last8SuccessRate,
      last16SuccessRate
    } = calculateSuccessRates(revertedHistory, newTotalMarkCount, newTotalCorrectCount);

    // `category` is GENERATED from markHistory (migration 67) — never written here;
    // RETURNING gives back the value re-derived from the reverted history.
    const updateQuery = `
      UPDATE ${lockedVetTable}
      SET "markHistory" = $1,
          "totalMarkCount" = $2,
          "totalCorrectCount" = $3,
          "totalSuccessRate" = $4,
          "last8SuccessRate" = $5,
          "last16SuccessRate" = $6
      WHERE id = $7 AND "userId" = $8
      RETURNING category
    `;

    const updateResult = await client.query(updateQuery, [
      JSON.stringify(revertedHistory),
      newTotalMarkCount,
      newTotalCorrectCount,
      totalSuccessRate,
      last8SuccessRate,
      last16SuccessRate,
      cardId,
      userId
    ]);
    const category: FlashcardCategory = updateResult.rows[0].category;

    await client.query('COMMIT');
    client.release();
    return res.status(200).json({
      success: true,
      category
    });
  } catch (error: any) {
    try {
      await client.query('ROLLBACK');
    } catch (rollbackError) {
      console.error('Undo rollback failed:', rollbackError);
    }
    console.error('Error undoing flashcard mark:', error);
    client.release();
    return res.status(500).json({
      error: error.message || 'Failed to undo flashcard mark',
      code: error.code || 'ERR_UNDO_MARK_FAILED'
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

// (Removed POST /api/starter-packs/:language/more — replenishment is now folded into
// the POST /sort response, which returns the single replacement card for the queue.)

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

// Segment input text via GSA and return dictionary entries grouped by segment (protected route)
// @ts-ignore
app.get('/api/dictionary/segment', authenticateToken, async (req, res) => {
  await dictionaryController.segmentSearch(req, res);
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

// TTS: synthesize MP3 audio for a dictionary entry. Disk-cached with infinite TTL —
// once a given (voice, word) is on disk, all future requests are served from cache.
// @ts-ignore
app.post('/api/tts/synthesize', authenticateToken, async (req, res) => {
  await ttsController.synthesize(req, res);
});

// icons8 icon catalog: paginated list of downloaded icons for the avatar picker.
// Auth-gated — only logged-in users browse icons to set their avatar.
// @ts-ignore
app.get('/api/icons8', authenticateToken, async (req, res) => {
  await icons8Controller.listIcons(req, res);
});

// icons8 live search: proxy the icons8 API for the custom card icon layout's "add
// icon" dialog (docs/CARD_ICON_LAYOUT.md). Auth-gated. Returns ids+names only; tiles
// preview from the icons8 CDN and download-on-select via the ensure route below.
// @ts-ignore
app.get('/api/icons8/search', authenticateToken, async (req, res) => {
  await icons8Controller.searchIcons(req, res);
});

// icons8 default-results prefetch: return (and cache on first call) the icons8 search
// response for a card's default English query, so the picker shows results instantly on
// open. Auth-gated. Body { language, entryKey, pos?, term }. docs/CARD_ICON_LAYOUT.md
// @ts-ignore
app.post('/api/icons8/default-results', authenticateToken, async (req, res) => {
  await icons8Controller.defaultResults(req, res);
});

// icons8 download-on-select: cache an icon's SVG bytes locally so the image route can
// serve it. Auth-gated; idempotent. Called when a user picks a search result.
// @ts-ignore
app.post('/api/icons8/:iconId/ensure', authenticateToken, async (req, res) => {
  await icons8Controller.ensureIcon(req, res);
});

// icons8 icon image: stream the stored bytes for a downloaded icon by its icons8 id.
// PUBLIC (no auth) on purpose — loaded via <img src> in the discover flow, which can't
// attach an Authorization header; icons are non-sensitive public artwork. Served from
// icons8.assetBytes for now (see TODO(cdn) in Icons8Controller).
// @ts-ignore
app.get('/api/icons8/:iconId/image', async (req, res) => {
  await icons8Controller.getIconImage(req, res);
});

// Get changelog content
app.get('/api/changelog', (req, res) => {
  try {
    // Look for CHANGELOG.md in docs directory
    const possiblePaths = [
      path.join(__dirname, '..', 'docs', 'CHANGELOG.md'),  // Development: relative from server directory
      path.join('/app', 'docs', 'CHANGELOG.md')                  // Docker: mounted at /app
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
      console.error('Changelog file not found. Searched paths:', possiblePaths);
      return res.status(404).json({
        error: 'Changelog file not found'
      });
    }

    const fileContent = fs.readFileSync(changelogFilePath, 'utf-8');
    console.log(`Successfully loaded changelog from ${changelogFilePath}`);
    res.json({ content: fileContent });
  } catch (error: any) {
    console.error('Error fetching changelog:', error);
    res.status(500).json({
      error: 'Failed to retrieve changelog'
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
