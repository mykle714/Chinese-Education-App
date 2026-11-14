import bcrypt from 'bcrypt';
import crypto from 'crypto';
import jwt from 'jsonwebtoken';
import { IUserDAL } from '../dal/interfaces/IUserDAL.js';
import { IRefreshTokenDAL } from '../dal/interfaces/IRefreshTokenDAL.js';
import { User, AuthResponse, Language } from '../types/index.js';
import { ValidationError, DuplicateError, NotFoundError, DALError } from '../types/dal.js';
import { resolveTimezone } from '../utils/streakDate.js';
import { CHINESE_FONT_IDS, ISO_DATE_PATTERN, USER_GENDERS, normalizeUsername, usernameProblem, USERNAME_MAX_LENGTH, RESERVED_USERNAMES, type UserGender } from '../contracts/wire.js';

// JWT secret key - should be in environment variables in PPE
const JWT_SECRET = process.env.JWT_SECRET;
const SALT_ROUNDS = 10;

/**
 * A bcrypt hash of a throwaway string, compared against when an email has no account (or the
 * account has no password), so a sign-in attempt takes the same time either way. Without it
 * the response time would reveal whether an email is registered, which the owner chose to
 * hide (docs/LOGIN_REWORK.md Q13 / Q17). Computed once, lazily.
 */
let dummyHashPromise: Promise<string> | null = null;
function dummyPasswordHash(): Promise<string> {
  if (!dummyHashPromise) dummyHashPromise = bcrypt.hash('no-account-timing-equalizer', SALT_ROUNDS);
  return dummyHashPromise;
}

/** The one message for a wrong password AND an unknown email (Q17): it must not say which. */
export const WRONG_CREDENTIALS_MESSAGE = 'Wrong email or password';

/**
 * Everything needed to create an account (docs/LOGIN_REWORK.md § 4d, Q14). An account is only
 * created AFTER its channel was proven (an email code or a Firebase-verified phone), so the
 * matching verified-at stamp is set at creation and an unverified account never exists.
 */
export interface NewAccountInput {
  /** Exactly one of email / phone identifies the account at creation. */
  email?: string | null;
  /** E.164, already verified by Firebase. */
  phone?: string | null;
  /** RAW password (hashed here). Email accounts only; required for one (Q9). */
  password?: string | null;
  /** As typed; normalized + validated here. */
  username: string;
  name?: string | null;
  timezone?: string;
  gender?: UserGender | null;
  birthDate?: string | null;
}

// Token lifetimes for the access/refresh scheme (migration 85). The access token
// is a short-lived stateless JWT (verified by authMiddleware); the refresh token
// is a long-lived opaque random string tracked in `refresh_tokens` so it can be
// rotated and revoked.
const ACCESS_TOKEN_TTL = '15m';
// 180 days, sliding: every rotation (refresh) issues a fresh 180-day expiry, so only
// 180 days without opening the app ends a session. Raised from 30 days 2026-11-13 so a
// learner signs in roughly once per device (docs/LOGIN_REWORK.md § 4e). The cookie Max-Age
// is derived from `expiresAt` (UserController), so this constant is the only knob.
const REFRESH_TOKEN_TTL_MS = 180 * 24 * 60 * 60 * 1000;

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
 * The learner's demographics as a write — `users."gender"` / `users."birthDate"` (migration 164).
 *
 * Each key follows the same three-state rule as the other account settings patches:
 * ABSENT = leave the column alone, `null` = "Prefer not to answer" (clear it), a value = set it.
 */
export interface DemographicsPatch {
  gender?: UserGender | null;
  birthDate?: string | null;
}

/**
 * Validate a demographics patch, returning only the keys that were present.
 *
 * Shared by signup (`createUser`) and Settings (`updateDemographics`) so the two entry points
 * cannot disagree about what a legal birth date is. `now` is injectable for tests.
 *
 * `birthDate` must be a REAL calendar day (`2001-02-29` is rejected — `Date.UTC` rolls it over to
 * March 1st, and the round-trip check catches that), on or after 1900-01-01 (migration 164's
 * CHECK), and not in the future. The future rule lives here rather than in a CHECK because a
 * constraint on CURRENT_DATE is only evaluated at write time and can fail a later restore.
 *
 * (Collected for Immersive World (removed 2026-11-09, archived — docs/ARCHIVED_FEATURES.md).)
 */
export function validateDemographics(patch: DemographicsPatch, now: Date = new Date()): DemographicsPatch {
  const out: DemographicsPatch = {};
  if (patch.gender !== undefined) {
    if (patch.gender !== null && !USER_GENDERS.includes(patch.gender)) {
      throw new ValidationError(`gender must be one of: ${USER_GENDERS.join(', ')}, or null`);
    }
    out.gender = patch.gender;
  }
  if (patch.birthDate !== undefined) {
    if (patch.birthDate !== null) {
      if (typeof patch.birthDate !== 'string' || !ISO_DATE_PATTERN.test(patch.birthDate)) {
        throw new ValidationError('birthDate must be a YYYY-MM-DD date, or null');
      }
      const [y, m, d] = patch.birthDate.split('-').map(Number);
      const asUtc = new Date(Date.UTC(y, m - 1, d));
      const roundTrips =
        asUtc.getUTCFullYear() === y && asUtc.getUTCMonth() === m - 1 && asUtc.getUTCDate() === d;
      if (!roundTrips) throw new ValidationError('birthDate is not a real calendar date');
      if (y < 1900) throw new ValidationError('birthDate must be on or after 1900-01-01');
      // Compared as calendar strings against the server's UTC date. A learner born "today" in a
      // zone ahead of UTC is off by at most a day either way, which this rule does not care about.
      if (patch.birthDate > now.toISOString().slice(0, 10)) {
        throw new ValidationError('birthDate cannot be in the future');
      }
    }
    out.birthDate = patch.birthDate;
  }
  return out;
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
   * Create an account whose channel (email or phone) has ALREADY been verified
   * (docs/LOGIN_REWORK.md Q14: verify first, then details). Called by SignInService once a
   * sign-up ticket checks out; never directly from an HTTP body.
   *
   * Email accounts carry a password (Q9); phone accounts never do (Q3). The username is
   * required, unique and validated (Q20–Q21); the name is optional (Q19).
   */
  async createUser(input: NewAccountInput): Promise<User> {
    const email = input.email ? input.email.trim().toLowerCase() : null;
    const phone = input.phone ?? null;
    if (!email === !phone) {
      throw new ValidationError('An account is created with exactly one of email or phone');
    }
    if (email) {
      this.validateEmail(email);
      if (!input.password) throw new ValidationError('Password is required');
      this.validatePasswordStrength(input.password);
      if (await this.userDAL.findByEmail(email)) throw new DuplicateError('Email already exists');
    } else if (input.password) {
      // A password belongs to the email channel (chk_users_password_needs_email).
      throw new ValidationError('A phone account has no password');
    }
    if (phone && (await this.userDAL.findByPhone(phone))) {
      throw new DuplicateError('Phone number already in use');
    }
    const name = this.normalizeOptionalName(input.name);
    const username = await this.assertUsernameAvailable(input.username);

    const hashedPassword = input.password ? await bcrypt.hash(input.password, SALT_ROUNDS) : null;

    // `timezone` is resolved rather than passed through, for two reasons: the
    // column is NOT NULL, and `buildInsertQuery` inserts every key it is given —
    // so a `timezone: undefined` from a caller that omitted it would try to write
    // NULL. resolveTimezone maps both an absent and a bogus zone to 'UTC', which
    // is the column default, so an omitting caller behaves exactly as before.
    //
    // Setting it HERE, at creation, is what stops an account being born on a zone
    // it never chose: until this existed, a user's row read 'UTC' until their next
    // login or first minute point, and every 04:00-local boundary (streak cron,
    // AI usage day, study-challenge windows) was computed in the wrong zone
    // meanwhile.
    //
    // `gender` / `birthDate` (migration 164) are validated and then written as explicit
    // values — `null` when the learner chose "Prefer not to answer" or the caller omitted them
    // — for the same `buildInsertQuery` reason as `timezone`: an `undefined` key would be
    // inserted too, and an explicit null says the same thing on purpose.
    const demographics = validateDemographics({ gender: input.gender, birthDate: input.birthDate });
    const now = new Date();
    const newUser = await this.userDAL.create({
      email,
      phone,
      password: hashedPassword,
      username,
      name,
      emailVerifiedAt: email ? now : null,
      phoneVerifiedAt: phone ? now : null,
      timezone: resolveTimezone(input.timezone),
      gender: demographics.gender ?? null,
      birthDate: demographics.birthDate ?? null,
    });

    return this.toClientUser(newUser);
  }

  /**
   * A row about to be sent to its owner: the password hash replaced by `hasPassword`
   * (wire.ts → UserProfile.hasPassword). Rows from `findById` already carry `hasPassword`.
   */
  toClientUser(user: User): User {
    if ('password' in user) {
      user.hasPassword = !!user.password;
      delete user.password;
    }
    return user;
  }

  /**
   * Normalize and check a username, and confirm nobody else holds it. Returns the stored
   * form. `forUserId` lets an account keep (re-save) its own name.
   */
  async assertUsernameAvailable(raw: string, forUserId?: string): Promise<string> {
    if (typeof raw !== 'string') throw new ValidationError('Username is required');
    const username = normalizeUsername(raw);
    const problem = usernameProblem(username);
    if (problem) throw new ValidationError(problem);
    const holder = await this.userDAL.findByUsername(username);
    if (holder && holder.id !== forUserId) throw new DuplicateError('That username is taken');
    return username;
  }

  /**
   * A free username derived from `seed` (a name or an email's local part), for prefilling
   * the sign-up form. The same derivation as migration 188's backfill: lowercase, runs of
   * other characters → "_", "u_" prefix when it does not start with a letter, "learner" when
   * empty, cut to 20, lowest free numeric suffix on a clash.
   */
  async suggestUsername(seed: string | null | undefined): Promise<string> {
    let base = (seed ?? '').toLowerCase().replace(/[^a-z0-9]+/g, '_').replace(/^_+|_+$/g, '');
    if (!/^[a-z]/.test(base)) base = base === '' ? 'learner' : `u_${base}`;
    base = base.slice(0, USERNAME_MAX_LENGTH).padEnd(3, '_');
    let candidate = base;
    // Bounded: a real collision run is a handful; the cap only guards a pathological table.
    for (let n = 2; n < 10000; n++) {
      if (!RESERVED_USERNAMES.includes(candidate) && !(await this.userDAL.findByUsername(candidate))) {
        return candidate;
      }
      const suffix = String(n);
      candidate = base.slice(0, USERNAME_MAX_LENGTH - suffix.length) + suffix;
    }
    throw new DALError('Could not find a free username', 'ERR_USERNAME_EXHAUSTED');
  }

  /**
   * Change the account's username (Q21: any time, no cooldown, globally unique). The old
   * name is free for anyone immediately.
   */
  async changeUsername(userId: string, raw: string): Promise<User> {
    if (!userId) throw new ValidationError('User ID is required');
    const username = await this.assertUsernameAvailable(raw, userId);
    return this.toClientUser(await this.userDAL.update(userId, { username }));
  }

  /** Set or clear the optional display name (Q19, Q24). */
  async changeName(userId: string, raw: string | null): Promise<User> {
    if (!userId) throw new ValidationError('User ID is required');
    const name = this.normalizeOptionalName(raw);
    return this.toClientUser(await this.userDAL.update(userId, { name }));
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

    // An unknown email, and an account with no password, still pay for one bcrypt compare
    // and get the same message as a wrong password, so neither the text nor the timing says
    // whether the email is registered (docs/LOGIN_REWORK.md Q13 / Q17).
    const hash = user?.password ?? (await dummyPasswordHash());
    const isPasswordValid = await bcrypt.compare(password, hash);
    if (!user || !user.password || !isPasswordValid) {
      throw new ValidationError(WRONG_CREDENTIALS_MESSAGE);
    }

    return this.issueSession(user);
  }

  /**
   * The access token + client-safe user for an account that has just proven who it is (a
   * password, an email code, a Firebase-verified phone). The refresh token is issued by the
   * controller (`issueRefreshToken`) because it rides a cookie.
   */
  issueSession(user: User): AuthResponse {
    const token = this.generateAccessToken(user);
    return { user: this.toClientUser(user), token };
  }

  /**
   * Sign a short-lived stateless access-token JWT for a user. Shared by login
   * and refresh so both encode the same claims/lifetime.
   */
  private generateAccessToken(user: User): string {
    // `userId` only (docs/LOGIN_REWORK.md § 4d): a phone account has no email, and no server
    // code read the old `email` claim (authMiddleware's `req.user` is `{ userId }`).
    return jwt.sign(
      { userId: user.id },
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
    
    // The hash by id (an account with no email still has an id). A phone-only account has no
    // password to change.
    const passwordHash = await this.userDAL.findPasswordHashById(userId);
    if (!passwordHash) {
      throw new ValidationError('This account has no password');
    }
    
    // Verify current password (business logic)
    const isCurrentPasswordValid = await bcrypt.compare(currentPassword, passwordHash);
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
   * Set a new password without the current one. ONLY for flows that proved the account
   * another way first (SignInService.resetPassword: an emailed reset code). Requires an email
   * on the account (chk_users_password_needs_email).
   */
  async setPassword(userId: string, newPassword: string): Promise<void> {
    if (!userId) throw new ValidationError('User ID is required');
    this.validatePasswordStrength(newPassword);
    const hashed = await bcrypt.hash(newPassword, SALT_ROUNDS);
    const success = await this.userDAL.updatePassword(userId, hashed);
    if (!success) throw new DALError('Failed to update password', 'ERR_PASSWORD_UPDATE_FAILED');
  }

  /**
   * Whether `password` is this account's password (false when the account has none). For
   * step-up re-authentication (SignInService.verifyStepUp, docs/LOGIN_REWORK.md Q24).
   */
  async checkPassword(userId: string, password: string): Promise<boolean> {
    if (!userId || typeof password !== 'string' || !password) return false;
    const hash = await this.userDAL.findPasswordHashById(userId);
    // A compare against the dummy hash keeps the timing the same for a passwordless account.
    const ok = await bcrypt.compare(password, hash ?? (await dummyPasswordHash()));
    return !!hash && ok;
  }

  /**
   * Delete an account with NO credential check. ONLY for SignInService.deleteAccountWithStepUp,
   * which checked a step-up token first (the one path for a phone account, which has no
   * password). CASCADE deletes the account's data.
   */
  async deleteUserUnchecked(userId: string): Promise<void> {
    if (!userId) throw new ValidationError('User ID is required');
    const success = await this.userDAL.deleteUser(userId);
    if (!success) throw new DALError('Failed to delete user account', 'ERR_USER_DELETE_FAILED');
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
    
    // The hash by id. A phone-only account has none: it deletes through the step-up path
    // (SignInService, docs/LOGIN_REWORK.md Q24), not this one.
    const passwordHash = await this.userDAL.findPasswordHashById(userId);
    if (!passwordHash) {
      throw new ValidationError('This account has no password');
    }
    
    // Verify password before deletion (security check)
    const isPasswordValid = await bcrypt.compare(password, passwordHash);
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
  async updateUserProfile(userId: string, updateData: { selectedLanguage?: Language; avatarIconId?: string | null }): Promise<User> {
    // No `email` / `name` here any more (docs/LOGIN_REWORK.md § 4d, Q24): an email change must
    // be verified (SignInService), and the name has its own `changeName`. This used to accept
    // an unverified email change, though no route passed one.
    if (!userId) {
      throw new ValidationError('User ID is required');
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
   *
   * Also returns `enabledWorlds`: the worlds whose goal this call switched OFF → ON
   * (a re-send of an already-on goal is not an enabling). UserController.updateGoals
   * hands them to FocusModeService.autoEnableIfCrowded (docs/FOCUS_MODE.md § 1a).
   */
  async updateGoals(
    userId: string,
    goals: { readingGoal?: boolean; writingGoal?: boolean }
  ): Promise<{ user: User; enabledWorlds: Array<'reading' | 'writing'> }> {
    if (!userId) {
      throw new ValidationError('User ID is required');
    }
    const updateData: { readingGoal?: boolean; writingGoal?: boolean } = {};
    if (typeof goals.readingGoal === 'boolean') updateData.readingGoal = goals.readingGoal;
    if (typeof goals.writingGoal === 'boolean') updateData.writingGoal = goals.writingGoal;
    if (Object.keys(updateData).length === 0) {
      throw new ValidationError('At least one of readingGoal / writingGoal (boolean) is required');
    }
    // Read the flags BEFORE the write so an off → on flip can be told apart from a no-op.
    const before = await this.userDAL.findById(userId);
    const updatedUser = await this.userDAL.update(userId, updateData);
    delete updatedUser.password;
    const enabledWorlds: Array<'reading' | 'writing'> = [];
    if (updateData.readingGoal === true && before?.readingGoal !== true) enabledWorlds.push('reading');
    if (updateData.writingGoal === true && before?.writingGoal !== true) enabledWorlds.push('writing');
    return { user: updatedUser, enabledWorlds };
  }

  /**
   * Update the account's display preferences. Deliberately separate from
   * updateGoals: goals change what "mastered" means, these only change how
   * things are drawn. New display knobs (pinyin visibility, pinyin color, …)
   * migrate here from localStorage as they become account-level.
   * See docs/EXAMPLE_SENTENCES.md and docs/CJK_TYPEFACE_LAB.md.
   *
   * Every setting is OPTIONAL and only applied when present, so a client that knows
   * about one knob can send it without clobbering the others. At least one must be
   * present, or the call is a no-op worth rejecting.
   */
  async updateDisplaySettings(
    userId: string,
    settings: { showSegmentSpaces?: boolean; chineseFont?: string },
  ): Promise<User> {
    if (!userId) {
      throw new ValidationError('User ID is required');
    }
    const updateData: { showSegmentSpaces?: boolean; chineseFont?: string } = {};
    if (typeof settings.showSegmentSpaces === 'boolean') updateData.showSegmentSpaces = settings.showSegmentSpaces;
    if (settings.chineseFont !== undefined) {
      // Allow-listed here as well as in the controller: the column is a bare text
      // column, so this is the last place an unknown id can be stopped before it
      // reaches a row that the client would then have to fall back on.
      if (!CHINESE_FONT_IDS.includes(settings.chineseFont)) {
        throw new ValidationError(`chineseFont must be one of: ${CHINESE_FONT_IDS.join(', ')}`);
      }
      updateData.chineseFont = settings.chineseFont;
    }
    if (Object.keys(updateData).length === 0) {
      throw new ValidationError(
        'At least one display setting (showSegmentSpaces: boolean, chineseFont: string) is required',
      );
    }
    const updatedUser = await this.userDAL.update(userId, updateData);
    delete updatedUser.password;
    return updatedUser;
  }

  /**
   * Set or clear the learner's gender / date of birth (migration 164) — the Settings half of the
   * question signup asks. Deliberately NOT part of `updateDisplaySettings`: these change how the
   * app treats the learner (Immersive World's body and NPC address, now archived), not how
   * anything is drawn.
   *
   * Every key is optional; `null` is a real value ("Prefer not to answer"). At least one key
   * must be present.
   */
  async updateDemographics(userId: string, patch: DemographicsPatch): Promise<User> {
    if (!userId) {
      throw new ValidationError('User ID is required');
    }
    const updateData = validateDemographics(patch);
    if (Object.keys(updateData).length === 0) {
      throw new ValidationError('At least one of gender or birthDate is required');
    }
    const updatedUser = await this.userDAL.update(userId, updateData);
    delete updatedUser.password;
    return updatedUser;
  }


  // NOTE: getTotalMinutePoints() was removed by migration 130 along with its endpoint
  // (GET /api/users/:id/total-minute-points). Wallet + streak are per-language now, so there
  // is no single figure to roll up here; user-facing callers use
  // UserMinutePointsService.getLanguageSummary, and the leaderboard uses
  // IUserLanguagesDAL.getTotalsForAllUsers(). See docs/PER_LANGUAGE_STREAKS.md.

  /**
   * Session bookkeeping: keep `users.timezone` current for the caller.
   *
   * Called from three places, which together are the app's timezone-freshness
   * contract (docs/STUDY_CHALLENGE.md § 2, "whose clock"):
   *   * `POST /api/auth/onLogin` — login and session restore;
   *   * `POST /api/auth/refresh` — the ~15-minute heartbeat, which is the only
   *     one that catches a zone changing MID-session (travel, OS clock fix);
   *   * a foregrounded tab whose zone no longer matches what it last sent.
   * Creation is covered separately by `createUser`, and the minute-point paths
   * refresh it too (UserMinutePointsService).
   *
   * Why it matters beyond the streak cron it was written for: every 04:00-local
   * boundary in the app derives from this column, and the user-visible ones —
   * study-challenge accept/test windows — are serialized to the client as
   * ABSOLUTE instants and then formatted in the BROWSER's zone. So a stale
   * column does not merely mis-bucket a day server-side; it renders a visibly
   * wrong hour ("test opens 9 PM Thursday" for a Friday-04:00 boundary computed
   * in UTC for a UTC−7 viewer).
   *
   * A `tz` of `undefined` is a no-op; a bogus one resolves to 'UTC'.
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
   * Validate email format
   */
  validateEmail(email: string): void {
    const emailRegex = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
    if (!emailRegex.test(email)) {
      throw new ValidationError('Invalid email format');
    }
    
    if (email.length > 255) {
      throw new ValidationError('Email is too long (maximum 255 characters)');
    }
  }

  /**
   * The optional display name (Q19): trimmed; empty → null. Letters in ANY script (a Chinese
   * learner's name was rejected by the old A–Z-only rule), plus spaces, hyphens, apostrophes
   * and periods; 1–100 characters.
   */
  private normalizeOptionalName(raw: string | null | undefined): string | null {
    if (raw === null || raw === undefined) return null;
    if (typeof raw !== 'string') throw new ValidationError('Name must be text');
    const name = raw.trim().replace(/\s+/g, ' ');
    if (name === '') return null;
    if (name.length > 100) {
      throw new ValidationError('Name is too long (maximum 100 characters)');
    }
    if (!/^[\p{L}\p{M}\s\-'.]+$/u.test(name)) {
      throw new ValidationError('Name can only contain letters, spaces, hyphens, apostrophes, and periods');
    }
    return name;
  }

  /**
   * Validate password strength
   */
  validatePasswordStrength(password: string): void {
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
