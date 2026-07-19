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

  async addPenaltyMinutesForDate(
    userId: string,
    streakDate: string,
    language: string,
    amount: number
  ): Promise<void> {
    if (!userId) throw new ValidationError('User ID is required');
    if (!streakDate) throw new ValidationError('Streak date is required');
    if (!language) throw new ValidationError('Language is required');
    if (amount < 0) throw new ValidationError('Penalty amount cannot be negative');

    // Upsert the day row, adding `amount` to penaltyMinutes (mirrors addMinutesForDate but for the
    // penalty column, leaving minutesEarned untouched so GROSS study time is preserved). This is
    // the same shape the hourly penalty cron writes; it is re-introduced here for the author
    // minute-adjust tool's −N "lose minutes" path.
    await dbManager.executeQuery(async (client) => {
      return await client.query(`
        INSERT INTO userminutepoints ("userId", "streakDate", "language", "penaltyMinutes")
        VALUES ($1, $2, $3, $4)
        ON CONFLICT ("userId", "streakDate", "language")
        DO UPDATE SET
          "penaltyMinutes"    = userminutepoints."penaltyMinutes" + EXCLUDED."penaltyMinutes",
          "updatedAt"         = NOW()
      `, [userId, streakDate, language, amount]);
    });
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

  /**
   * GLOBAL gross minutes earned across ALL languages — `Σ minutesEarned` for the user,
   * ignoring penalties. This is the "lifetime earned" figure that only ever grows; it
   * pairs with the penalty-debited users.totalMinutePoints (the net balance) — the two
   * DIVERGE exactly for users who have been penalized. Backed by the PK's leading
   * `userId` column (index range scan over just this user's rows), so it is cheap enough
   * to compute on read (it feeds an infrequently-shown display number, not a hot path).
   */
  async getGrossMinutesEarned(userId: string): Promise<number> {
    if (!userId) throw new ValidationError('User ID is required');

    const result = await dbManager.executeQuery<{ minutes: number }>(async (client) => {
      return await client.query(`
        SELECT COALESCE(SUM("minutesEarned"), 0) AS minutes
        FROM userminutepoints
        WHERE "userId" = $1
      `, [userId]);
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
