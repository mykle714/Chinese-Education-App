import { IUserMinutePointsDAL } from '../interfaces/IUserMinutePointsDAL.js';
import { dbManager as defaultDbManager, DatabaseManager } from '../base/DatabaseManager.js';
import { UserMinutePoints } from '../../types/minutePoints.js';
import { ValidationError } from '../../types/dal.js';

/**
 * UserMinutePoints Data Access Layer.
 * One row per (userId, streakDate, language); aggregates minutes across all of
 * a user's devices. `language` attributes each earned minute to the language
 * the user was studying. Since migration 134 the streak and the RETENTION_MINUTES
 * threshold are PER LANGUAGE, so the threshold check reads this table's single
 * (user, day, language) row rather than summing across languages.
 */
export class UserMinutePointsDAL implements IUserMinutePointsDAL {

  /**
   * The connection manager, injected so the DAL can be substituted in a test.
   * Defaults to the process-wide singleton, so `new UserMinutePointsDAL()` at the composition
   * root (dal/setup.ts) keeps working unchanged.
   * See docs/CORRECTNESS_AND_PERFORMANCE_REVIEW.md finding 2.
   */
  constructor(protected readonly dbManager: DatabaseManager = defaultDbManager) {}

  async findByUserAndStreakDate(userId: string, streakDate: string, language: string): Promise<UserMinutePoints | null> {
    if (!userId) throw new ValidationError('User ID is required');
    if (!streakDate) throw new ValidationError('Streak date is required');
    if (!language) throw new ValidationError('Language is required');

    const result = await this.dbManager.executeQuery<UserMinutePoints>(async (client) => {
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
    const result = await this.dbManager.executeQuery<{ previousminutes: number; newminutes: number }>(async (client) => {
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
    await this.dbManager.executeQuery(async (client) => {
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

    const result = await this.dbManager.executeQuery<UserMinutePoints>(async (client) => {
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

    const result = await this.dbManager.executeQuery<{ minutes: number }>(async (client) => {
      return await client.query(`
        SELECT COALESCE(SUM("minutesEarned"), 0) AS minutes
        FROM userminutepoints
        WHERE "userId" = $1 AND "streakDate" = $2
      `, [userId, streakDate]);
    });

    return Number(result.recordset[0]?.minutes ?? 0);
  }

  /**
   * Day totals for MANY users across MANY dates, in one grouped scan.
   *
   * The batch form of getMinutesForDate. The leaderboard needs today's and
   * yesterday's totals for every ranked user; calling the single-row method in a
   * loop made that 2N sequential round trips (see
   * docs/CORRECTNESS_AND_PERFORMANCE_REVIEW.md finding 1). This answers all of it
   * with one query.
   *
   * Returns a nested map keyed userId → streakDate → minutes. A (user, date) pair
   * with no rows is ABSENT from the map rather than present-as-zero, so callers
   * must supply their own default — `?? 0`, matching what the single-row method
   * returns for the same case.
   */
  async getMinutesForDatesByUser(
    userIds: string[],
    streakDates: string[]
  ): Promise<Map<string, Map<string, number>>> {
    const byUser = new Map<string, Map<string, number>>();
    // ANY($1) on an empty array is valid SQL but always matches nothing; skip the
    // round trip entirely so a leaderboard with no ranked users costs zero queries.
    if (userIds.length === 0 || streakDates.length === 0) return byUser;

    const result = await this.dbManager.executeQuery<{
      userId: string;
      // DATE column — pg hands this back as a Date, not the string that was passed in.
      streakDate: string | Date;
      minutes: string;
    }>(async (client) => {
      return await client.query(`
        SELECT "userId", "streakDate", COALESCE(SUM("minutesEarned"), 0) AS minutes
        FROM userminutepoints
        WHERE "userId" = ANY($1) AND "streakDate" = ANY($2)
        GROUP BY "userId", "streakDate"
      `, [userIds, streakDates]);
    });

    for (const row of result.recordset) {
      // `streakDate` is a DATE column, so pg hands it back as a Date object rather
      // than the 'YYYY-MM-DD' string the caller passed in. Normalize to the string
      // form so lookups by the original key hit.
      //
      // Formatted, not `toISOString()`: pg builds that Date at LOCAL midnight, so
      // re-reading it in UTC lands on the previous day for any server at a positive
      // UTC offset — the key would then never match what the caller asked for.
      // 'en-CA' yields YYYY-MM-DD in local time, which is the key format.
      const dateKey = row.streakDate instanceof Date
        ? new Intl.DateTimeFormat('en-CA').format(row.streakDate)
        : String(row.streakDate);
      let forUser = byUser.get(row.userId);
      if (!forUser) {
        forUser = new Map<string, number>();
        byUser.set(row.userId, forUser);
      }
      forUser.set(dateKey, Number(row.minutes));
    }
    return byUser;
  }

  /**
   * Day total for a single language. Drives the per-language fire badge so a
   * user switching languages sees that language's minutes-earned-today.
   */
  async getMinutesForDateAndLanguage(userId: string, streakDate: string, language: string): Promise<number> {
    if (!userId) throw new ValidationError('User ID is required');
    if (!streakDate) throw new ValidationError('Streak date is required');
    if (!language) throw new ValidationError('Language is required');

    const result = await this.dbManager.executeQuery<{ minutes: number }>(async (client) => {
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

    const result = await this.dbManager.executeQuery<{ minutes: number }>(async (client) => {
      return await client.query(`
        SELECT COALESCE(SUM("minutesEarned"), 0) AS minutes
        FROM userminutepoints
        WHERE "userId" = $1 AND "language" = $2
      `, [userId, language]);
    });

    return Number(result.recordset[0]?.minutes ?? 0);
  }

  // NOTE: the GLOBAL lifetime-earned figure used to be computed here as
  // `SELECT SUM("minutesEarned") ... WHERE "userId" = $1`. It was the only read of
  // this table not bounded to a single day or month, so its cost grew linearly with
  // account age. It is now the maintained per-language counter
  // user_language_minute_totals."lifetimeMinutesEarned" (migrations 133 then 134);
  // read it via IUserLanguageTotalsDAL.

  async getFirstActivityDate(userId: string, language: string): Promise<string | null> {
    if (!userId) throw new ValidationError('User ID is required');
    if (!language) throw new ValidationError('Language is required');

    const result = await this.dbManager.executeQuery<{ first: string | null }>(async (client) => {
      return await client.query(`
        SELECT to_char(MIN("streakDate"), 'YYYY-MM-DD') AS first
        FROM userminutepoints
        WHERE "userId" = $1 AND "language" = $2
      `, [userId, language]);
    });

    return result.recordset[0]?.first ?? null;
  }

}
