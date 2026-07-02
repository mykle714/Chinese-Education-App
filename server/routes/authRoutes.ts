import { Router } from 'express';
import { authenticateToken } from '../authMiddleware.js';
import { authLimiter, refreshLimiter } from '../middleware/rateLimits.js';
import { userController } from '../dal/setup.js';

/**
 * Auth routes — /api/auth/*
 *
 * LAYER: HTTP route layer (registration only — logic lives in UserController/UserService).
 * Split out of server.ts; paths are unchanged.
 *
 * Rate limiting: register/login sit behind authLimiter (bcrypt brute force);
 * refresh sits behind the looser refreshLimiter (legit clients refresh every
 * ~15 min per tab). See middleware/rateLimits.ts.
 */
const router = Router();

// Register a new user
// @ts-ignore
router.post('/api/auth/register', authLimiter, async (req, res) => {
  await userController.register(req, res);
});

// Login user
// @ts-ignore
router.post('/api/auth/login', authLimiter, async (req, res) => {
  await userController.login(req, res);
});

// Logout user — revokes the refresh token server-side, then clears both cookies.
// @ts-ignore
router.post('/api/auth/logout', async (req, res) => {
  await userController.logout(req, res);
});

// Refresh access token — exchanges the refresh-token cookie for a new access
// token (with refresh-token rotation). Deliberately NOT behind authenticateToken:
// the access token is expired by design at this point, so the refresh cookie is
// the credential the handler validates.
// @ts-ignore
router.post('/api/auth/refresh', refreshLimiter, async (req, res) => {
  await userController.refresh(req, res);
});

// Post-login hook — refresh tz and any other client-supplied session context
// @ts-ignore
router.post('/api/auth/on-login', authenticateToken, async (req, res) => {
  await userController.onLogin(req, res);
});

// Get current authenticated user
// @ts-ignore
router.get('/api/auth/me', authenticateToken, async (req, res) => {
  await userController.getCurrentUser(req, res);
});

// Change user password
// @ts-ignore
router.post('/api/auth/change-password', authenticateToken, async (req, res) => {
  await userController.changePassword(req, res);
});

// Delete user account
// @ts-ignore
router.delete('/api/auth/delete-account', authenticateToken, async (req, res) => {
  await userController.deleteAccount(req, res);
});

export default router;
