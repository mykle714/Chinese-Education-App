import { PoolClient } from 'pg';
import { IUserWorkPointsDAL } from '../interfaces/IUserWorkPointsDAL.js';
import { dbManager } from '../base/DatabaseManager.js';
import {
  UserWorkPoints,
  UserWorkPointsCreateData
} from '../../types/workPoints.js';
import { ValidationError, NotFoundError, ITransaction } from '../../types/dal.js';

/**
 * UserWorkPoints Data Access Layer implementation
 * Handles all database operations for UserWorkPoints entities
 */
export class UserWorkPointsDAL implements IUserWorkPointsDAL {
  constructor() {
    // UserWorkPoints uses composite primary key, so we don't extend BaseDAL
  }

  /**
   * Find work points entries by user and date (all devices)
   */
  async findByUserAndDate(userId: string, date: string): Promise<UserWorkPoints[]> {
    if (!userId) {
      throw new ValidationError('User ID is required');
    }
    if (!date) {
      throw new ValidationError('Date is required');
    }

    const result = await dbManager.executeQuery<UserWorkPoints>(async (client) => {
      return await client.query(`
        SELECT * FROM userworkpoints 
        WHERE "userId" = $1 AND date = $2 
        ORDER BY "deviceFingerprint"
      `, [userId, date]);
    });

    return result.recordset;
  }

  /**
   * Find work points entry by user, date, and device
   */
  async findByUserAndDateAndDevice(userId: string, date: string, deviceFingerprint: string): Promise<UserWorkPoints | null> {
    if (!userId) {
      throw new ValidationError('User ID is required');
    }
    if (!date) {
      throw new ValidationError('Date is required');
    }
    if (!deviceFingerprint) {
      throw new ValidationError('Device fingerprint is required');
    }

    const result = await dbManager.executeQuery<UserWorkPoints>(async (client) => {
      return await client.query(`
        SELECT * FROM userworkpoints 
        WHERE "userId" = $1 AND date = $2 AND "deviceFingerprint" = $3
      `, [userId, date, deviceFingerprint]);
    });

    return result.recordset[0] || null;
  }

  /**
   * Upsert work points (insert or update existing entry)
   * This is the core sync operation
   */
  async upsertWorkPoints(userId: string, date: string, deviceFingerprint: string, workPoints: number): Promise<UserWorkPoints> {
    if (!userId) {
      throw new ValidationError('User ID is required');
    }
    if (!date) {
      throw new ValidationError('Date is required');
    }
    if (!deviceFingerprint) {
      throw new ValidationError('Device fingerprint is required');
    }
    if (workPoints < 0) {
      throw new ValidationError('Work points cannot be negative');
    }

    const result = await dbManager.executeQuery<UserWorkPoints>(async (client) => {
      return await client.query(`
        INSERT INTO userworkpoints ("userId", date, "deviceFingerprint", "workPoints")
        VALUES ($1, $2, $3, $4)
        ON CONFLICT ("userId", date, "deviceFingerprint")
        DO UPDATE SET 
          "workPoints" = $4,
          "lastSyncTimestamp" = CURRENT_TIMESTAMP,
          "updatedAt" = CURRENT_TIMESTAMP
        RETURNING *
      `, [userId, date, deviceFingerprint, workPoints]);
    });

    return result.recordset[0];
  }

  /**
   * Find work points by user ID with pagination
   */
  async findByUserId(userId: string, limit: number = 100, offset: number = 0): Promise<UserWorkPoints[]> {
    if (!userId) {
      throw new ValidationError('User ID is required');
    }

    const result = await dbManager.executeQuery<UserWorkPoints>(async (client) => {
      return await client.query(`
        SELECT * FROM userworkpoints 
        WHERE "userId" = $1 
        ORDER BY date DESC, "deviceFingerprint" ASC
        LIMIT $2 OFFSET $3
      `, [userId, limit, offset]);
    });

    return result.recordset;
  }

  /**
   * Find work points by user in date range
   */
  async findByUserIdInDateRange(userId: string, startDate: string, endDate: string): Promise<UserWorkPoints[]> {
    if (!userId) {
      throw new ValidationError('User ID is required');
    }
    if (!startDate || !endDate) {
      throw new ValidationError('Start date and end date are required');
    }

    const result = await dbManager.executeQuery<UserWorkPoints>(async (client) => {
      return await client.query(`
        SELECT * FROM userworkpoints 
        WHERE "userId" = $1 AND date >= $2 AND date <= $3
        ORDER BY date DESC, "deviceFingerprint" ASC
      `, [userId, startDate, endDate]);
    });

    return result.recordset;
  }

  /**
   * Upsert work points with transaction support
   */
  async upsertWorkPointsWithTransaction(
    userId: string,
    date: string,
    deviceFingerprint: string,
    workPoints: number,
    transaction: ITransaction
  ): Promise<UserWorkPoints> {
    if (!userId) {
      throw new ValidationError('User ID is required');
    }
    if (!date) {
      throw new ValidationError('Date is required');
    }
    if (!deviceFingerprint) {
      throw new ValidationError('Device fingerprint is required');
    }
    if (workPoints < 0) {
      throw new ValidationError('Work points cannot be negative');
    }

    const client = transaction.getClient();
    
    const result = await client.query(`
      INSERT INTO userworkpoints ("userId", date, "deviceFingerprint", "workPoints")
      VALUES ($1, $2, $3, $4)
      ON CONFLICT ("userId", date, "deviceFingerprint")
      DO UPDATE SET 
        "workPoints" = $4,
        "lastSyncTimestamp" = CURRENT_TIMESTAMP,
        "updatedAt" = CURRENT_TIMESTAMP
      RETURNING *
    `, [userId, date, deviceFingerprint, workPoints]);

    if (!result.rows || result.rows.length === 0) {
      throw new Error('Failed to upsert work points');
    }

    return result.rows[0] as UserWorkPoints;
  }

  /**
   * Get daily points for all users for a specific date
   */
  async getDailyPointsForAllUsers(date: string): Promise<Array<{ userId: string; totalPoints: number }>> {
    if (!date) {
      throw new ValidationError('Date is required');
    }

    const result = await dbManager.executeQuery<{ userId: string; totalPoints: number }>(async (client) => {
      return await client.query(`
        SELECT 
          "userId",
          SUM("workPoints") as "totalPoints"
        FROM userworkpoints 
        WHERE date = $1
        GROUP BY "userId"
        ORDER BY "totalPoints" DESC
      `, [date]);
    });

    return result.recordset;
  }

  /**
   * Get daily points for a specific user and date (sum across all devices)
   */
  async getDailyPointsForUser(userId: string, date: string): Promise<number> {
    if (!userId) {
      throw new ValidationError('User ID is required');
    }
    if (!date) {
      throw new ValidationError('Date is required');
    }

    const result = await dbManager.executeQuery<{ totalPoints: number }>(async (client) => {
      return await client.query(`
        SELECT 
          COALESCE(SUM("workPoints"), 0) as "totalPoints"
        FROM userworkpoints 
        WHERE "userId" = $1 AND date = $2
      `, [userId, date]);
    });

    return result.recordset[0]?.totalPoints || 0;
  }

  /**
   * Get streak data for a user (current streak and longest streak)
   */
  async getUserStreakData(userId: string): Promise<{ currentStreak: number; longestStreak: number }> {
    if (!userId) {
      throw new ValidationError('User ID is required');
    }

    // Get all daily totals for the user, ordered by date descending
    const result = await dbManager.executeQuery<{ date: string; totalPoints: number }>(async (client) => {
      return await client.query(`
        SELECT 
          date,
          SUM("workPoints") as "totalPoints"
        FROM userworkpoints 
        WHERE "userId" = $1
        GROUP BY date
        ORDER BY date DESC
      `, [userId]);
    });

    const dailyTotals = result.recordset;
    
    if (dailyTotals.length === 0) {
      return { currentStreak: 0, longestStreak: 0 };
    }

    // Calculate streaks based on STREAK_RETENTION_POINTS (5 points needed)
    const RETENTION_POINTS = 5; // This should match STREAK_CONFIG.RETENTION_POINTS
    
    let currentStreak = 0;
    let longestStreak = 0;
    let tempStreak = 0;
    
    // Convert dates to Date objects and sort
    const sortedDays = dailyTotals
      .map(day => ({
        date: new Date(day.date),
        totalPoints: day.totalPoints
      }))
      .sort((a, b) => b.date.getTime() - a.date.getTime()); // Descending order

    // Calculate current streak (from today backwards)
    const today = new Date();
    today.setHours(0, 0, 0, 0);
    
    let currentDate = new Date(today);
    let streakBroken = false;
    
    while (!streakBroken) {
      const currentDateStr = currentDate.toISOString().split('T')[0];
      const dayData = sortedDays.find(day => day.date.toISOString().split('T')[0] === currentDateStr);
      
      if (dayData && dayData.totalPoints >= RETENTION_POINTS) {
        currentStreak++;
        currentDate.setDate(currentDate.getDate() - 1);
      } else {
        streakBroken = true;
      }
      
      // Prevent infinite loop - don't go back more than a year
      if (currentStreak > 365) {
        break;
      }
    }

    // Calculate longest streak
    tempStreak = 0;
    longestStreak = 0;
    
    // Sort by date ascending for longest streak calculation
    const ascendingSortedDays = [...sortedDays].sort((a, b) => a.date.getTime() - b.date.getTime());
    
    for (let i = 0; i < ascendingSortedDays.length; i++) {
      const day = ascendingSortedDays[i];
      
      if (day.totalPoints >= RETENTION_POINTS) {
        tempStreak++;
        longestStreak = Math.max(longestStreak, tempStreak);
      } else {
        tempStreak = 0;
      }
    }

    return { currentStreak, longestStreak };
  }
}
