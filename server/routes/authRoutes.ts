import { Router } from 'express';
import { authenticateToken } from '../authMiddleware.js';
import { authLimiter, refreshLimiter, usernameCheckLimiter } from '../middleware/rateLimits.js';
import { userController, signInController, signInService } from '../dal/setup.js';
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

// POST /api/auth/register was removed 2026-11-14: sign-up is verify-first now (an email code
// or a Firebase-verified phone, then POST /api/auth/signUp), docs/LOGIN_REWORK.md Q14.

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

// Delete user account — with { password } or { stepUpToken } (SignInController.deleteAccount).
router.delete('/api/auth/deleteAccount', authenticateToken, handle(signInController.deleteAccount));

// ── Identifier-first sign-in (docs/LOGIN_REWORK.md § 4; SignInController) ──────────────
// Every anonymous credential endpoint sits behind authLimiter (per IP). The per-ADDRESS
// email limits (5 codes/hour, 30 s resend, 5 tries per code) are enforced in SignInService.
router.get('/api/auth/methods', handle(signInController.methods));
router.post('/api/auth/email/sendCode', authLimiter, handle(signInController.sendEmailCode));
router.post('/api/auth/email/verifyCode', authLimiter, handle(signInController.verifyEmailCode));
router.post('/api/auth/password/reset', authLimiter, handle(signInController.resetPassword));
router.post('/api/auth/phone/verify', authLimiter, handle(signInController.phoneVerify));
// DEV ONLY: the Firebase stand-in's send / confirm (DevConsolePhoneVerifier). Not mounted at all
// unless that verifier is active, which never happens with NODE_ENV=production.
if (signInService.devPhoneCodesActive) {
  router.post('/api/auth/phone/devSendCode', authLimiter, handle(signInController.devSendPhoneCode));
  router.post('/api/auth/phone/devConfirmCode', authLimiter, handle(signInController.devConfirmPhoneCode));
}
router.post('/api/auth/signUp', authLimiter, handle(signInController.signUp));
router.get('/api/auth/usernameAvailable', usernameCheckLimiter, handle(signInController.usernameAvailable));

// ── Account channels and step-up re-auth (signed in; Q24) ──────────────────────────────
router.post('/api/auth/stepUp/sendCode', authenticateToken, authLimiter, handle(signInController.sendStepUpCode));
router.post('/api/auth/stepUp/verify', authenticateToken, authLimiter, handle(signInController.verifyStepUp));
router.post('/api/auth/email/startChange', authenticateToken, authLimiter, handle(signInController.startEmailChange));
router.post('/api/auth/email/confirmChange', authenticateToken, authLimiter, handle(signInController.confirmEmailChange));
router.post('/api/auth/phone/change', authenticateToken, authLimiter, handle(signInController.changePhone));
router.put('/api/users/username', authenticateToken, handle(signInController.changeUsername));
router.put('/api/users/name', authenticateToken, handle(signInController.changeName));

export default router;
