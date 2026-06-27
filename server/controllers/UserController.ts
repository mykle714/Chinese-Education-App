import { Request, Response } from 'express';
import { UserService, IssuedRefreshToken } from '../services/UserService.js';
import { IIcons8DAL } from '../dal/interfaces/IIcons8DAL.js';
import { ValidationError, DuplicateError, NotFoundError, DALError } from '../types/dal.js';

// The access-token cookie lives at root (sent with every API request); the
// refresh-token cookie is scoped to /api/auth so it is only ever sent to the
// auth endpoints that need it (refresh / logout / delete-account), shrinking its
// exposure. clearCookie MUST use the same path or the browser keeps the cookie.
const ACCESS_COOKIE = 'token';
const REFRESH_COOKIE = 'refreshToken';
const REFRESH_COOKIE_PATH = '/api/auth';
const ACCESS_COOKIE_MAX_AGE_MS = 15 * 60 * 1000; // mirrors ACCESS_TOKEN_TTL

/**
 * User Controller - Handles HTTP requests and responses for user operations
 * Delegates business logic to UserService
 */
export class UserController {
  // icons8DAL is used only to validate avatar icon ids (PUT /api/users/avatar).
  constructor(private userService: UserService, private icons8DAL: IIcons8DAL) {}

  /**
   * Set the access + refresh cookies after a login or refresh. Both are httpOnly
   * (invisible to JS — XSS can't read them). The refresh cookie's lifetime tracks
   * its DB expiry so the browser drops it in lockstep with the server.
   * Note: add `secure: true` to both when serving over HTTPS.
   */
  private setAuthCookies(res: Response, accessToken: string, refresh: IssuedRefreshToken): void {
    res.cookie(ACCESS_COOKIE, accessToken, {
      httpOnly: true,
      sameSite: 'lax',
      maxAge: ACCESS_COOKIE_MAX_AGE_MS,
    });
    res.cookie(REFRESH_COOKIE, refresh.rawToken, {
      httpOnly: true,
      sameSite: 'lax',
      path: REFRESH_COOKIE_PATH,
      maxAge: Math.max(0, refresh.expiresAt.getTime() - Date.now()),
    });
  }

  /** Clear both auth cookies (logout / account deletion). */
  private clearAuthCookies(res: Response): void {
    res.clearCookie(ACCESS_COOKIE);
    res.clearCookie(REFRESH_COOKIE, { path: REFRESH_COOKIE_PATH });
  }

  /**
   * Register a new user
   * POST /api/auth/register
   */
  async register(req: Request, res: Response): Promise<void> {
    try {
      const { email, name, password } = req.body;
      
      const newUser = await this.userService.createUser({
        email,
        name,
        password
      });
      
      res.status(201).json(newUser);
    } catch (error) {
      this.handleError(error, res);
    }
  }

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
      this.setAuthCookies(res, authResponse.token, refresh);

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

      this.setAuthCookies(res, result.token, result.refreshToken);

      // Return the new access token + user so the client can update in-memory
      // state and the Authorization header it sends on subsequent requests.
      res.json({ user: result.user, token: result.token });
    } catch (error) {
      // A failed rotation (invalid/expired/reused token) must clear the cookies
      // so the browser stops resending a dead refresh token; the client then
      // falls back to the login redirect.
      this.clearAuthCookies(res);
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
      this.clearAuthCookies(res);
      res.status(200).json({ message: 'Logged out successfully' });
    } catch (error) {
      // Even if revocation fails, still clear cookies so the client logs out.
      this.clearAuthCookies(res);
      this.handleError(error, res);
    }
  }

  /**
   * Post-login hook — invoked by the client immediately after a successful
   * login or session restore. Body: { tz?: IANA }. Returns 204.
   * POST /api/auth/on-login
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

  /**
   * Delete user account
   * DELETE /api/auth/delete-account
   */
  async deleteAccount(req: Request, res: Response): Promise<void> {
    try {
      const userId = (req as any).user?.userId;
      const { password } = req.body;
      
      if (!userId) {
        res.status(401).json({ 
          error: 'User not authenticated',
          code: 'ERR_NOT_AUTHENTICATED'
        });
        return;
      }
      
      if (!password) {
        res.status(400).json({
          error: 'Password is required to delete account',
          code: 'ERR_PASSWORD_REQUIRED'
        });
        return;
      }
      
      // Revoke any outstanding refresh tokens up front (the FK CASCADE on user
      // deletion also removes the rows, but this is explicit and order-safe).
      await this.userService.revokeAllRefreshTokens(userId);

      // Delete user account (this will cascade delete all user data, including
      // any remaining refresh_tokens rows via ON DELETE CASCADE)
      await this.userService.deleteUser(userId, password);

      // Clear both authentication cookies
      this.clearAuthCookies(res);

      res.json({
        message: 'Account deleted successfully'
      });
    } catch (error) {
      this.handleError(error, res);
    }
  }

  /**
   * Change user password
   * POST /api/auth/change-password
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

  /**
   * Update user profile
   * PUT /api/users/profile
   */
  async updateProfile(req: Request, res: Response): Promise<void> {
    try {
      const userId = (req as any).user?.userId;
      const { email, name } = req.body;
      
      if (!userId) {
        res.status(401).json({ 
          error: 'User not authenticated',
          code: 'ERR_NOT_AUTHENTICATED'
        });
        return;
      }
      
      const updatedUser = await this.userService.updateUserProfile(userId, {
        email,
        name
      });
      
      res.json(updatedUser);
    } catch (error) {
      this.handleError(error, res);
    }
  }

  /**
   * Get user profile by ID
   * GET /api/users/:id
   */
  async getUserById(req: Request, res: Response): Promise<void> {
    try {
      const { id } = req.params;
      
      const user = await this.userService.getUserProfile(id);
      res.json(user);
    } catch (error) {
      this.handleError(error, res);
    }
  }

  /**
   * Get all users (admin function)
   * GET /api/users
   */
  async getAllUsers(req: Request, res: Response): Promise<void> {
    try {
      const users = await this.userService.getAllUsers();
      res.json(users);
    } catch (error) {
      this.handleError(error, res);
    }
  }

  /**
   * Get total minute points and current streak for a user
   * GET /api/users/:id/total-minute-points
   */
  async getTotalMinutePoints(req: Request, res: Response): Promise<void> {
    try {
      const { id } = req.params;

      const result = await this.userService.getTotalMinutePoints(id);
      res.json(result);
    } catch (error) {
      this.handleError(error, res);
    }
  }

  /**
   * Create new user (admin function)
   * POST /api/users
   */
  async createUser(req: Request, res: Response): Promise<void> {
    try {
      const { email, name, password } = req.body;
      
      const newUser = await this.userService.createUser({
        email,
        name,
        password
      });
      
      res.status(201).json(newUser);
    } catch (error) {
      this.handleError(error, res);
    }
  }

  /**
   * Handle and convert errors to appropriate HTTP responses
   * Uses sanitized error messages to prevent sensitive information exposure
   */
  private handleError(error: any, res: Response): void {
    // Log full error details server-side for debugging
    console.error('UserController error:', {
      message: error.message,
      stack: error.stack,
      code: error.code,
      statusCode: error.statusCode,
      timestamp: new Date().toISOString()
    });
    
    // Handle DAL errors with sanitization
    if (error instanceof ValidationError) {
      const clientError = error.toClientError();
      res.status(clientError.statusCode).json({
        error: clientError.message,
        code: clientError.code
      });
      return;
    }
    
    if (error instanceof DuplicateError) {
      const clientError = error.toClientError();
      res.status(clientError.statusCode).json({
        error: clientError.message,
        code: clientError.code
      });
      return;
    }
    
    if (error instanceof NotFoundError) {
      const clientError = error.toClientError();
      res.status(clientError.statusCode).json({
        error: clientError.message,
        code: clientError.code
      });
      return;
    }
    
    if (error instanceof DALError) {
      const clientError = error.toClientError();
      res.status(clientError.statusCode).json({
        error: clientError.message,
        code: clientError.code
      });
      return;
    }
    
    // Handle legacy custom errors from existing code
    if (error.code && error.statusCode) {
      // For legacy errors, sanitize manually
      let sanitizedMessage = error.message;
      sanitizedMessage = sanitizedMessage.replace(/mykle\.database\.windows\.net/gi, '[server]');
      sanitizedMessage = sanitizedMessage.replace(/\b\d{1,3}\.\d{1,3}\.\d{1,3}\.\d{1,3}\b/g, '[server]');
      sanitizedMessage = sanitizedMessage.replace(/:\d{4,5}/g, '');
      sanitizedMessage = sanitizedMessage.replace(/in \d+ms/g, '');
      
      res.status(error.statusCode).json({
        error: sanitizedMessage,
        code: error.code
      });
      return;
    }
    
    // Handle JWT errors
    if (error.name === 'JsonWebTokenError' || error.name === 'TokenExpiredError') {
      res.status(401).json({
        error: 'Invalid or expired token',
        code: 'ERR_INVALID_TOKEN'
      });
      return;
    }
    
    // Generic server error - never expose internal details
    res.status(500).json({
      error: 'Internal server error',
      code: 'ERR_INTERNAL_SERVER_ERROR'
    });
  }
}
