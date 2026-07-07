import { Router } from 'express';
import { authenticateToken } from '../authMiddleware.js';
import { userController, userMinutePointsController, winsController } from '../dal/setup.js';

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
// @ts-ignore
router.get('/api/users', authenticateToken, async (req, res) => {
  await userController.getAllUsers(req, res);
});

// Create new user (admin only)
// @ts-ignore
router.post('/api/users', authenticateToken, async (req, res) => {
  await userController.createUser(req, res);
});

// Update user preferred language
// @ts-ignore
router.put('/api/users/language', authenticateToken, async (req, res) => {
  await userController.updateLanguage(req, res);
});

// Update the user's profile avatar (icons8 icon id, or null to clear)
// @ts-ignore
router.put('/api/users/avatar', authenticateToken, async (req, res) => {
  await userController.updateAvatar(req, res);
});

// Update the account's mastery goal flags (reading/writing). See docs/MASTERY_REWORK.md
// @ts-ignore
router.put('/api/users/goals', authenticateToken, async (req, res) => {
  await userController.updateGoals(req, res);
});

// Minute Points — increment by 1
// @ts-ignore
router.post('/api/users/minute-points/increment', authenticateToken, async (req, res) => {
  await userMinutePointsController.incrementMinutePoints(req, res);
});

// Minute Points — calendar of minutes earned + penalties for a given month
// @ts-ignore
router.get('/api/users/minute-points/calendar/:yearMonth', authenticateToken, async (req, res) => {
  await userMinutePointsController.getCalendar(req, res);
});

// Minute Points — per-language summary (lifetime total + today's minutes + global streak)
// @ts-ignore
router.get('/api/users/minute-points/summary', authenticateToken, async (req, res) => {
  await userMinutePointsController.getSummary(req, res);
});

// Game wins (append-only lifetime log; "this week" is a timestamp filter).
// List this week's earned (game, level) badges + lifetime win counts.
// @ts-ignore
router.get('/api/users/me/wins', authenticateToken, async (req, res) => {
  await winsController.listWins(req, res);
});

// Record one win: body { game, level }.
// @ts-ignore
router.post('/api/users/me/wins', authenticateToken, async (req, res) => {
  await winsController.recordWin(req, res);
});

// Get user by ID (kept after the literal paths above)
// @ts-ignore
router.get('/api/users/:id', authenticateToken, async (req, res) => {
  await userController.getUserById(req, res);
});

// Get total minute points for a user
// @ts-ignore
router.get('/api/users/:id/total-minute-points', authenticateToken, async (req, res) => {
  await userController.getTotalMinutePoints(req, res);
});

export default router;
