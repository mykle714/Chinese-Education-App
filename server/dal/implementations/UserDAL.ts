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

    const result = await this.dbManager.executeQuery<User>(async (client) => {
      return await client.query('SELECT id, email, name, "selectedLanguage", "createdAt" FROM Users WHERE email = $1', [email]);
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

    const result = await this.dbManager.executeQuery<User>(async (client) => {
      return await client.query('SELECT * FROM Users WHERE email = $1', [email]);
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
      return await client.query('SELECT id, email, name, "selectedLanguage", "createdAt" FROM Users WHERE id = $1', [id]);
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
   * Override update to handle user-specific validation
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
   * Override buildInsertQuery to exclude sensitive fields from logging
   */
  protected buildInsertQuery(data: UserCreateData): {
    columns: string;
    placeholders: string;
    values: any[];
  } {
    const result = super.buildInsertQuery(data);
    
    // Log creation without password for security
    console.log(`Creating user: ${data.email}`);
    
    return result;
  }

  /**
   * Get total work points for a user
   */
  async getTotalWorkPoints(userId: string): Promise<number> {
    if (!userId) {
      throw new ValidationError('User ID is required');
    }

    const result = await this.dbManager.executeQuery<{ totalworkpoints: number }>(async (client) => {
      return await client.query('SELECT "totalWorkPoints" as totalworkpoints FROM Users WHERE id = $1', [userId]);
    });

    if (result.recordset.length === 0) {
      throw new NotFoundError(`User with ID ${userId} not found`);
    }

    return result.recordset[0].totalworkpoints || 0;
  }

  /**
   * Update total work points for a user
   */
  async updateTotalWorkPoints(userId: string, totalPoints: number): Promise<boolean> {
    if (!userId) {
      throw new ValidationError('User ID is required');
    }
    if (totalPoints < 0) {
      throw new ValidationError('Total points cannot be negative');
    }

    const result = await this.dbManager.executeQuery(async (client) => {
      return await client.query('UPDATE Users SET "totalWorkPoints" = $1 WHERE id = $2', [totalPoints, userId]);
    });

    return result.rowsAffected > 0;
  }

  /**
   * Increment total work points for a user
   */
  async incrementTotalWorkPoints(userId: string, pointsToAdd: number): Promise<boolean> {
    if (!userId) {
      throw new ValidationError('User ID is required');
    }
    if (pointsToAdd < 0) {
      throw new ValidationError('Points to add cannot be negative');
    }

    const result = await this.dbManager.executeQuery(async (client) => {
      return await client.query(
        'UPDATE Users SET "totalWorkPoints" = "totalWorkPoints" + $1 WHERE id = $2',
        [pointsToAdd, userId]
      );
    });

    return result.rowsAffected > 0;
  }

  /**
   * Get all users with their total work points for leaderboard
   */
  async getAllUsersWithTotalPoints(): Promise<Array<{ userId: string; email: string; name: string; totalWorkPoints: number }>> {
    const result = await this.dbManager.executeQuery<{
      id: string;
      email: string;
      name: string;
      totalworkpoints: number;
    }>(async (client) => {
      return await client.query(`
        SELECT 
          id,
          email,
          name,
          COALESCE("totalWorkPoints", 0) as totalworkpoints
        FROM Users
        ORDER BY "totalWorkPoints" DESC NULLS LAST, "createdAt" ASC
      `);
    });

    return result.recordset.map(row => ({
      userId: row.id,
      email: row.email,
      name: row.name,
      totalWorkPoints: row.totalworkpoints || 0
    }));
  }

  /**
   * Get only public users with their total work points for leaderboard
   */
  async getPublicUsersWithTotalPoints(): Promise<Array<{ userId: string; email: string; name: string; totalWorkPoints: number }>> {
    const result = await this.dbManager.executeQuery<{
      id: string;
      email: string;
      name: string;
      totalworkpoints: number;
    }>(async (client) => {
      return await client.query(`
        SELECT 
          id,
          email,
          name,
          COALESCE("totalWorkPoints", 0) as totalworkpoints
        FROM Users
        WHERE "isPublic" = true
        ORDER BY "totalWorkPoints" DESC NULLS LAST, "createdAt" ASC
      `);
    });

    return result.recordset.map(row => ({
      userId: row.id,
      email: row.email,
      name: row.name,
      totalWorkPoints: row.totalworkpoints || 0
    }));
  }
}
