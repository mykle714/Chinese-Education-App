import { Router } from 'express';
import { authenticateToken } from '../authMiddleware.js';
import { userController, userMinutePointsController, winsController } from '../dal/setup.js';
import { handle } from './asyncHandler.js';

/**
 * User routes — /api/users/* (profile, minute points, game wins)
 *
 * LAYER: HTTP route layer (registration only). Split out of server.ts; paths unchanged.
 *
 * Ordering note: the literal paths (/language, /avatar, /minute-points/*, /me/wins)
 * are registered before GET /api/users/:id so the param route can't shadow them.
 */
const router = Router();

// Get all users
router.get('/api/users', authenticateToken, handle(userController.getAllUsers, userController));

// Create new user (admin only)
router.post('/api/users', authenticateToken, handle(userController.createUser, userController));

// Update user preferred language
router.put('/api/users/language', authenticateToken, handle(userController.updateLanguage, userController));

// Update the user's profile avatar (icons8 icon id, or null to clear)
router.put('/api/users/avatar', authenticateToken, handle(userController.updateAvatar, userController));

// Update the account's mastery goal flags (reading/writing). See docs/MASTERY_REWORK.md
router.put('/api/users/goals', authenticateToken, handle(userController.updateGoals, userController));

// Update the account's display preferences (word spacing). See docs/EXAMPLE_SENTENCES.md
router.put('/api/users/displaySettings', authenticateToken, handle(userController.updateDisplaySettings, userController));

// Minute Points — increment by 1
router.post('/api/users/minutePoints/increment', authenticateToken, handle(userMinutePointsController.incrementMinutePoints, userMinutePointsController));

// Minute Points — calendar of minutes earned + penalties for a given month
router.get('/api/users/minutePoints/calendar/:yearMonth', authenticateToken, handle(userMinutePointsController.getCalendar, userMinutePointsController));

// Minute Points — per-language summary (lifetime total + today's minutes + global streak)
router.get('/api/users/minutePoints/summary', authenticateToken, handle(userMinutePointsController.getSummary, userMinutePointsController));

// Game wins (append-only lifetime log; "this week" is a timestamp filter).
// List this week's earned (game, level) badges + lifetime win counts.
router.get('/api/users/me/wins', authenticateToken, handle(winsController.listWins, winsController));

// Record one win: body { game, level }.
router.post('/api/users/me/wins', authenticateToken, handle(winsController.recordWin, winsController));

// Get user by ID (kept after the literal paths above)
router.get('/api/users/:id', authenticateToken, handle(userController.getUserById, userController));

// Get total minute points for a user
router.get('/api/users/:id/totalMinutePoints', authenticateToken, handle(userController.getTotalMinutePoints, userController));

export default router;
