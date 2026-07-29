import {
  IUserLanguagePointsDAL,
  LanguageProgress,
  UserPointsTotals,
} from '../interfaces/IUserLanguagePointsDAL.js';
import { dbManager } from '../base/DatabaseManager.js';
import { ValidationError } from '../../types/dal.js';

/**
 * UserLanguagePoints Data Access Layer.
 *
 * One row per (userId, language) in `user_language_points` (migration 130): that
 * language's NET wallet, its streak, and the two dates the penalty cron reads.
 * Replaces the four global columns that used to live on `users`.
 *
 * Rows are created LAZILY — the first earned minute in a language upserts one. A
 * missing row therefore means "never studied", which is exactly the cron's
 * exemption condition, so nothing needs to pre-create rows on signup or on a
 * language switch.
 *
 * Design: docs/PER_LANGUAGE_STREAKS.md
 */
export class UserLanguagePointsDAL implements IUserLanguagePointsDAL {
  async getProgress(userId: string, language: string): Promise<LanguageProgress> {
    if (!userId) throw new ValidationError('User ID is required');
    if (!language) throw new ValidationError('Language is required');

    const result = await dbManager.executeQuery<{
      totalminutepoints: number;
      currentstreak: number;
      laststreakdate: string | null;
    }>(async (client) => {
      return await client.query(
        `SELECT "totalMinutePoints" AS totalminutepoints,
                "currentStreak"     AS currentstreak,
                to_char("lastStreakDate", 'YYYY-MM-DD') AS laststreakdate
         FROM user_language_points
         WHERE "userId" = $1 AND language = $2`,
        [userId, language]
      );
    });

    const row = result.recordset[0];
    // A language with no row is semantically identical to one at zero, so return a
    // zeroed record rather than null and spare every caller an existence branch.
    return {
      language,
      totalMinutePoints: row?.totalminutepoints ?? 0,
      currentStreak: row?.currentstreak ?? 0,
      lastStreakDate: row?.laststreakdate ?? null,
    };
  }

  async getAllProgress(userId: string): Promise<LanguageProgress[]> {
    if (!userId) throw new ValidationError('User ID is required');

    const result = await dbManager.executeQuery<{
      language: string;
      totalminutepoints: number;
      currentstreak: number;
      laststreakdate: string | null;
    }>(async (client) => {
      return await client.query(
        `SELECT language,
                "totalMinutePoints" AS totalminutepoints,
                "currentStreak"     AS currentstreak,
                to_char("lastStreakDate", 'YYYY-MM-DD') AS laststreakdate
         FROM user_language_points
         WHERE "userId" = $1
         ORDER BY language ASC`,
        [userId]
      );
    });

    return result.recordset.map((row) => ({
      language: row.language,
      totalMinutePoints: row.totalminutepoints ?? 0,
      currentStreak: row.currentstreak ?? 0,
      lastStreakDate: row.laststreakdate ?? null,
    }));
  }

  async incrementPoints(userId: string, language: string, pointsToAdd: number): Promise<number> {
    if (!userId) throw new ValidationError('User ID is required');
    if (!language) throw new ValidationError('Language is required');
    if (pointsToAdd < 0) throw new ValidationError('Points to add cannot be negative');

    return this.upsertPoints(userId, language, pointsToAdd, /* floored */ false);
  }

  async adjustPoints(userId: string, language: string, delta: number): Promise<number> {
    if (!userId) throw new ValidationError('User ID is required');
    if (!language) throw new ValidationError('Language is required');
    if (!Number.isInteger(delta)) throw new ValidationError('delta must be an integer');

    return this.upsertPoints(userId, language, delta, /* floored */ true);
  }

  async setStreak(
    userId: string,
    language: string,
    currentStreak: number,
    lastStreakDate: string
  ): Promise<void> {
    if (!userId) throw new ValidationError('User ID is required');
    if (!language) throw new ValidationError('Language is required');
    if (currentStreak < 0) throw new ValidationError('Streak cannot be negative');
    if (!lastStreakDate) throw new ValidationError('Streak date is required');

    await dbManager.executeQuery(async (client) => {
      return await client.query(
        `INSERT INTO user_language_points ("userId", language, "currentStreak", "lastStreakDate")
         VALUES ($1, $2, $3, $4)
         ON CONFLICT ("userId", language)
         DO UPDATE SET "currentStreak"  = EXCLUDED."currentStreak",
                       "lastStreakDate" = EXCLUDED."lastStreakDate",
                       "updatedAt"      = now()`,
        [userId, language, currentStreak, lastStreakDate]
      );
    });
  }

  async getTotalsForAllUsers(): Promise<Map<string, UserPointsTotals>> {
    const result = await dbManager.executeQuery<{
      userid: string;
      totalminutepoints: number;
      beststreak: number;
    }>(async (client) => {
      return await client.query(
        `SELECT "userId"                        AS userid,
                COALESCE(SUM("totalMinutePoints"), 0) AS totalminutepoints,
                COALESCE(MAX("currentStreak"), 0)     AS beststreak
         FROM user_language_points
         GROUP BY "userId"`
      );
    });

    // Single grouped query — the leaderboard iterates every user, so a per-user
    // read here would be an N+1 against the whole user table.
    const totals = new Map<string, UserPointsTotals>();
    for (const row of result.recordset) {
      totals.set(row.userid, {
        userId: row.userid,
        totalMinutePoints: Number(row.totalminutepoints) || 0,
        bestStreak: Number(row.beststreak) || 0,
      });
    }
    return totals;
  }

  // ─────────────────────────────────────────────────────────────
  // internals
  // ─────────────────────────────────────────────────────────────

  /**
   * Shared upsert behind {@link incrementPoints} and {@link adjustPoints}: creates the
   * language's row on first touch, otherwise adds `delta` to the existing balance.
   *
   * `floored` selects the debit-safe form — GREATEST(0, …) so a debit larger than the
   * balance lands on 0 instead of going negative, mirroring the penalty cron. The
   * insert value is floored the same way so a first-touch debit (no row yet) cannot
   * seed a negative wallet.
   */
  private async upsertPoints(
    userId: string,
    language: string,
    delta: number,
    floored: boolean
  ): Promise<number> {
    const seed = floored ? Math.max(0, delta) : delta;
    const updateExpr = floored
      ? 'GREATEST(0, user_language_points."totalMinutePoints" + $3)'
      : 'user_language_points."totalMinutePoints" + $3';

    const result = await dbManager.executeQuery<{ totalminutepoints: number }>(async (client) => {
      return await client.query(
        `INSERT INTO user_language_points ("userId", language, "totalMinutePoints")
         VALUES ($1, $2, $4)
         ON CONFLICT ("userId", language)
         DO UPDATE SET "totalMinutePoints" = ${updateExpr},
                       "updatedAt"         = now()
         RETURNING "totalMinutePoints" AS totalminutepoints`,
        [userId, language, delta, seed]
      );
    });

    return result.recordset[0]?.totalminutepoints ?? 0;
  }
}
