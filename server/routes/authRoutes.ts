import { Router } from 'express';
import { authenticateToken } from '../authMiddleware.js';
import { authLimiter, refreshLimiter } from '../middleware/rateLimits.js';
import { userController } from '../dal/setup.js';
import { handle } from './asyncHandler.js';

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
router.post('/api/auth/register', authLimiter, handle(userController.register, userController));

// Login user
router.post('/api/auth/login', authLimiter, handle(userController.login, userController));

// Logout user — revokes the refresh token server-side, then clears both cookies.
router.post('/api/auth/logout', handle(userController.logout, userController));

// Refresh access token — exchanges the refresh-token cookie for a new access
// token (with refresh-token rotation). Deliberately NOT behind authenticateToken:
// the access token is expired by design at this point, so the refresh cookie is
// the credential the handler validates.
router.post('/api/auth/refresh', refreshLimiter, handle(userController.refresh, userController));

// Post-login hook — refresh tz and any other client-supplied session context
router.post('/api/auth/onLogin', authenticateToken, handle(userController.onLogin, userController));

// Get current authenticated user
router.get('/api/auth/me', authenticateToken, handle(userController.getCurrentUser, userController));

// Change user password
router.post('/api/auth/changePassword', authenticateToken, handle(userController.changePassword, userController));

// Delete user account
router.delete('/api/auth/deleteAccount', authenticateToken, handle(userController.deleteAccount, userController));

export default router;
