import { PoolClient } from 'pg';
import { BaseDAL } from '../base/BaseDAL.js';
import { IUserDAL, UserScoringProfile, UserPublicProfile } from '../interfaces/IUserDAL.js';
import { dbManager as defaultDbManager, DatabaseManager } from '../base/DatabaseManager.js';
import { User, UserCreateData, UserUpdateData } from '../../types/index.js';
import { ValidationError } from '../../types/dal.js';

/**
 * User Data Access Layer implementation
 * Handles all database operations for User entities
 */
/**
 * Turn pg's DATE value for `users."birthDate"` (migration 164) into the wire's `YYYY-MM-DD`.
 *
 * node-postgres parses a DATE into a JS Date at LOCAL midnight of the server process. Sent as
 * is, that serializes through `toISOString()` as a UTC instant — which, on any server east of
 * UTC, is the PREVIOUS day. So the local getters are read back here, recovering the exact
 * calendar date pg was given. Done per-column rather than with a global `setTypeParser(1082)`
 * because other DATE columns (`user_languages."lastStreakDate"`, `userworkpoints.date`) have
 * readers written against the Date behaviour.
 *
 * (Its first reader, Immersive World's learner description, is removed 2026-11-09, archived — docs/ARCHIVED_FEATURES.md.)
 */
function withIsoBirthDate<T extends User | null | undefined>(user: T): T {
  if (!user) return user;
  const raw = (user as { birthDate?: unknown }).birthDate;
  if (raw instanceof Date) {
    const pad = (n: number) => String(n).padStart(2, '0');
    user.birthDate = `${raw.getFullYear()}-${pad(raw.getMonth() + 1)}-${pad(raw.getDate())}`;
  }
  return user;
}

export class UserDAL extends BaseDAL<User, UserCreateData, UserUpdateData> implements IUserDAL {
  constructor(dbManager: DatabaseManager = defaultDbManager) {
    super(dbManager, 'Users', 'id'); // Use proper table name with camelCase columns
  }

  /**
   * Find user by email (without password for security)
   */
  async findByEmail(email: string): Promise<User | null> {
    if (!email) {
      throw new ValidationError('Email is required');
    }

    // Normalize email to lowercase for case-insensitive lookup
    const normalizedEmail = email.toLowerCase();

    const result = await this.dbManager.executeQuery<User>(async (client) => {
      return await client.query('SELECT id, email, name, username, "selectedLanguage", "createdAt" FROM Users WHERE email = $1', [normalizedEmail]);
    });

    return result.recordset[0] || null;
  }

  /**
   * The account holding a friend code (migration 187). Id only: the caller
   * (FriendsService.sendRequest) re-reads the target through `findById` like the
   * by-UUID path, so the two paths cannot diverge. Served by `uq_users_friend_code`.
   */
  async findByFriendCode(code: string): Promise<{ id: string } | null> {
    if (!code) {
      throw new ValidationError('Friend code is required');
    }
    const result = await this.dbManager.executeQuery<{ id: string }>(async (client) => {
      return await client.query('SELECT id FROM users WHERE "friendCode" = $1', [code]);
    });
    return result.recordset[0] || null;
  }

  /**
   * The account holding this username (migration 188), id only, or null. `username` must
   * already be normalized (wire.ts → normalizeUsername). Served by `uq_users_username`.
   * Used by add-friend-by-username and the username-taken check.
   */
  async findByUsername(username: string): Promise<{ id: string } | null> {
    if (!username) {
      throw new ValidationError('Username is required');
    }
    const result = await this.dbManager.executeQuery<{ id: string }>(async (client) => {
      return await client.query('SELECT id FROM users WHERE username = $1', [username]);
    });
    return result.recordset[0] || null;
  }

  /**
   * The account holding this E.164 phone number (migration 188), id only, or null. Served by
   * `uq_users_phone`. Used by phone sign-in to decide known account vs new sign-up.
   */
  async findByPhone(phone: string): Promise<{ id: string } | null> {
    if (!phone) {
      throw new ValidationError('Phone is required');
    }
    const result = await this.dbManager.executeQuery<{ id: string }>(async (client) => {
      return await client.query('SELECT id FROM users WHERE phone = $1', [phone]);
    });
    return result.recordset[0] || null;
  }

  /**
   * The password hash for an account, by id (null when it has none: a phone-only account).
   * Replaces the old `findByEmailWithPassword(findById(id).email)` round-trip in
   * changePassword / deleteUser, which cannot work for an account with no email.
   */
  async findPasswordHashById(id: string): Promise<string | null> {
    if (!id) {
      throw new ValidationError('User ID is required');
    }
    const result = await this.dbManager.executeQuery<{ password: string | null }>(async (client) => {
      return await client.query('SELECT password FROM users WHERE id = $1', [id]);
    });
    return result.recordset[0]?.password ?? null;
  }

  /**
   * Find user by email including password (for authentication)
   */
  async findByEmailWithPassword(email: string): Promise<User | null> {
    if (!email) {
      throw new ValidationError('Email is required');
    }

    // Normalize email to lowercase for case-insensitive lookup
    const normalizedEmail = email.toLowerCase();

    const result = await this.dbManager.executeQuery<User>(async (client) => {
      return await client.query('SELECT * FROM Users WHERE email = $1', [normalizedEmail]);
    });

    // SELECT * — so birthDate arrives as a pg Date, and login returns this row to the client.
    return withIsoBirthDate(result.recordset[0] || null);
  }

  /**
   * Update user password
   */
  async updatePassword(id: string, hashedPassword: string): Promise<boolean> {
    if (!id) {
      throw new ValidationError('User ID is required');
    }
    if (!hashedPassword) {
      throw new ValidationError('Hashed password is required');
    }

    const result = await this.dbManager.executeQuery(async (client) => {
      return await client.query('UPDATE Users SET password = $1 WHERE id = $2', [hashedPassword, id]);
    });

    return result.rowsAffected > 0;
  }

  /**
   * Find users created after a specific date
   */
  async findUsersCreatedAfter(date: Date): Promise<User[]> {
    const result = await this.dbManager.executeQuery<User>(async (client) => {
      return await client.query('SELECT id, email, name, "createdAt" FROM Users WHERE "createdAt" > $1 ORDER BY "createdAt" DESC', [date]);
    });

    return result.recordset;
  }

  /**
   * Override findById to exclude password by default
   */
  async findById(id: string): Promise<User | null> {
    if (!id) {
      throw new ValidationError('User ID is required');
    }

    // ⚠️ "timezone" MUST stay in this list. It is not a display field: it is the
    // input to every 04:00-local boundary computed in TypeScript rather than SQL —
    // StudyChallengeService.timezoneOf reads it from here, and `resolveTimezone`
    // silently falls back to 'UTC' for an undefined value. Omitting the column
    // therefore does not fail, it just moves every accept deadline and test window
    // to 04:00 UTC (measured 2026-09-01: a Los Angeles player was told their Friday
    // test opened "9 PM Thursday", and `isTestWindowOpen` agreed with the wrong
    // answer). The arena and the streak read the column in SQL and were unaffected,
    // which is why the bug was confined to Study Challenge.
    const result = await this.dbManager.executeQuery<User>(async (client) => {
      // `username`, `phone`, the two verified-at stamps and the derived `hasPassword` were added
      // with migration 188 (docs/LOGIN_REWORK.md § 4d); `password` itself never leaves this query.
      return await client.query('SELECT id, email, name, username, phone, "emailVerifiedAt", "phoneVerifiedAt", (password IS NOT NULL) AS "hasPassword", "friendCode", "isValidator", "isFeatureTester", "isAdmin", "avatarIconId", "selectedLanguage", "readingGoal", "writingGoal", "showSegmentSpaces", "chineseFont", "gender", "birthDate", "arenaMessage", "timezone", "lastMinutePointIncrement", "createdAt" FROM Users WHERE id = $1', [id]);
    });

    // ⚠️ "gender" and "birthDate" (migration 164) are PRIVATE to the account, as are email and
    // timezone. Every client path through this read is the caller's OWN row (/api/auth/me,
    // GET /api/users/:id — self-only, see UserController.getUserById). Never return this row for ANOTHER user; public profile reads select their own
    // columns (UserDAL.findPublicProfileById).
    return withIsoBirthDate(result.recordset[0] || null);
  }

  /**
   * Override create to handle user-specific validation
   */
  protected validateCreateData(data: UserCreateData): void {
    super.validateCreateData(data);
    
    // Structural rules only, mirroring migration 188's constraints (chk_users_has_channel,
    // chk_users_password_needs_email, username NOT NULL). The business rules (password
    // strength, username shape and uniqueness, the optional name) live in
    // UserService.createUser. This used to require email, name AND password, which a phone
    // account or a nameless sign-up cannot satisfy.
    if (!data.email && !data.phone) {
      throw new ValidationError('An email or a phone number is required');
    }
    if (data.password && !data.email) {
      throw new ValidationError('A password requires an email');
    }
    if (!data.username) {
      throw new ValidationError('Username is required');
    }
    if (data.email) {
      const emailRegex = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
      if (!emailRegex.test(data.email)) {
        throw new ValidationError('Invalid email format');
      }
    }
  }

  /**
   * Override update to handle user-specific validation and email normalization
   */
  protected validateUpdateData(data: UserUpdateData): void {
    super.validateUpdateData(data);
    
    if (data.email) {
      const emailRegex = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
      if (!emailRegex.test(data.email)) {
        throw new ValidationError('Invalid email format');
      }
    }
  }

  /**
   * Override update to normalize email to lowercase
   */
  async update(id: string, data: UserUpdateData): Promise<User> {
    // Normalize email to lowercase if provided
    if (data.email) {
      data = {
        ...data,
        email: data.email.toLowerCase()
      };
    }
    
    // RETURNING * — normalize birthDate for the same reason as findByEmailWithPassword.
    return withIsoBirthDate(await super.update(id, data));
  }

  /**
   * Override create for the same RETURNING * reason — register returns this row verbatim.
   */
  async create(data: UserCreateData): Promise<User> {
    return withIsoBirthDate(await super.create(data));
  }

  /**
   * Override buildInsertQuery to exclude sensitive fields from logging
   */
  protected buildInsertQuery(data: UserCreateData): {
    columns: string;
    placeholders: string;
    values: any[];
  } {
    // Normalize email to lowercase before insertion (null for a phone-only account;
    // migration 188's chk_users_email_lowercase enforces the same).
    const normalizedData = {
      ...data,
      email: data.email ? data.email.toLowerCase() : null
    };
    
    const result = super.buildInsertQuery(normalizedData);
    
    // Log creation by username: no password, and no email or phone (contact details stay
    // out of the logs).
    console.log(`Creating user: ${normalizedData.username}`);
    
    return result;
  }

  /**
   * Update last minute-point increment timestamp for rate limiting.
   * Only called after a successful increment.
   */
  async updateLastMinutePointIncrement(userId: string, timestamp: Date): Promise<boolean> {
    if (!userId) {
      throw new ValidationError('User ID is required');
    }
    if (!timestamp) {
      throw new ValidationError('Timestamp is required');
    }

    const result = await this.dbManager.executeQuery(async (client) => {
      return await client.query(
        'UPDATE Users SET "lastMinutePointIncrement" = $1 WHERE id = $2',
        [timestamp, userId]
      );
    });

    return result.rowsAffected > 0;
  }

  /**
   * Compare-and-set the minute-point cooldown. See IUserDAL.claimMinutePointIncrement
   * for WHY this must be one statement rather than a read followed by a write.
   *
   * The WHERE clause is the entire rate limiter: the row is stamped only if it was
   * eligible, and Postgres serialises concurrent updates of the same row, so a burst
   * of N simultaneous requests produces exactly one rowCount 1 and N-1 rowCount 0.
   * `$1::timestamptz - make_interval(secs => $3)` is evaluated server-side so the
   * comparison never depends on the caller's clock.
   */
  async claimMinutePointIncrement(userId: string, now: Date, cooldownSeconds: number): Promise<boolean> {
    if (!userId) {
      throw new ValidationError('User ID is required');
    }
    if (!now) {
      throw new ValidationError('Timestamp is required');
    }

    const result = await this.dbManager.executeQuery(async (client) => {
      return await client.query(
        `UPDATE Users
            SET "lastMinutePointIncrement" = $1
          WHERE id = $2
            AND ("lastMinutePointIncrement" IS NULL
                 OR "lastMinutePointIncrement" <= $1::timestamptz - make_interval(secs => $3))`,
        [now, userId, cooldownSeconds]
      );
    });

    return result.rowsAffected > 0;
  }

  /**
   * Persist the user's current timezone, but only when it actually differs from
   * what's stored. IS DISTINCT FROM treats NULL safely. Used by the streak-
   * expiration cron, which needs each user's local 4 AM-bounded "today".
   */
  async updateTimezoneIfChanged(userId: string, timezone: string): Promise<void> {
    if (!userId) {
      throw new ValidationError('User ID is required');
    }
    if (!timezone) {
      return;
    }

    await this.dbManager.executeQuery(async (client) => {
      return await client.query(
        'UPDATE Users SET "timezone" = $2 WHERE id = $1 AND "timezone" IS DISTINCT FROM $2',
        [userId, timezone]
      );
    });
  }

  /**
   * Delete a user and all related data (CASCADE DELETE will handle related records)
   */
  async deleteUser(userId: string): Promise<boolean> {
    if (!userId) {
      throw new ValidationError('User ID is required');
    }

    const result = await this.dbManager.executeQuery(async (client) => {
      return await client.query('DELETE FROM Users WHERE id = $1', [userId]);
    });

    return result.rowsAffected > 0;
  }

  /**
   * Leaderboard roster: public identity for every user, no points.
   *
   * Since migration 130 wallets are per-language, so ranking cannot be expressed as
   * an ORDER BY on this table any more. The caller joins
   * IUserLanguagesDAL.getTotalsForAllUsers() (one grouped query) and sorts on
   * the summed wallet. Ordering here is stable-by-signup only, purely so the join
   * output is deterministic before the caller re-sorts.
   *
   * Public identity only: `username`, never `email` (the board is served to every user,
   * docs/LOGIN_REWORK.md Q20). `isPublic` is gone (Q7): every account's streak is shown.
   */
  async getLeaderboardRoster(): Promise<Array<{ userId: string; username: string; name: string | null; avatarIconId: string | null }>> {
    const result = await this.dbManager.executeQuery<{
      id: string;
      username: string;
      name: string | null;
      avatariconid: string | null;
    }>(async (client) => {
      return await client.query(`
        SELECT
          id,
          username,
          name,
          "avatarIconId" as avatariconid
        FROM Users
        ORDER BY "createdAt" ASC
      `);
    });

    return result.recordset.map(row => ({
      userId: row.id,
      username: row.username,
      name: row.name ?? null,
      avatarIconId: row.avatariconid ?? null
    }));
  }

  async findScoringProfilesByIds(userIds: string[]): Promise<UserScoringProfile[]> {
    // An empty list is a legitimate call (a user with no friends still asks for
    // their own row, but a caller may hand us nothing); short-circuit rather than
    // issuing `= ANY('{}')`.
    if (!Array.isArray(userIds) || userIds.length === 0) return [];

    const result = await this.dbManager.executeQuery<{
      id: string;
      username: string;
      name: string | null;
      avatariconid: string | null;
      selectedlanguage: string | null;
      readinggoal: boolean | null;
      writinggoal: boolean | null;
    }>(async (client) => {
      // One `= ANY($1::uuid[])` rather than a per-id loop: the friends leaderboard
      // reads every friend at once and an N+1 here would scale with the friend list.
      return await client.query(`
        SELECT
          id,
          username,
          name,
          "avatarIconId"     AS avatariconid,
          "selectedLanguage" AS selectedlanguage,
          "readingGoal"      AS readinggoal,
          "writingGoal"      AS writinggoal
        FROM Users
        WHERE id = ANY($1::uuid[])
      `, [userIds]);
    });

    return result.recordset.map(row => ({
      userId: row.id,
      username: row.username,
      name: row.name ?? null,
      avatarIconId: row.avatariconid ?? null,
      selectedLanguage: row.selectedlanguage ?? null,
      // The columns are NOT NULL with a false default (migration 101), but a null
      // here must read as "goal off" rather than crediting a bar they never chose.
      readingGoal: row.readinggoal === true,
      writingGoal: row.writinggoal === true,
    }));
  }

  async findPublicProfileById(userId: string): Promise<UserPublicProfile | null> {
    if (!userId) return null;

    const result = await this.dbManager.executeQuery<{
      id: string;
      username: string;
      name: string | null;
      avatariconid: string | null;
      selectedlanguage: string | null;
      readinggoal: boolean | null;
      writinggoal: boolean | null;
      createdat: Date | string | null;
    }>(async (client) => {
      // Deliberately the same column set as findScoringProfilesByIds plus createdAt,
      // and deliberately NOT `SELECT *`: this row is shipped to another user, so the
      // columns it may contain are enumerated here rather than filtered downstream.
      // `password` must never be one query away from a public payload.
      return await client.query(`
        SELECT
          id,
          username,
          name,
          "avatarIconId"     AS avatariconid,
          "selectedLanguage" AS selectedlanguage,
          "readingGoal"      AS readinggoal,
          "writingGoal"      AS writinggoal,
          "createdAt"        AS createdat
        FROM Users
        WHERE id = $1::uuid
      `, [userId]);
    });

    const row = result.recordset[0];
    if (!row) return null;
    return {
      userId: row.id,
      username: row.username,
      name: row.name ?? null,
      avatarIconId: row.avatariconid ?? null,
      selectedLanguage: row.selectedlanguage ?? null,
      readingGoal: row.readinggoal === true,
      writingGoal: row.writinggoal === true,
      createdAt: row.createdat ? new Date(row.createdat).toISOString() : null,
    };
  }

}
