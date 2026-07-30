import { IUserLanguageTotalsDAL } from '../interfaces/IUserLanguageTotalsDAL.js';
import { dbManager as defaultDbManager, DatabaseManager } from '../base/DatabaseManager.js';
import { UserLanguageTotals } from '../../types/minutePoints.js';
import { ValidationError } from '../../types/dal.js';

/**
 * Per-(user, language) minute-points counters and streak state
 * (`user_language_minute_totals`, migration 134).
 *
 * One row per language the user has ever earned a minute in. Everything here is a
 * MAINTAINED COUNTER — nothing is aggregated out of the `userminutepoints` day
 * ledger, which is what keeps these reads O(1) regardless of account age. The ledger
 * remains the source for day- and month-scoped views (calendar, fire badge, the
 * threshold check); see docs/MINUTE_POINTS_SYSTEM.md.
 */
export class UserLanguageTotalsDAL implements IUserLanguageTotalsDAL {
  /**
   * Injected so the DAL can be substituted in a test; defaults to the process-wide
   * singleton so `new UserLanguageTotalsDAL()` at the composition root works unchanged.
   */
  constructor(protected readonly dbManager: DatabaseManager = defaultDbManager) {}

  /**
   * Shared projection. The two DATE columns are rendered with `to_char` rather than
   * selected raw: pg hands a DATE back as a Date built at LOCAL midnight, so reading
   * it in UTC lands on the previous day for any server at a positive UTC offset. The
   * rest of the system passes these dates around as 'YYYY-MM-DD' strings, so they are
   * formatted in SQL where the calendar day is unambiguous.
   */
  private static readonly SELECT_COLS = `
    "userId",
    language,
    "netMinutePoints"       AS "netMinutePoints",
    "lifetimeMinutesEarned" AS "lifetimeMinutesEarned",
    "currentStreak"         AS "currentStreak",
    to_char("lastStreakDate",  'YYYY-MM-DD') AS "lastStreakDate",
    to_char("lastPenaltyDate", 'YYYY-MM-DD') AS "lastPenaltyDate"
  `;

  async find(userId: string, language: string): Promise<UserLanguageTotals | null> {
    if (!userId) throw new ValidationError('User ID is required');
    if (!language) throw new ValidationError('Language is required');

    const result = await this.dbManager.executeQuery<UserLanguageTotals>(async (client) => {
      return await client.query(
        `SELECT ${UserLanguageTotalsDAL.SELECT_COLS}
         FROM user_language_minute_totals
         WHERE "userId" = $1 AND language = $2`,
        [userId, language],
      );
    });

    return result.recordset[0] ?? null;
  }

  async findAllForUser(userId: string): Promise<UserLanguageTotals[]> {
    if (!userId) throw new ValidationError('User ID is required');

    const result = await this.dbManager.executeQuery<UserLanguageTotals>(async (client) => {
      return await client.query(
        `SELECT ${UserLanguageTotalsDAL.SELECT_COLS}
         FROM user_language_minute_totals
         WHERE "userId" = $1
         ORDER BY language`,
        [userId],
      );
    });

    return result.recordset;
  }

  /**
   * EARN path. Upserts the language row and credits BOTH counters in one statement,
   * so there is no window in which net moved and gross did not.
   *
   * Negative input is rejected rather than clamped: a debit has different semantics
   * (it must floor at 0 and must NOT touch gross), and silently accepting one here
   * would raise gross on a penalty. Debits go through {@link adjustNetMinutes}.
   */
  async creditEarnedMinutes(userId: string, language: string, minutes: number): Promise<UserLanguageTotals> {
    if (!userId) throw new ValidationError('User ID is required');
    if (!language) throw new ValidationError('Language is required');
    if (!Number.isInteger(minutes)) throw new ValidationError('Minutes must be an integer');
    if (minutes < 0) throw new ValidationError('Minutes to credit cannot be negative');

    const result = await this.dbManager.executeQuery<UserLanguageTotals>(async (client) => {
      return await client.query(
        `INSERT INTO user_language_minute_totals
           ("userId", language, "netMinutePoints", "lifetimeMinutesEarned")
         VALUES ($1, $2, $3, $3)
         ON CONFLICT ("userId", language) DO UPDATE SET
           "netMinutePoints"       = user_language_minute_totals."netMinutePoints"       + EXCLUDED."netMinutePoints",
           "lifetimeMinutesEarned" = user_language_minute_totals."lifetimeMinutesEarned" + EXCLUDED."lifetimeMinutesEarned",
           "updatedAt"             = NOW()
         RETURNING ${UserLanguageTotalsDAL.SELECT_COLS}`,
        [userId, language, minutes],
      );
    });

    const row = result.recordset[0];
    if (!row) throw new ValidationError('Failed to credit minutes');
    return row;
  }

  /**
   * Penalty/debit path. Moves the NET counter only, floored at 0 — gross is monotonic
   * by definition and a penalty must never lower it.
   *
   * Inserts nothing: a user with no row for this language has never earned in it, so
   * there is no balance to debit and the UPDATE correctly affects 0 rows (returns 0).
   */
  async adjustNetMinutes(userId: string, language: string, delta: number): Promise<number> {
    if (!userId) throw new ValidationError('User ID is required');
    if (!language) throw new ValidationError('Language is required');
    if (!Number.isInteger(delta)) throw new ValidationError('Delta must be an integer');

    const result = await this.dbManager.executeQuery<{ net: number }>(async (client) => {
      return await client.query(
        `UPDATE user_language_minute_totals
         SET "netMinutePoints" = GREATEST(0, "netMinutePoints" + $3),
             "updatedAt"       = NOW()
         WHERE "userId" = $1 AND language = $2
         RETURNING "netMinutePoints" AS net`,
        [userId, language, delta],
      );
    });

    return result.recordset[0]?.net ?? 0;
  }

  /**
   * Advance (or reset) one language's streak. Upserts because the very first minute a
   * user earns in a language can itself cross the threshold, in which case the earn
   * path has just created the row — but a caller substituting a fresh DAL in a test
   * should not have to guarantee ordering.
   */
  async setStreak(userId: string, language: string, streak: number, streakDate: string): Promise<void> {
    if (!userId) throw new ValidationError('User ID is required');
    if (!language) throw new ValidationError('Language is required');
    if (!streakDate) throw new ValidationError('Streak date is required');
    if (!Number.isInteger(streak) || streak < 0) throw new ValidationError('Streak must be a non-negative integer');

    await this.dbManager.executeQuery(async (client) => {
      return await client.query(
        `INSERT INTO user_language_minute_totals ("userId", language, "currentStreak", "lastStreakDate")
         VALUES ($1, $2, $3, $4::date)
         ON CONFLICT ("userId", language) DO UPDATE SET
           "currentStreak"  = EXCLUDED."currentStreak",
           "lastStreakDate" = EXCLUDED."lastStreakDate",
           "updatedAt"      = NOW()`,
        [userId, language, streak, streakDate],
      );
    });
  }
}
