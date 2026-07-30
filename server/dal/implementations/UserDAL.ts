import { PoolClient } from 'pg';
import { BaseDAL } from '../base/BaseDAL.js';
import { IUserDAL } from '../interfaces/IUserDAL.js';
import { dbManager as defaultDbManager, DatabaseManager } from '../base/DatabaseManager.js';
import { User, UserCreateData, UserUpdateData } from '../../types/index.js';
import { NotFoundError, ValidationError } from '../../types/dal.js';

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
      return await client.query('SELECT id, email, name, "isPublic", "isValidator", "isTemplateAuthor", "avatarIconId", "selectedLanguage", "readingGoal", "writingGoal", "showSegmentSpaces", "lastMinutePointIncrement", "createdAt" FROM Users WHERE id = $1', [id]);
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
   * Get all users with their total minute points (used for admin/non-leaderboard queries)
   */
  async getAllUsersWithTotalPoints(): Promise<Array<{ userId: string; email: string; name: string; totalMinutePoints: number }>> {
    const result = await this.dbManager.executeQuery<{
      id: string;
      email: string;
      name: string;
      totalminutepoints: number;
    }>(async (client) => {
      // Balances are per-(user,language) since migration 134, so the cross-language
      // total is rolled up here. The aggregate is over one row per language the user
      // studies (a handful), NOT over the userminutepoints day ledger — it does not
      // grow with account age.
      return await client.query(`
        SELECT
          u.id,
          u.email,
          u.name,
          COALESCE(t.net, 0) as totalminutepoints
        FROM Users u
        LEFT JOIN (
          SELECT "userId", SUM("netMinutePoints") AS net
          FROM user_language_minute_totals GROUP BY "userId"
        ) t ON t."userId" = u.id
        ORDER BY totalminutepoints DESC NULLS LAST, u."createdAt" ASC
      `);
    });

    return result.recordset.map(row => ({
      userId: row.id,
      email: row.email,
      name: row.name,
      totalMinutePoints: row.totalminutepoints || 0
    }));
  }

  /**
   * Get all users that participate in the leaderboard with their totals + streak.
   * Returns isPublic so callers can mask streak from non-public users at the response layer.
   */
  async getPublicUsersWithTotalPoints(): Promise<Array<{ userId: string; email: string; name: string; totalMinutePoints: number; currentStreak: number; isPublic: boolean; avatarIconId: string | null }>> {
    const result = await this.dbManager.executeQuery<{
      id: string;
      email: string;
      name: string;
      totalminutepoints: number;
      currentstreak: number;
      ispublic: boolean;
      avatariconid: string | null;
    }>(async (client) => {
      // Per-language balances/streaks (migration 134) rolled up for the single global
      // row the leaderboard renders. `net` sums across languages (equivalent to the old
      // users."totalMinutePoints"); `streak` takes the user's BEST language streak,
      // since there is no longer one global streak and showing the highest is the
      // charitable read of "this user's streak". Aggregated over one row per language,
      // so the cost is bounded by language count rather than account age.
      return await client.query(`
        SELECT
          u.id,
          u.email,
          u.name,
          COALESCE(t.net, 0) as totalminutepoints,
          COALESCE(t.streak, 0) as currentstreak,
          u."isPublic" as ispublic,
          u."avatarIconId" as avatariconid
        FROM Users u
        LEFT JOIN (
          SELECT "userId",
                 SUM("netMinutePoints") AS net,
                 MAX("currentStreak")   AS streak
          FROM user_language_minute_totals GROUP BY "userId"
        ) t ON t."userId" = u.id
        ORDER BY totalminutepoints DESC NULLS LAST, u."createdAt" ASC
      `);
    });

    return result.recordset.map(row => ({
      userId: row.id,
      email: row.email,
      name: row.name,
      totalMinutePoints: row.totalminutepoints || 0,
      currentStreak: row.currentstreak || 0,
      isPublic: row.ispublic === true,
      avatarIconId: row.avatariconid ?? null
    }));
  }



}
