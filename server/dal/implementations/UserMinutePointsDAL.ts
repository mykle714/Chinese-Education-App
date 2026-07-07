import { IUserMinutePointsDAL } from '../interfaces/IUserMinutePointsDAL.js';
import { dbManager } from '../base/DatabaseManager.js';
import { UserMinutePoints } from '../../types/minutePoints.js';
import { ValidationError, ITransaction } from '../../types/dal.js';

/**
 * UserMinutePoints Data Access Layer.
 * One row per (userId, streakDate, language); aggregates minutes across all of
 * a user's devices. `language` attributes each earned minute to the language
 * the user was studying; the streak itself stays global (any language keeps it
 * alive), so streak/threshold reads SUM across languages.
 */
export class UserMinutePointsDAL implements IUserMinutePointsDAL {
  async findByUserAndStreakDate(userId: string, streakDate: string, language: string): Promise<UserMinutePoints | null> {
    if (!userId) throw new ValidationError('User ID is required');
    if (!streakDate) throw new ValidationError('Streak date is required');
    if (!language) throw new ValidationError('Language is required');

    const result = await dbManager.executeQuery<UserMinutePoints>(async (client) => {
      return await client.query(`
        SELECT * FROM userminutepoints
        WHERE "userId" = $1 AND "streakDate" = $2 AND "language" = $3
      `, [userId, streakDate, language]);
    });

    return result.recordset[0] || null;
  }

  async addMinutesForDate(
    userId: string,
    streakDate: string,
    language: string,
    delta: number
  ): Promise<{ previousMinutes: number; newMinutes: number }> {
    if (!userId) throw new ValidationError('User ID is required');
    if (!streakDate) throw new ValidationError('Streak date is required');
    if (!language) throw new ValidationError('Language is required');
    if (delta < 0) throw new ValidationError('Delta cannot be negative');

    // Upsert and return the row's prior + new minutesEarned in one round-trip.
    // The xmax = 0 trick distinguishes INSERT from UPDATE so we can compute "previous".
    const result = await dbManager.executeQuery<{ previousminutes: number; newminutes: number }>(async (client) => {
      return await client.query(`
        WITH upsert AS (
          INSERT INTO userminutepoints ("userId", "streakDate", "language", "minutesEarned")
          VALUES ($1, $2, $3, $4)
          ON CONFLICT ("userId", "streakDate", "language")
          DO UPDATE SET
            "minutesEarned"     = userminutepoints."minutesEarned" + EXCLUDED."minutesEarned",
            "lastSyncTimestamp" = NOW(),
            "updatedAt"         = NOW()
          RETURNING
            "minutesEarned"      AS newminutes,
            (xmax = 0)           AS inserted
        )
        SELECT
          CASE WHEN inserted THEN 0 ELSE newminutes - $4 END AS previousminutes,
          newminutes
        FROM upsert
      `, [userId, streakDate, language, delta]);
    });

    return {
      previousMinutes: result.recordset[0]?.previousminutes ?? 0,
      newMinutes: result.recordset[0]?.newminutes ?? 0,
    };
  }

  async findInRange(userId: string, language: string, startDate: string, endDate: string): Promise<UserMinutePoints[]> {
    if (!userId) throw new ValidationError('User ID is required');
    if (!language) throw new ValidationError('Language is required');
    if (!startDate || !endDate) throw new ValidationError('Date range is required');

    const result = await dbManager.executeQuery<UserMinutePoints>(async (client) => {
      return await client.query(`
        SELECT * FROM userminutepoints
        WHERE "userId" = $1 AND "language" = $2 AND "streakDate" BETWEEN $3 AND $4
        ORDER BY "streakDate" ASC
      `, [userId, language, startDate, endDate]);
    });

    return result.recordset;
  }

  /**
   * Day total summed across ALL languages. Drives the global streak threshold
   * and the leaderboard's "active today" check.
   */
  async getMinutesForDate(userId: string, streakDate: string): Promise<number> {
    if (!userId) throw new ValidationError('User ID is required');
    if (!streakDate) throw new ValidationError('Streak date is required');

    const result = await dbManager.executeQuery<{ minutes: number }>(async (client) => {
      return await client.query(`
        SELECT COALESCE(SUM("minutesEarned"), 0) AS minutes
        FROM userminutepoints
        WHERE "userId" = $1 AND "streakDate" = $2
      `, [userId, streakDate]);
    });

    return Number(result.recordset[0]?.minutes ?? 0);
  }

  /**
   * Day total for a single language. Drives the per-language fire badge so a
   * user switching languages sees that language's minutes-earned-today.
   */
  async getMinutesForDateAndLanguage(userId: string, streakDate: string, language: string): Promise<number> {
    if (!userId) throw new ValidationError('User ID is required');
    if (!streakDate) throw new ValidationError('Streak date is required');
    if (!language) throw new ValidationError('Language is required');

    const result = await dbManager.executeQuery<{ minutes: number }>(async (client) => {
      return await client.query(`
        SELECT COALESCE("minutesEarned", 0) AS minutes
        FROM userminutepoints
        WHERE "userId" = $1 AND "streakDate" = $2 AND "language" = $3
      `, [userId, streakDate, language]);
    });

    return Number(result.recordset[0]?.minutes ?? 0);
  }

  /**
   * Lifetime minutes for a single language. Drives the home screen's
   * "total study time" for the user's selected language.
   */
  async getTotalMinutesForLanguage(userId: string, language: string): Promise<number> {
    if (!userId) throw new ValidationError('User ID is required');
    if (!language) throw new ValidationError('Language is required');

    const result = await dbManager.executeQuery<{ minutes: number }>(async (client) => {
      return await client.query(`
        SELECT COALESCE(SUM("minutesEarned"), 0) AS minutes
        FROM userminutepoints
        WHERE "userId" = $1 AND "language" = $2
      `, [userId, language]);
    });

    return Number(result.recordset[0]?.minutes ?? 0);
  }

  async getFirstActivityDate(userId: string, language: string): Promise<string | null> {
    if (!userId) throw new ValidationError('User ID is required');
    if (!language) throw new ValidationError('Language is required');

    const result = await dbManager.executeQuery<{ first: string | null }>(async (client) => {
      return await client.query(`
        SELECT to_char(MIN("streakDate"), 'YYYY-MM-DD') AS first
        FROM userminutepoints
        WHERE "userId" = $1 AND "language" = $2
      `, [userId, language]);
    });

    return result.recordset[0]?.first ?? null;
  }

  async addMinutesForDateWithTransaction(
    userId: string,
    streakDate: string,
    language: string,
    delta: number,
    transaction: ITransaction
  ): Promise<{ previousMinutes: number; newMinutes: number }> {
    if (!userId) throw new ValidationError('User ID is required');
    if (!streakDate) throw new ValidationError('Streak date is required');
    if (!language) throw new ValidationError('Language is required');
    if (delta < 0) throw new ValidationError('Delta cannot be negative');

    const client = transaction.getClient();
    const result = await client.query(`
      WITH upsert AS (
        INSERT INTO userminutepoints ("userId", "streakDate", "language", "minutesEarned")
        VALUES ($1, $2, $3, $4)
        ON CONFLICT ("userId", "streakDate", "language")
        DO UPDATE SET
          "minutesEarned"     = userminutepoints."minutesEarned" + EXCLUDED."minutesEarned",
          "lastSyncTimestamp" = NOW(),
          "updatedAt"         = NOW()
        RETURNING "minutesEarned" AS newminutes, (xmax = 0) AS inserted
      )
      SELECT
        CASE WHEN inserted THEN 0 ELSE newminutes - $4 END AS previousminutes,
        newminutes
      FROM upsert
    `, [userId, streakDate, language, delta]);

    return {
      previousMinutes: result.rows[0]?.previousminutes ?? 0,
      newMinutes: result.rows[0]?.newminutes ?? 0,
    };
  }
}
