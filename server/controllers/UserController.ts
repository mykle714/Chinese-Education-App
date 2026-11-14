import { Request, Response } from 'express';
import { UserService } from '../services/UserService.js';
import { IIcons8DAL } from '../dal/interfaces/IIcons8DAL.js';
import { ValidationError, DuplicateError, NotFoundError, DALError } from '../types/dal.js';
import { CHINESE_FONT_IDS } from '../contracts/wire.js';
import type { GoalsFocusAutoEnabled } from '../contracts/focusMode.js';
import { FocusModeService } from '../services/FocusModeService.js';
import { getUserLanguage } from '../utils/controllerUtils.js';
import { REFRESH_COOKIE, setAuthCookies, clearAuthCookies } from './authCookies.js';
import { respondWithError } from './httpErrors.js';

/**
 * User Controller - Handles HTTP requests and responses for user operations
 * Delegates business logic to UserService
 */
export class UserController {
  // icons8DAL is used only to validate avatar icon ids (PUT /api/users/avatar).
  constructor(
    private userService: UserService,
    private icons8DAL: IIcons8DAL,
    /** Auto-enables focus when a Reading / Writing goal opens a crowded world (docs/FOCUS_MODE.md § 1a). */
    private focusModeService: FocusModeService,
  ) {}

  // The auth cookies are set/cleared by ./authCookies.ts (shared with SignInController).

  // register (POST /api/auth/register) was removed 2026-11-14: sign-up is verify-first
  // (SignInController.signUp), docs/LOGIN_REWORK.md Q14.

  /**
   * Login user
   * POST /api/auth/login
   */
  async login(req: Request, res: Response): Promise<void> {
    try {
      const { email, password } = req.body;
      
      const authResponse = await this.userService.authenticateUser(email, password);

      // Issue the matching refresh token (the family root for this login) and set
      // both cookies. The refresh token is cookie-only — never returned in the
      // body, so client JS never holds it.
      const refresh = await this.userService.issueRefreshToken(
        authResponse.user.id,
        req.headers['user-agent'] ?? null
      );
      setAuthCookies(res, authResponse.token, refresh);

      res.json(authResponse);
    } catch (error) {
      this.handleError(error, res);
    }
  }

  /**
   * Exchange the refresh-token cookie for a fresh access token (and a rotated
   * refresh token). This endpoint is NOT behind authenticateToken — the access
   * token is expired by design here; the refresh cookie is the credential.
   * POST /api/auth/refresh
   */
  async refresh(req: Request, res: Response): Promise<void> {
    try {
      const rawRefreshToken = req.cookies?.[REFRESH_COOKIE];
      if (!rawRefreshToken) {
        res.status(401).json({
          error: 'No refresh token provided',
          code: 'ERR_NO_REFRESH_TOKEN',
        });
        return;
      }

      const result = await this.userService.rotateRefreshToken(
        rawRefreshToken,
        req.headers['user-agent'] ?? null
      );

      setAuthCookies(res, result.token, result.refreshToken);

      // Refresh the stored timezone off the back of the rotation. This endpoint is
      // the app's only ~15-minute heartbeat for a logged-in client, so it is the
      // cheapest place to keep `users.timezone` current: no new request, and it
      // catches what the login hook structurally cannot — a session that stays
      // open while the user travels or corrects their OS clock.
      //
      // Best-effort and AWAITED-but-caught: a failure here must not turn a
      // successful token rotation into a 401, which would log the user out.
      const { tz } = req.body || {};
      if (tz !== undefined) {
        try {
          await this.userService.refreshUserContext(result.user.id, { tz });
        } catch (tzError) {
          console.error('refresh: timezone sync failed (non-fatal)', tzError);
        }
      }

      // Return the new access token + user so the client can update in-memory
      // state and the Authorization header it sends on subsequent requests.
      res.json({ user: result.user, token: result.token });
    } catch (error) {
      // A failed rotation (invalid/expired/reused token) must clear the cookies
      // so the browser stops resending a dead refresh token; the client then
      // falls back to the login redirect.
      clearAuthCookies(res);
      this.handleError(error, res);
    }
  }

  /**
   * Log out: revoke the presented refresh token server-side (so it can never be
   * rotated again) and clear both cookies.
   * POST /api/auth/logout
   */
  async logout(req: Request, res: Response): Promise<void> {
    try {
      const rawRefreshToken = req.cookies?.[REFRESH_COOKIE];
      if (rawRefreshToken) {
        await this.userService.revokeRefreshToken(rawRefreshToken);
      }
      clearAuthCookies(res);
      res.status(200).json({ message: 'Logged out successfully' });
    } catch (error) {
      // Even if revocation fails, still clear cookies so the client logs out.
      clearAuthCookies(res);
      this.handleError(error, res);
    }
  }

  /**
   * Post-login hook — invoked by the client immediately after a successful
   * login or session restore. Body: { tz?: IANA }. Returns 204.
   * POST /api/auth/onLogin
   */
  async onLogin(req: Request, res: Response): Promise<void> {
    try {
      const userId = (req as any).user?.userId;
      if (!userId) {
        res.status(401).json({
          error: 'User not authenticated',
          code: 'ERR_NOT_AUTHENTICATED'
        });
        return;
      }

      const { tz } = req.body || {};
      await this.userService.refreshUserContext(userId, { tz });
      res.status(204).end();
    } catch (error) {
      this.handleError(error, res);
    }
  }

  /**
   * Update user's selected language
   * PUT /api/users/language
   */
  async updateLanguage(req: Request, res: Response): Promise<void> {
    try {
      const userId = (req as any).user?.userId;
      
      if (!userId) {
        res.status(401).json({ 
          error: 'User not authenticated',
          code: 'ERR_NOT_AUTHENTICATED'
        });
        return;
      }

      const { selectedLanguage } = req.body;
      
      // Validate language (only Chinese and Spanish are user-selectable for now)
      const validLanguages = ['zh', 'es'];
      if (!selectedLanguage || !validLanguages.includes(selectedLanguage)) {
        res.status(400).json({
          error: 'Invalid language. Must be one of: zh, es',
          code: 'ERR_INVALID_LANGUAGE'
        });
        return;
      }
      
      const updatedUser = await this.userService.updateUserProfile(userId, {
        selectedLanguage
      });
      
      res.json(updatedUser);
    } catch (error) {
      this.handleError(error, res);
    }
  }

  /**
   * Update the account's mastery goal flags.
   * PUT /api/users/goals — Body: { readingGoal?: boolean, writingGoal?: boolean }
   * See docs/MASTERY_REWORK.md.
   */
  async updateGoals(req: Request, res: Response): Promise<void> {
    try {
      const userId = (req as any).user?.userId;
      if (!userId) {
        res.status(401).json({ error: 'User not authenticated', code: 'ERR_NOT_AUTHENTICATED' });
        return;
      }

      const { readingGoal, writingGoal } = req.body ?? {};
      if (readingGoal !== undefined && typeof readingGoal !== 'boolean') {
        res.status(400).json({ error: 'readingGoal must be a boolean', code: 'ERR_INVALID_REQUEST' });
        return;
      }
      if (writingGoal !== undefined && typeof writingGoal !== 'boolean') {
        res.status(400).json({ error: 'writingGoal must be a boolean', code: 'ERR_INVALID_REQUEST' });
        return;
      }

      const { user: updatedUser, enabledWorlds } = await this.userService.updateGoals(userId, { readingGoal, writingGoal });

      // A goal just switched on opens its world with every sorted card ready at once — a
      // giant tower. If that pile is past the lever's threshold, switch focus on for the
      // learner (docs/FOCUS_MODE.md § 1a). In the account's selected language: focus is
      // per (user, language). Best-effort: a failure here must not fail the goal write,
      // which has already committed; the learner can still pull the lever.
      const response: typeof updatedUser & GoalsFocusAutoEnabled = { ...updatedUser, focusAutoEnabled: [] };
      if (enabledWorlds.length > 0) {
        try {
          const language = await getUserLanguage(userId);
          for (const world of enabledWorlds) {
            if (await this.focusModeService.autoEnableIfCrowded(userId, language, world)) {
              response.focusAutoEnabled.push(world);
            }
          }
        } catch (focusError) {
          console.error('UserController.updateGoals: focus auto-enable failed', focusError);
        }
      }
      res.json(response);
    } catch (error) {
      this.handleError(error, res);
    }
  }

  /**
   * Update the account's display preferences.
   * PUT /api/users/displaySettings — Body: { showSegmentSpaces?: boolean, chineseFont?: string }
   * Both optional; at least one required. See docs/EXAMPLE_SENTENCES.md and
   * docs/CJK_TYPEFACE_LAB.md.
   */
  async updateDisplaySettings(req: Request, res: Response): Promise<void> {
    try {
      const userId = (req as any).user?.userId;
      if (!userId) {
        res.status(401).json({ error: 'User not authenticated', code: 'ERR_NOT_AUTHENTICATED' });
        return;
      }

      const { showSegmentSpaces, chineseFont } = req.body ?? {};
      if (showSegmentSpaces !== undefined && typeof showSegmentSpaces !== 'boolean') {
        res.status(400).json({ error: 'showSegmentSpaces must be a boolean', code: 'ERR_INVALID_REQUEST' });
        return;
      }
      // Allow-listed rather than free text: the column is bare `text`, and an unknown
      // id would silently render as the fallback face on every client forever.
      if (chineseFont !== undefined && (typeof chineseFont !== 'string' || !CHINESE_FONT_IDS.includes(chineseFont))) {
        res.status(400).json({
          error: `chineseFont must be one of: ${CHINESE_FONT_IDS.join(', ')}`,
          code: 'ERR_INVALID_REQUEST',
        });
        return;
      }

      const updatedUser = await this.userService.updateDisplaySettings(userId, { showSegmentSpaces, chineseFont });
      res.json(updatedUser);
    } catch (error) {
      this.handleError(error, res);
    }
  }

  /**
   * Set or clear the learner's gender / date of birth (migration 164).
   * PUT /api/users/demographics — Body: { gender?: 'male' | 'female' | null, birthDate?: 'YYYY-MM-DD' | null }
   *
   * Both optional; at least one required; `null` = "Prefer not to answer". Validation is
   * entirely UserService.validateDemographics (shared with signup), whose ValidationError
   * handleError maps to a 400. Its only reader was Immersive World (removed 2026-11-09, archived — docs/ARCHIVED_FEATURES.md).
   */
  async updateDemographics(req: Request, res: Response): Promise<void> {
    try {
      const userId = (req as any).user?.userId;
      if (!userId) {
        res.status(401).json({ error: 'User not authenticated', code: 'ERR_NOT_AUTHENTICATED' });
        return;
      }
      const { gender, birthDate } = req.body ?? {};
      const updatedUser = await this.userService.updateDemographics(userId, { gender, birthDate });
      res.json(updatedUser);
    } catch (error) {
      this.handleError(error, res);
    }
  }

  /**
   * Update the user's profile avatar (the icons8 icon they picked).
   * PUT /api/users/avatar
   *
   * Body: { avatarIconId: string | null } — null/empty clears the avatar back to the
   * name-initial fallback. A non-null id must reference a downloaded icon in icons8;
   * we validate up front so an unknown id returns a clean 400 rather than surfacing
   * as a FK-violation 500.
   */
  async updateAvatar(req: Request, res: Response): Promise<void> {
    try {
      const userId = (req as any).user?.userId;

      if (!userId) {
        res.status(401).json({
          error: 'User not authenticated',
          code: 'ERR_NOT_AUTHENTICATED'
        });
        return;
      }

      const { avatarIconId } = req.body;

      // Normalize: treat null / undefined / '' all as "clear the avatar".
      const normalized: string | null =
        avatarIconId === null || avatarIconId === undefined || avatarIconId === ''
          ? null
          : String(avatarIconId).trim();

      if (normalized !== null) {
        const exists = await this.icons8DAL.iconExists(normalized);
        if (!exists) {
          res.status(400).json({
            error: 'Unknown icon id',
            code: 'ERR_INVALID_ICON'
          });
          return;
        }
      }

      const updatedUser = await this.userService.updateUserProfile(userId, {
        avatarIconId: normalized
      });

      res.json(updatedUser);
    } catch (error) {
      this.handleError(error, res);
    }
  }

  /**
   * Get current authenticated user
   * GET /api/auth/me
   */
  async getCurrentUser(req: Request, res: Response): Promise<void> {
    try {
      // Extract user ID from authenticated request
      const userId = (req as any).user?.userId;
      
      if (!userId) {
        res.status(401).json({ 
          error: 'User not authenticated',
          code: 'ERR_NOT_AUTHENTICATED'
        });
        return;
      }
      
      const user = await this.userService.getUserProfile(userId);
      res.json(user);
    } catch (error) {
      this.handleError(error, res);
    }
  }

  // deleteAccount moved to SignInController (2026-11-14): it now also takes a step-up token,
  // and checks the credential BEFORE revoking sessions (docs/LOGIN_REWORK.md Q24).

  /**
   * Change user password
   * POST /api/auth/changePassword
   */
  async changePassword(req: Request, res: Response): Promise<void> {
    try {
      const userId = (req as any).user?.userId;
      const { currentPassword, newPassword } = req.body;
      
      if (!userId) {
        res.status(401).json({ 
          error: 'User not authenticated',
          code: 'ERR_NOT_AUTHENTICATED'
        });
        return;
      }
      
      const updatedUser = await this.userService.changePassword(
        userId,
        currentPassword,
        newPassword
      );
      
      res.json({
        user: updatedUser,
        message: 'Password changed successfully'
      });
    } catch (error) {
      this.handleError(error, res);
    }
  }

  // NOTE: updateProfile (PUT /api/users/profile, email + name) was deleted 2026-11-14: no route
  // mounted it, and an email change must now be verified (docs/LOGIN_REWORK.md Q24).

  /**
   * Get the caller's OWN user row by ID.
   * GET /api/users/:id
   *
   * ⚠️ SELF-ONLY (2026-09-23). This used to return ANY account's `findById` row to any signed-in
   * caller — email, timezone, and since migration 164 gender and date of birth. The row is
   * private by nature, so another account's id is refused outright rather than filtered field
   * by field (a filter has to be remembered every time a column is added; a refusal does not).
   * What other people may see about an account is `GET /api/users/:userId/profile`
   * (UserProfileController), which selects public fields explicitly.
   *
   * 403 rather than 404: the id is not secret (it appears on friend lists and boards), so
   * pretending it does not exist would protect nothing.
   */
  async getUserById(req: Request, res: Response): Promise<void> {
    try {
      const { id } = req.params;
      const callerId = (req as any).user?.userId;
      if (!callerId || callerId !== id) {
        res.status(403).json({ error: 'You can only read your own account', code: 'ERR_FORBIDDEN' });
        return;
      }

      const user = await this.userService.getUserProfile(id);
      res.json(user);
    } catch (error) {
      this.handleError(error, res);
    }
  }

  // NOTE: getAllUsers (GET /api/users) was deleted 2026-09-23 — it exposed every account's
  // password hash to any signed-in caller. See the note in server/routes/userRoutes.ts.

  // NOTE: GET /api/users/:id/totalMinutePoints was removed by migration 130. There is no single
  // "total minute points" any more — each language has its own wallet. The client reads
  // GET /api/users/minutePoints/summary?language=… instead. See docs/PER_LANGUAGE_STREAKS.md.

  // NOTE: createUser (POST /api/users, "admin function") was deleted 2026-11-14. It had no admin
  // check (any signed-in caller could create accounts), no client called it, and it would
  // create accounts that skip verification (docs/LOGIN_REWORK.md Q14).

  /** Errors → JSON responses: the shared mapping in ./httpErrors.ts. */
  private handleError(error: any, res: Response): void {
    respondWithError(res, error, 'UserController');
  }
}
