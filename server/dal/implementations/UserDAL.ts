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
      return await client.query('SELECT id, email, name, "selectedLanguage", "createdAt" FROM Users WHERE email = $1', [normalizedEmail]);
    });

    return result.recordset[0] || null;
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

    return result.recordset[0] || null;
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

    const result = await this.dbManager.executeQuery<User>(async (client) => {
      return await client.query('SELECT id, email, name, "isPublic", "isValidator", "isTemplateAuthor", "avatarIconId", "selectedLanguage", "readingGoal", "writingGoal", "showSegmentSpaces", "arenaMessage", "lastMinutePointIncrement", "createdAt" FROM Users WHERE id = $1', [id]);
    });

    return result.recordset[0] || null;
  }

  /**
   * Override create to handle user-specific validation
   */
  protected validateCreateData(data: UserCreateData): void {
    super.validateCreateData(data);
    
    if (!data.email) {
      throw new ValidationError('Email is required');
    }
    if (!data.name) {
      throw new ValidationError('Name is required');
    }
    if (!data.password) {
      throw new ValidationError('Password is required');
    }
    
    // Basic email validation
    const emailRegex = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
    if (!emailRegex.test(data.email)) {
      throw new ValidationError('Invalid email format');
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
    
    return await super.update(id, data);
  }

  /**
   * Override buildInsertQuery to exclude sensitive fields from logging
   */
  protected buildInsertQuery(data: UserCreateData): {
    columns: string;
    placeholders: string;
    values: any[];
  } {
    // Normalize email to lowercase before insertion
    const normalizedData = {
      ...data,
      email: data.email.toLowerCase()
    };
    
    const result = super.buildInsertQuery(normalizedData);
    
    // Log creation without password for security
    console.log(`Creating user: ${normalizedData.email}`);
    
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
   * Leaderboard roster: identity + isPublic for every user, no points.
   *
   * Since migration 130 wallets are per-language, so ranking cannot be expressed as
   * an ORDER BY on this table any more. The caller joins
   * IUserLanguagesDAL.getTotalsForAllUsers() (one grouped query) and sorts on
   * the summed wallet; `isPublic` lets it mask streak from non-public users at the
   * response layer. Ordering here is stable-by-signup only, purely so the join
   * output is deterministic before the caller re-sorts.
   */
  async getLeaderboardRoster(): Promise<Array<{ userId: string; email: string; name: string; isPublic: boolean; avatarIconId: string | null }>> {
    const result = await this.dbManager.executeQuery<{
      id: string;
      email: string;
      name: string;
      ispublic: boolean;
      avatariconid: string | null;
    }>(async (client) => {
      return await client.query(`
        SELECT
          id,
          email,
          name,
          "isPublic" as ispublic,
          "avatarIconId" as avatariconid
        FROM Users
        ORDER BY "createdAt" ASC
      `);
    });

    return result.recordset.map(row => ({
      userId: row.id,
      email: row.email,
      name: row.name,
      isPublic: row.ispublic === true,
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
      email: string;
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
          email,
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
      email: row.email,
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
      email: string;
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
          email,
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
      email: row.email,
      name: row.name ?? null,
      avatarIconId: row.avatariconid ?? null,
      selectedLanguage: row.selectedlanguage ?? null,
      readingGoal: row.readinggoal === true,
      writingGoal: row.writinggoal === true,
      createdAt: row.createdat ? new Date(row.createdat).toISOString() : null,
    };
  }

}
