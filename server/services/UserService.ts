import bcrypt from 'bcrypt';
import crypto from 'crypto';
import jwt from 'jsonwebtoken';
import { IUserDAL } from '../dal/interfaces/IUserDAL.js';
import { IRefreshTokenDAL } from '../dal/interfaces/IRefreshTokenDAL.js';
import { User, UserCreateData, UserLoginData, AuthResponse, Language } from '../types/index.js';
import { ValidationError, DuplicateError, NotFoundError, DALError } from '../types/dal.js';
import { resolveTimezone } from '../utils/streakDate.js';

// JWT secret key - should be in environment variables in production
const JWT_SECRET = process.env.JWT_SECRET;
const SALT_ROUNDS = 10;

// Token lifetimes for the access/refresh scheme (migration 85). The access token
// is a short-lived stateless JWT (verified by authMiddleware); the refresh token
// is a long-lived opaque random string tracked in `refresh_tokens` so it can be
// rotated and revoked.
const ACCESS_TOKEN_TTL = '15m';
const REFRESH_TOKEN_TTL_MS = 30 * 24 * 60 * 60 * 1000; // 30 days

// Reuse-detection grace window (ms). When an ALREADY-revoked refresh token is
// presented, a genuine replay/theft is indistinguishable from a benign
// concurrency race (two tabs, or a network retry of a refresh whose Set-Cookie
// response was lost) purely from the token. We treat a re-presentation as a
// benign race — and issue a fresh pair instead of burning the user's whole token
// family — only when the token was rotated very recently AND legitimately (it has
// a successor). A token revoked longer ago than this, or one that was revoked
// without a successor, is treated as theft. 20s comfortably covers sub-second
// rotation races while keeping the theft-replay window tiny.
const REFRESH_REUSE_GRACE_MS = 20 * 1000;

/** Result of issuing a refresh token: the RAW token (handed to the client once)
 *  plus its expiry (used to set the cookie maxAge). The raw token is never stored. */
export interface IssuedRefreshToken {
  rawToken: string;
  expiresAt: Date;
}

/** Result of a successful rotation: a new access token, a new refresh token, and
 *  the authenticated user (so the controller can refresh client-side state). */
export interface RefreshResult {
  user: User;
  token: string;
  refreshToken: IssuedRefreshToken;
}

/**
 * User Service - Contains all business logic for user operations
 * Handles authentication, validation, password management, etc.
 */
export class UserService {
  constructor(
    private userDAL: IUserDAL,
    private refreshTokenDAL: IRefreshTokenDAL
  ) {}

  /**
   * Create a new user with password hashing and validation
   */
  async createUser(userData: UserCreateData): Promise<User> {
    // Business validation
    this.validateUserData(userData);
    
    // Check if user already exists
    const existingUser = await this.userDAL.findByEmail(userData.email);
    if (existingUser) {
      throw new DuplicateError('Email already exists');
    }
    
    // Hash password (business logic)
    const hashedPassword = await bcrypt.hash(userData.password, SALT_ROUNDS);
    
    // Create user with hashed password
    const newUser = await this.userDAL.create({
      ...userData,
      password: hashedPassword
    });
    
    // Remove password from response for security
    delete newUser.password;
    
    return newUser;
  }

  /**
   * Authenticate user and generate JWT token
   */
  async authenticateUser(email: string, password: string): Promise<AuthResponse> {
    // Validation
    if (!email) {
      throw new ValidationError('Email is required');
    }
    if (!password) {
      throw new ValidationError('Password is required');
    }
    
    // Find user with password for authentication
    const user = await this.userDAL.findByEmailWithPassword(email);
    if (!user) {
      throw new ValidationError('Invalid email or password');
    }
    
    // Verify password (business logic)
    const isPasswordValid = await bcrypt.compare(password, user.password!);
    if (!isPasswordValid) {
      throw new ValidationError('Invalid email or password');
    }
    
    
    // Generate the short-lived access token (business logic). The matching
    // refresh token is issued separately by the controller via issueRefreshToken.
    const token = this.generateAccessToken(user);

    // Remove password from response
    delete user.password;

    return { user, token };
  }

  /**
   * Sign a short-lived stateless access-token JWT for a user. Shared by login
   * and refresh so both encode the same claims/lifetime.
   */
  private generateAccessToken(user: User): string {
    return jwt.sign(
      { userId: user.id, email: user.email },
      JWT_SECRET,
      { expiresIn: ACCESS_TOKEN_TTL }
    );
  }

  /** SHA-256 hex of a raw refresh token — the only form we ever persist. */
  private hashRefreshToken(rawToken: string): string {
    return crypto.createHash('sha256').update(rawToken).digest('hex');
  }

  /**
   * Issue a brand-new refresh token for a user (login = family root). Generates a
   * 256-bit random opaque token, stores only its hash, and returns the RAW token
   * to hand to the client exactly once.
   */
  async issueRefreshToken(userId: string, userAgent?: string | null): Promise<IssuedRefreshToken> {
    if (!userId) {
      throw new ValidationError('User ID is required');
    }
    const rawToken = crypto.randomBytes(32).toString('hex');
    const expiresAt = new Date(Date.now() + REFRESH_TOKEN_TTL_MS);
    await this.refreshTokenDAL.create({
      userId,
      tokenHash: this.hashRefreshToken(rawToken),
      expiresAt,
      userAgent,
    });
    return { rawToken, expiresAt };
  }

  /**
   * Exchange a valid refresh token for a fresh access token + a rotated refresh
   * token. Implements rotation with reuse detection:
   *   - unknown token            -> reject (invalid)
   *   - expired token            -> reject (must re-login)
   *   - ALREADY-revoked token:
   *       • rotated within the reuse grace window AND has a successor -> benign
   *         concurrency race (two tabs / a retried refresh): issue a fresh pair,
   *         do NOT burn the family
   *       • otherwise -> THEFT/replay: revoke the user's entire family and reject
   *   - valid token              -> revoke it (linked to its successor) and issue
   *                                 a new access + refresh pair
   */
  async rotateRefreshToken(rawToken: string, userAgent?: string | null): Promise<RefreshResult> {
    if (!rawToken) {
      throw new ValidationError('Refresh token is required');
    }

    const presentedHash = this.hashRefreshToken(rawToken);
    const stored = await this.refreshTokenDAL.findByHash(presentedHash);

    if (!stored) {
      throw new ValidationError('Invalid refresh token');
    }

    // Reuse of a revoked token. This is EITHER a benign concurrency race (the
    // legit client rotated the token in another tab / a retried request a moment
    // ago) OR a replay of a stolen token. We can't tell from the token alone, so
    // we use a short grace window: a token revoked very recently AND legitimately
    // (it has a successor) is treated as a race and allowed to mint a fresh pair;
    // anything else burns the whole family. revoke() is idempotent (COALESCE), so
    // re-presenting within the window does not move the original revoke moment or
    // successor link — the fall-through below just issues an additional sibling.
    if (stored.revokedAt) {
      const revokedAgeMs = Date.now() - stored.revokedAt.getTime();
      const benignRace =
        revokedAgeMs <= REFRESH_REUSE_GRACE_MS && stored.replacedByHash !== null;
      if (!benignRace) {
        await this.refreshTokenDAL.revokeAllForUser(stored.userId);
        throw new ValidationError('Refresh token reuse detected');
      }
      // Benign race: fall through to issue a fresh access + refresh pair below.
    }

    if (stored.expiresAt.getTime() <= Date.now()) {
      throw new ValidationError('Refresh token has expired');
    }

    const user = await this.userDAL.findById(stored.userId);
    if (!user) {
      // Orphaned token (user deleted) — clean up and reject.
      await this.refreshTokenDAL.revoke(presentedHash, null);
      throw new NotFoundError('User not found');
    }

    // Issue the successor first, then revoke the presented token linked to it so
    // the family chain (replacedByHash) stays intact.
    const newRefresh = await this.issueRefreshToken(stored.userId, userAgent);
    await this.refreshTokenDAL.revoke(presentedHash, this.hashRefreshToken(newRefresh.rawToken));

    const token = this.generateAccessToken(user);
    delete user.password;

    return { user, token, refreshToken: newRefresh };
  }

  /** Revoke a single refresh token (logout). Best-effort: a no-op if unknown. */
  async revokeRefreshToken(rawToken: string): Promise<void> {
    if (!rawToken) return;
    await this.refreshTokenDAL.revoke(this.hashRefreshToken(rawToken), null);
  }

  /** Revoke every valid refresh token for a user ("log out everywhere"). */
  async revokeAllRefreshTokens(userId: string): Promise<void> {
    if (!userId) {
      throw new ValidationError('User ID is required');
    }
    await this.refreshTokenDAL.revokeAllForUser(userId);
  }

  /**
   * Verify JWT token and get user
   */
  async getUserFromToken(token: string): Promise<User> {
    if (!token) {
      throw new ValidationError('Token is required');
    }
    
    try {
      // Verify token (business logic)
      const decoded = jwt.verify(token, JWT_SECRET) as { userId: string };
      
      // Get user by ID
      const user = await this.userDAL.findById(decoded.userId);
      if (!user) {
        throw new NotFoundError('User not found');
      }
      
      return user;
    } catch (error: any) {
      if (error.name === 'JsonWebTokenError' || error.name === 'TokenExpiredError') {
        throw new ValidationError('Invalid or expired token');
      }
      throw error;
    }
  }

  /**
   * Change user password with current password verification
   */
  async changePassword(userId: string, currentPassword: string, newPassword: string): Promise<User> {
    // Validation
    if (!userId) {
      throw new ValidationError('User ID is required');
    }
    if (!currentPassword) {
      throw new ValidationError('Current password is required');
    }
    if (!newPassword) {
      throw new ValidationError('New password is required');
    }
    
    // Business rule: validate new password strength
    this.validatePasswordStrength(newPassword);
    
    // Get user with password for verification
    const user = await this.userDAL.findByEmailWithPassword(
      (await this.userDAL.findById(userId))?.email || ''
    );
    
    if (!user) {
      throw new NotFoundError('User not found');
    }
    
    // Verify current password (business logic)
    const isCurrentPasswordValid = await bcrypt.compare(currentPassword, user.password!);
    if (!isCurrentPasswordValid) {
      throw new ValidationError('Current password is incorrect');
    }
    
    // Hash new password (business logic)
    const hashedNewPassword = await bcrypt.hash(newPassword, SALT_ROUNDS);
    
    // Update password
    const success = await this.userDAL.updatePassword(userId, hashedNewPassword);
    if (!success) {
      throw new DALError('Failed to update password', 'ERR_PASSWORD_UPDATE_FAILED');
    }
    
    // Return updated user (without password)
    const updatedUser = await this.userDAL.findById(userId);
    if (!updatedUser) {
      throw new NotFoundError('User not found after update');
    }
    
    return updatedUser;
  }

  /**
   * Delete user account with password verification
   */
  async deleteUser(userId: string, password: string): Promise<void> {
    // Validation
    if (!userId) {
      throw new ValidationError('User ID is required');
    }
    if (!password) {
      throw new ValidationError('Password is required for account deletion');
    }
    
    // Get user with password for verification
    const user = await this.userDAL.findByEmailWithPassword(
      (await this.userDAL.findById(userId))?.email || ''
    );
    
    if (!user) {
      throw new NotFoundError('User not found');
    }
    
    // Verify password before deletion (security check)
    const isPasswordValid = await bcrypt.compare(password, user.password!);
    if (!isPasswordValid) {
      throw new ValidationError('Password is incorrect');
    }
    
    // Delete user (CASCADE DELETE will handle all related data)
    const success = await this.userDAL.deleteUser(userId);
    if (!success) {
      throw new DALError('Failed to delete user account', 'ERR_USER_DELETE_FAILED');
    }
  }

  /**
   * Get user profile by ID
   */
  async getUserProfile(userId: string): Promise<User> {
    if (!userId) {
      throw new ValidationError('User ID is required');
    }
    
    const user = await this.userDAL.findById(userId);
    if (!user) {
      throw new NotFoundError('User not found');
    }
    
    return user;
  }

  /**
   * Update user profile information
   */
  async updateUserProfile(userId: string, updateData: { email?: string; name?: string; selectedLanguage?: Language; avatarIconId?: string | null }): Promise<User> {
    if (!userId) {
      throw new ValidationError('User ID is required');
    }
    
    // Business validation
    if (updateData.email) {
      this.validateEmail(updateData.email);
      
      // Check if new email is already taken by another user
      const existingUser = await this.userDAL.findByEmail(updateData.email);
      if (existingUser && existingUser.id !== userId) {
        throw new DuplicateError('Email already exists');
      }
    }
    
    if (updateData.name) {
      this.validateName(updateData.name);
    }
    
    // Update user. The DAL's UPDATE ... RETURNING * includes the password hash, so
    // strip it before handing the row back to any caller / the HTTP response.
    const updatedUser = await this.userDAL.update(userId, updateData);
    delete updatedUser.password;
    return updatedUser;
  }

  /**
   * Update the account's mastery goal flags (Reading / Writing). Recognition +
   * Production are always goals and are not stored. See docs/MASTERY_REWORK.md.
   */
  async updateGoals(userId: string, goals: { readingGoal?: boolean; writingGoal?: boolean }): Promise<User> {
    if (!userId) {
      throw new ValidationError('User ID is required');
    }
    const updateData: { readingGoal?: boolean; writingGoal?: boolean } = {};
    if (typeof goals.readingGoal === 'boolean') updateData.readingGoal = goals.readingGoal;
    if (typeof goals.writingGoal === 'boolean') updateData.writingGoal = goals.writingGoal;
    if (Object.keys(updateData).length === 0) {
      throw new ValidationError('At least one of readingGoal / writingGoal (boolean) is required');
    }
    const updatedUser = await this.userDAL.update(userId, updateData);
    delete updatedUser.password;
    return updatedUser;
  }

  /**
   * Get all users (admin function)
   */
  async getAllUsers(): Promise<User[]> {
    return await this.userDAL.findAll();
  }

  /**
   * Get total minute points and current streak for a user
   */
  async getTotalMinutePoints(userId: string): Promise<{ totalMinutePoints: number; currentStreak: number }> {
    if (!userId) {
      throw new ValidationError('User ID is required');
    }

    return await this.userDAL.getTotalMinutePoints(userId);
  }

  /**
   * Increment total minute points for a user (used during daily sync)
   */
  async incrementTotalMinutePoints(userId: string, pointsToAdd: number): Promise<boolean> {
    if (!userId) {
      throw new ValidationError('User ID is required');
    }
    if (pointsToAdd < 0) {
      throw new ValidationError('Points to add must be positive');
    }

    return await this.userDAL.incrementTotalMinutePoints(userId, pointsToAdd);
  }

  /**
   * Post-login bookkeeping. Today: refresh users.timezone so the hourly
   * streak-expiration cron computes the right local-day boundary even for
   * users who log in without earning any minute points.
   */
  async refreshUserContext(userId: string, ctx: { tz?: string }): Promise<void> {
    if (!userId) {
      throw new ValidationError('User ID is required');
    }
    if (ctx.tz !== undefined) {
      await this.userDAL.updateTimezoneIfChanged(userId, resolveTimezone(ctx.tz));
    }
  }

  // Private validation methods (business logic)

  /**
   * Validate user registration data
   */
  private validateUserData(userData: UserCreateData): void {
    if (!userData.email) {
      throw new ValidationError('Email is required');
    }
    if (!userData.name) {
      throw new ValidationError('Name is required');
    }
    if (!userData.password) {
      throw new ValidationError('Password is required');
    }
    
    this.validateEmail(userData.email);
    this.validateName(userData.name);
    this.validatePasswordStrength(userData.password);
  }

  /**
   * Validate email format
   */
  private validateEmail(email: string): void {
    const emailRegex = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
    if (!emailRegex.test(email)) {
      throw new ValidationError('Invalid email format');
    }
    
    if (email.length > 255) {
      throw new ValidationError('Email is too long (maximum 255 characters)');
    }
  }

  /**
   * Validate name
   */
  private validateName(name: string): void {
    if (name.trim().length < 2) {
      throw new ValidationError('Name must be at least 2 characters long');
    }
    
    if (name.length > 100) {
      throw new ValidationError('Name is too long (maximum 100 characters)');
    }
    
    // Business rule: no special characters in name
    const nameRegex = /^[a-zA-Z\s\-'\.]+$/;
    if (!nameRegex.test(name)) {
      throw new ValidationError('Name can only contain letters, spaces, hyphens, apostrophes, and periods');
    }
  }

  /**
   * Validate password strength
   */
  private validatePasswordStrength(password: string): void {
    if (password.length < 8) {
      throw new ValidationError('Password must be at least 8 characters long');
    }
    
    if (password.length > 128) {
      throw new ValidationError('Password is too long (maximum 128 characters)');
    }
    
    // Business rule: password must contain at least one letter and one number
    const hasLetter = /[a-zA-Z]/.test(password);
    const hasNumber = /\d/.test(password);
    
    if (!hasLetter || !hasNumber) {
      throw new ValidationError('Password must contain at least one letter and one number');
    }
    
    // Business rule: check for common weak passwords
    const commonPasswords = ['password', '12345678', 'qwerty123', 'password123'];
    if (commonPasswords.includes(password.toLowerCase())) {
      throw new ValidationError('Password is too common. Please choose a stronger password');
    }
  }
}
