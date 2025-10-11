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
        SELECT * FROM UserWorkPoints 
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
        SELECT * FROM UserWorkPoints 
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
        INSERT INTO UserWorkPoints ("userId", date, "deviceFingerprint", "workPoints")
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
        SELECT * FROM UserWorkPoints 
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
        SELECT * FROM UserWorkPoints 
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
      INSERT INTO UserWorkPoints ("userId", date, "deviceFingerprint", "workPoints")
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
}
