import { PoolClient } from 'pg';
import { BaseDAL } from '../base/BaseDAL.js';
import { IUserDAL } from '../interfaces/IUserDAL.js';
import { dbManager } from '../base/DatabaseManager.js';
import { User, UserCreateData, UserUpdateData } from '../../types/index.js';
import { NotFoundError, ValidationError } from '../../types/dal.js';

/**
 * User Data Access Layer implementation
 * Handles all database operations for User entities
 */
export class UserDAL extends BaseDAL<User, UserCreateData, UserUpdateData> implements IUserDAL {
  constructor() {
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
   * Get user statistics including vocab entry count
   */
  async getUserStats(id: string): Promise<{
    totalVocabEntries: number;
    createdAt: Date;
  }> {
    if (!id) {
      throw new ValidationError('User ID is required');
    }

    const result = await this.dbManager.executeQuery<{
      totalvocabentries: string;
      createdat: Date;
    }>(async (client) => {
      return await client.query(`
        SELECT 
          u."createdAt",
          COALESCE(COUNT(v.id), 0) as totalvocabentries
        FROM Users u
        LEFT JOIN VocabEntries v ON u.id = v."userId"
        WHERE u.id = $1
        GROUP BY u.id, u."createdAt"
      `, [id]);
    });

    if (result.recordset.length === 0) {
      throw new NotFoundError(`User with ID ${id} not found`);
    }

    const row = result.recordset[0];
    return {
      totalVocabEntries: parseInt(row.totalvocabentries),
      createdAt: row.createdat
    };
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
   * Find users with their vocabulary entry counts
   */
  async findUsersWithVocabCount(): Promise<Array<User & { vocabCount: number }>> {
    const result = await this.dbManager.executeQuery<{
      id: string;
      email: string;
      name: string;
      createdat: Date;
      vocabcount: string;
    }>(async (client) => {
      return await client.query(`
        SELECT 
          u.id, 
          u.email, 
          u.name, 
          u."createdAt",
          COALESCE(COUNT(v.id), 0) as vocabcount
        FROM Users u
        LEFT JOIN VocabEntries v ON u.id = v."userId"
        GROUP BY u.id, u.email, u.name, u."createdAt"
        ORDER BY vocabcount DESC, u."createdAt" DESC
      `);
    });

    return result.recordset.map(row => ({
      id: row.id,
      email: row.email,
      name: row.name,
      createdAt: row.createdat,
      vocabCount: parseInt(row.vocabcount)
    }));
  }

  /**
   * Override findById to exclude password by default
   */
  async findById(id: string): Promise<User | null> {
    if (!id) {
      throw new ValidationError('User ID is required');
    }

    const result = await this.dbManager.executeQuery<User>(async (client) => {
      return await client.query('SELECT id, email, name, "isPublic", "selectedLanguage", "lastMinutePointIncrement", "createdAt" FROM Users WHERE id = $1', [id]);
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
   * Get total minute points and current streak for a user
   */
  async getTotalMinutePoints(userId: string): Promise<{ totalMinutePoints: number; currentStreak: number }> {
    if (!userId) {
      throw new ValidationError('User ID is required');
    }

    const result = await this.dbManager.executeQuery<{ totalminutepoints: number; currentstreak: number }>(async (client) => {
      return await client.query(
        'SELECT "totalMinutePoints" as totalminutepoints, "currentStreak" as currentstreak FROM Users WHERE id = $1',
        [userId]
      );
    });

    if (result.recordset.length === 0) {
      throw new NotFoundError(`User with ID ${userId} not found`);
    }

    return {
      totalMinutePoints: result.recordset[0].totalminutepoints || 0,
      currentStreak: result.recordset[0].currentstreak || 0
    };
  }

  /**
   * Update total minute points for a user
   */
  async updateTotalMinutePoints(userId: string, totalPoints: number): Promise<boolean> {
    if (!userId) {
      throw new ValidationError('User ID is required');
    }
    if (totalPoints < 0) {
      throw new ValidationError('Total points cannot be negative');
    }

    const result = await this.dbManager.executeQuery(async (client) => {
      return await client.query('UPDATE Users SET "totalMinutePoints" = $1 WHERE id = $2', [totalPoints, userId]);
    });

    return result.rowsAffected > 0;
  }

  /**
   * Increment total minute points for a user
   */
  async incrementTotalMinutePoints(userId: string, pointsToAdd: number): Promise<boolean> {
    if (!userId) {
      throw new ValidationError('User ID is required');
    }
    if (pointsToAdd < 0) {
      throw new ValidationError('Points to add cannot be negative');
    }

    const result = await this.dbManager.executeQuery(async (client) => {
      return await client.query(
        'UPDATE Users SET "totalMinutePoints" = "totalMinutePoints" + $1 WHERE id = $2',
        [pointsToAdd, userId]
      );
    });

    return result.rowsAffected > 0;
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
      return await client.query(`
        SELECT
          id,
          email,
          name,
          COALESCE("totalMinutePoints", 0) as totalminutepoints
        FROM Users
        ORDER BY "totalMinutePoints" DESC NULLS LAST, "createdAt" ASC
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
  async getPublicUsersWithTotalPoints(): Promise<Array<{ userId: string; email: string; name: string; totalMinutePoints: number; currentStreak: number; isPublic: boolean }>> {
    const result = await this.dbManager.executeQuery<{
      id: string;
      email: string;
      name: string;
      totalminutepoints: number;
      currentstreak: number;
      ispublic: boolean;
    }>(async (client) => {
      return await client.query(`
        SELECT
          id,
          email,
          name,
          COALESCE("totalMinutePoints", 0) as totalminutepoints,
          COALESCE("currentStreak", 0) as currentstreak,
          "isPublic" as ispublic
        FROM Users
        ORDER BY "totalMinutePoints" DESC NULLS LAST, "createdAt" ASC
      `);
    });

    return result.recordset.map(row => ({
      userId: row.id,
      email: row.email,
      name: row.name,
      totalMinutePoints: row.totalminutepoints || 0,
      currentStreak: row.currentstreak || 0,
      isPublic: row.ispublic === true
    }));
  }

  /**
   * Get streak info for a user.
   */
  async getUserStreakInfo(userId: string): Promise<{ currentStreak: number; lastStreakDate: string | null }> {
    if (!userId) {
      throw new ValidationError('User ID is required');
    }

    const result = await this.dbManager.executeQuery<{ currentstreak: number; laststreakdate: string | null }>(async (client) => {
      return await client.query(
        `SELECT
           "currentStreak" as currentstreak,
           to_char("lastStreakDate", 'YYYY-MM-DD') as laststreakdate
         FROM Users WHERE id = $1`,
        [userId]
      );
    });

    if (result.recordset.length === 0) {
      throw new NotFoundError(`User with ID ${userId} not found`);
    }

    return {
      currentStreak: result.recordset[0].currentstreak || 0,
      lastStreakDate: result.recordset[0].laststreakdate || null
    };
  }

  /**
   * Set the user's currentStreak to a specific value and stamp lastStreakDate.
   * Used by the increment-on-threshold-cross path.
   */
  async setStreak(userId: string, currentStreak: number, lastStreakDate: string): Promise<boolean> {
    if (!userId) {
      throw new ValidationError('User ID is required');
    }
    if (currentStreak < 0) {
      throw new ValidationError('Streak cannot be negative');
    }

    const result = await this.dbManager.executeQuery(async (client) => {
      return await client.query(
        'UPDATE Users SET "currentStreak" = $1, "lastStreakDate" = $2 WHERE id = $3',
        [currentStreak, lastStreakDate, userId]
      );
    });

    return result.rowsAffected > 0;
  }

  /**
   * Reset currentStreak to 0, deduct penaltyPoints from totalMinutePoints (floor 0),
   * and stamp lastStreakDate to mark the penalty as applied for this break.
   */
  async applyStreakPenalty(userId: string, penaltyPoints: number, lastStreakDate: string): Promise<boolean> {
    if (!userId) {
      throw new ValidationError('User ID is required');
    }

    const result = await this.dbManager.executeQuery(async (client) => {
      return await client.query(
        `UPDATE Users
            SET "currentStreak"     = 0,
                "totalMinutePoints" = GREATEST(0, "totalMinutePoints" - $1),
                "lastStreakDate"    = $2
          WHERE id = $3`,
        [penaltyPoints, lastStreakDate, userId]
      );
    });

    return result.rowsAffected > 0;
  }
}
