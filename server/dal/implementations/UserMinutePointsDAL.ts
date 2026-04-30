import { IUserMinutePointsDAL } from '../interfaces/IUserMinutePointsDAL.js';
import { dbManager } from '../base/DatabaseManager.js';
import { UserMinutePoints } from '../../types/minutePoints.js';
import { ValidationError, ITransaction } from '../../types/dal.js';

/**
 * UserMinutePoints Data Access Layer.
 * One row per (userId, streakDate); aggregates minutes across all of a user's devices.
 */
export class UserMinutePointsDAL implements IUserMinutePointsDAL {
  async findByUserAndStreakDate(userId: string, streakDate: string): Promise<UserMinutePoints | null> {
    if (!userId) throw new ValidationError('User ID is required');
    if (!streakDate) throw new ValidationError('Streak date is required');

    const result = await dbManager.executeQuery<UserMinutePoints>(async (client) => {
      return await client.query(`
        SELECT * FROM userminutepoints
        WHERE "userId" = $1 AND "streakDate" = $2
      `, [userId, streakDate]);
    });

    return result.recordset[0] || null;
  }

  async addMinutesForDate(
    userId: string,
    streakDate: string,
    delta: number
  ): Promise<{ previousMinutes: number; newMinutes: number }> {
    if (!userId) throw new ValidationError('User ID is required');
    if (!streakDate) throw new ValidationError('Streak date is required');
    if (delta < 0) throw new ValidationError('Delta cannot be negative');

    // Upsert and return the row's prior + new minutesEarned in one round-trip.
    // The xmax = 0 trick distinguishes INSERT from UPDATE so we can compute "previous".
    const result = await dbManager.executeQuery<{ previousminutes: number; newminutes: number }>(async (client) => {
      return await client.query(`
        WITH upsert AS (
          INSERT INTO userminutepoints ("userId", "streakDate", "minutesEarned")
          VALUES ($1, $2, $3)
          ON CONFLICT ("userId", "streakDate")
          DO UPDATE SET
            "minutesEarned"     = userminutepoints."minutesEarned" + EXCLUDED."minutesEarned",
            "lastSyncTimestamp" = NOW(),
            "updatedAt"         = NOW()
          RETURNING
            "minutesEarned"      AS newminutes,
            (xmax = 0)           AS inserted
        )
        SELECT
          CASE WHEN inserted THEN 0 ELSE newminutes - $3 END AS previousminutes,
          newminutes
        FROM upsert
      `, [userId, streakDate, delta]);
    });

    return {
      previousMinutes: result.recordset[0]?.previousminutes ?? 0,
      newMinutes: result.recordset[0]?.newminutes ?? 0,
    };
  }

  async addPenaltyMinutesForDate(userId: string, streakDate: string, penaltyMinutes: number): Promise<void> {
    if (!userId) throw new ValidationError('User ID is required');
    if (!streakDate) throw new ValidationError('Streak date is required');
    if (penaltyMinutes < 0) throw new ValidationError('Penalty cannot be negative');

    await dbManager.executeQuery(async (client) => {
      return await client.query(`
        INSERT INTO userminutepoints ("userId", "streakDate", "minutesEarned", "penaltyMinutes")
        VALUES ($1, $2, 0, $3)
        ON CONFLICT ("userId", "streakDate")
        DO UPDATE SET
          "penaltyMinutes" = userminutepoints."penaltyMinutes" + EXCLUDED."penaltyMinutes",
          "updatedAt"      = NOW()
      `, [userId, streakDate, penaltyMinutes]);
    });
  }

  async findInRange(userId: string, startDate: string, endDate: string): Promise<UserMinutePoints[]> {
    if (!userId) throw new ValidationError('User ID is required');
    if (!startDate || !endDate) throw new ValidationError('Date range is required');

    const result = await dbManager.executeQuery<UserMinutePoints>(async (client) => {
      return await client.query(`
        SELECT * FROM userminutepoints
        WHERE "userId" = $1 AND "streakDate" BETWEEN $2 AND $3
        ORDER BY "streakDate" ASC
      `, [userId, startDate, endDate]);
    });

    return result.recordset;
  }

  async getMinutesForDate(userId: string, streakDate: string): Promise<number> {
    if (!userId) throw new ValidationError('User ID is required');
    if (!streakDate) throw new ValidationError('Streak date is required');

    const result = await dbManager.executeQuery<{ minutes: number }>(async (client) => {
      return await client.query(`
        SELECT COALESCE("minutesEarned", 0) AS minutes
        FROM userminutepoints
        WHERE "userId" = $1 AND "streakDate" = $2
      `, [userId, streakDate]);
    });

    return result.recordset[0]?.minutes ?? 0;
  }

  async getFirstActivityDate(userId: string): Promise<string | null> {
    if (!userId) throw new ValidationError('User ID is required');

    const result = await dbManager.executeQuery<{ first: string | null }>(async (client) => {
      return await client.query(`
        SELECT to_char(MIN("streakDate"), 'YYYY-MM-DD') AS first
        FROM userminutepoints
        WHERE "userId" = $1
      `, [userId]);
    });

    return result.recordset[0]?.first ?? null;
  }

  async addMinutesForDateWithTransaction(
    userId: string,
    streakDate: string,
    delta: number,
    transaction: ITransaction
  ): Promise<{ previousMinutes: number; newMinutes: number }> {
    if (!userId) throw new ValidationError('User ID is required');
    if (!streakDate) throw new ValidationError('Streak date is required');
    if (delta < 0) throw new ValidationError('Delta cannot be negative');

    const client = transaction.getClient();
    const result = await client.query(`
      WITH upsert AS (
        INSERT INTO userminutepoints ("userId", "streakDate", "minutesEarned")
        VALUES ($1, $2, $3)
        ON CONFLICT ("userId", "streakDate")
        DO UPDATE SET
          "minutesEarned"     = userminutepoints."minutesEarned" + EXCLUDED."minutesEarned",
          "lastSyncTimestamp" = NOW(),
          "updatedAt"         = NOW()
        RETURNING "minutesEarned" AS newminutes, (xmax = 0) AS inserted
      )
      SELECT
        CASE WHEN inserted THEN 0 ELSE newminutes - $3 END AS previousminutes,
        newminutes
      FROM upsert
    `, [userId, streakDate, delta]);

    return {
      previousMinutes: result.rows[0]?.previousminutes ?? 0,
      newMinutes: result.rows[0]?.newminutes ?? 0,
    };
  }
}
