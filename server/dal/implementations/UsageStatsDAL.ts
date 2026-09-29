import { IUsageStatsDAL } from '../interfaces/IUsageStatsDAL.js';
import { dbManager as defaultDbManager, DatabaseManager } from '../base/DatabaseManager.js';
import { VET_PHYSICAL_TABLES, vetSortedClause } from '../shared/vetTable.js';
import type {
  UsageDay,
  UsageFeatureRow,
  UsageGameRow,
  UsageHeadline,
  UsageLanguageRow,
} from '../../contracts/usage.js';

/**
 * UsageStatsDAL — the SQL behind the User Usage dashboard (docs/USAGE_DASHBOARD.md).
 *
 * LAYER: DAL. Pure reads; no gate (UsageDashboardService checks `users.isAdmin`).
 *
 * ── Where each signal comes from ─────────────────────────────────────────────
 *   studied / minutes   userminutepoints   bucketed by "streakDate" (the learner's
 *                                          04:00-local day, the streak's own day)
 *   app opens           refresh_tokens     one row is minted per login AND per ~15-min
 *                                          rotation, so "any row that day" = the user
 *                                          had a live session that day
 *   sign-ins            refresh_tokens     a row no other row's "replacedByHash" points
 *                                          at — i.e. the head of a rotation chain
 *   signups             users."createdAt"
 *   cards added         vocabentries_zh/_es sorted ('library') rows only — lent
 *                                          provisional rows are not something a
 *                                          learner chose (docs/PROVISIONAL_CARDS.md)
 *   game wins           wins
 *   writing practice    writing_practice_completions
 *   immersive world     iw_scene_runs (by "startedAt")
 *   AI dictionary       dictionary_ai_usage (SUM(count) — one row per user per day)
 *
 * The database runs in UTC, so `ts::date` on a timestamptz is already the UTC day.
 * refresh_tokens is never purged (RefreshTokenDAL only revokes), so sign-in history
 * is complete back to the table's creation.
 *
 * Depended on by: server/services/UsageDashboardService.ts, docs/USAGE_DASHBOARD.md.
 */
export class UsageStatsDAL implements IUsageStatsDAL {
  constructor(protected readonly dbManager: DatabaseManager = defaultDbManager) {}

  /** Run one statement and return its rows. Each call borrows and releases its own client. */
  private async rows<T>(sql: string, params: unknown[] = []): Promise<T[]> {
    const result = await this.dbManager.executeQuery<T>(async (client) => client.query(sql, params));
    return result.recordset;
  }

  async getFirstSignupDate(): Promise<string | null> {
    const [row] = await this.rows<{ first: string | null }>(
      `SELECT to_char(MIN("createdAt")::date, 'YYYY-MM-DD') AS first FROM users`
    );
    return row?.first ?? null;
  }

  async getHeadline(today: string): Promise<UsageHeadline> {
    // One scan of the last 30 streak days feeds all three rolling counts.
    const [row] = await this.rows<UsageHeadline>(
      `SELECT
         (SELECT COUNT(*) FROM users)::int                                               AS "totalUsers",
         COUNT(DISTINCT "userId") FILTER (WHERE "streakDate" = $1::date)::int             AS dau,
         COUNT(DISTINCT "userId") FILTER (WHERE "streakDate" >= $1::date - 6)::int        AS wau,
         COUNT(DISTINCT "userId")::int                                                    AS mau
       FROM userminutepoints
       WHERE "minutesEarned" > 0
         AND "streakDate" BETWEEN $1::date - 29 AND $1::date`,
      [today]
    );
    return row ?? { totalUsers: 0, dau: 0, wau: 0, mau: 0 };
  }

  async getDailySeries(since: string, until: string): Promise<UsageDay[]> {
    // generate_series is the spine so empty days come back as zero rows rather than
    // gaps — the client draws one bar per day and must not infer missing days.
    return this.rows<UsageDay>(
      `WITH spine AS (
         SELECT gs::date AS day FROM generate_series($1::date, $2::date, interval '1 day') AS gs
       ),
       studied AS (
         SELECT "streakDate" AS day,
                COUNT(DISTINCT "userId") FILTER (WHERE "minutesEarned" > 0) AS active,
                COALESCE(SUM("minutesEarned"), 0)                          AS minutes
         FROM userminutepoints
         WHERE "streakDate" BETWEEN $1::date AND $2::date
         GROUP BY 1
       ),
       sessions AS (
         -- LEFT JOIN to the row this token replaced: no predecessor = a fresh sign-in.
         SELECT r."createdAt"::date AS day,
                COUNT(DISTINCT r."userId")               AS opens,
                COUNT(*) FILTER (WHERE prev.id IS NULL)  AS sign_ins
         FROM refresh_tokens r
         LEFT JOIN refresh_tokens prev ON prev."replacedByHash" = r."tokenHash"
         WHERE r."createdAt" >= $1::date AND r."createdAt" < $2::date + 1
         GROUP BY 1
       ),
       signups AS (
         SELECT "createdAt"::date AS day, COUNT(*) AS n
         FROM users
         WHERE "createdAt" >= $1::date AND "createdAt" < $2::date + 1
         GROUP BY 1
       )
       SELECT to_char(spine.day, 'YYYY-MM-DD')     AS date,
              COALESCE(studied.active, 0)::int     AS "activeUsers",
              COALESCE(studied.minutes, 0)::int    AS minutes,
              COALESCE(sessions.opens, 0)::int     AS "appOpenUsers",
              COALESCE(signups.n, 0)::int          AS signups,
              COALESCE(sessions.sign_ins, 0)::int  AS "signIns"
       FROM spine
       LEFT JOIN studied  ON studied.day  = spine.day
       LEFT JOIN sessions ON sessions.day = spine.day
       LEFT JOIN signups  ON signups.day  = spine.day
       ORDER BY spine.day`,
      [since, until]
    );
  }

  async getWindowDistinctUsers(since: string, until: string): Promise<{ activeUsers: number; appOpenUsers: number }> {
    const [row] = await this.rows<{ activeUsers: number; appOpenUsers: number }>(
      `SELECT
         (SELECT COUNT(DISTINCT "userId") FROM userminutepoints
           WHERE "minutesEarned" > 0 AND "streakDate" BETWEEN $1::date AND $2::date)::int AS "activeUsers",
         (SELECT COUNT(DISTINCT "userId") FROM refresh_tokens
           WHERE "createdAt" >= $1::date AND "createdAt" < $2::date + 1)::int            AS "appOpenUsers"`,
      [since, until]
    );
    return row ?? { activeUsers: 0, appOpenUsers: 0 };
  }

  async getLanguageBreakdown(since: string, until: string): Promise<UsageLanguageRow[]> {
    return this.rows<UsageLanguageRow>(
      `SELECT language,
              COUNT(DISTINCT "userId")::int        AS "activeUsers",
              COALESCE(SUM("minutesEarned"), 0)::int AS minutes
       FROM userminutepoints
       WHERE "minutesEarned" > 0 AND "streakDate" BETWEEN $1::date AND $2::date
       GROUP BY language
       ORDER BY minutes DESC`,
      [since, until]
    );
  }

  async getFeatureCounts(
    since: string,
    until: string
  ): Promise<Array<Pick<UsageFeatureRow, 'key' | 'events' | 'users'>>> {
    // The two vet tables are UNIONed rather than read through a view — there is
    // deliberately no union view over vet (see the per-language vet split).
    const cardsUnion = VET_PHYSICAL_TABLES.map(
      (t) => `SELECT ve."userId" FROM ${t} ve
              WHERE ${vetSortedClause('ve')} AND ve."createdAt" >= $1::date AND ve."createdAt" < $2::date + 1`
    ).join(' UNION ALL ');

    // One row per feature, each an (events, users) pair over the window.
    return this.rows<Pick<UsageFeatureRow, 'key' | 'events' | 'users'>>(
      `SELECT 'cardsAdded' AS key, COUNT(*)::int AS events, COUNT(DISTINCT "userId")::int AS users
         FROM (${cardsUnion}) cards
       UNION ALL
       SELECT 'gameWins', COUNT(*)::int, COUNT(DISTINCT "userId")::int
         FROM wins WHERE "wonAt" >= $1::date AND "wonAt" < $2::date + 1
       UNION ALL
       SELECT 'writingPractice', COUNT(*)::int, COUNT(DISTINCT "userId")::int
         FROM writing_practice_completions WHERE "completedAt" >= $1::date AND "completedAt" < $2::date + 1
       UNION ALL
       SELECT 'immersiveWorld', COUNT(*)::int, COUNT(DISTINCT "userId")::int
         FROM iw_scene_runs WHERE "startedAt" >= $1::date AND "startedAt" < $2::date + 1
       UNION ALL
       SELECT 'aiDictionary', COALESCE(SUM(count), 0)::int, COUNT(DISTINCT "userId")::int
         FROM dictionary_ai_usage WHERE "usageDate" BETWEEN $1::date AND $2::date`,
      [since, until]
    );
  }

  async getGameWins(since: string, until: string): Promise<UsageGameRow[]> {
    return this.rows<UsageGameRow>(
      `SELECT game, COUNT(*)::int AS wins, COUNT(DISTINCT "userId")::int AS users
       FROM wins
       WHERE "wonAt" >= $1::date AND "wonAt" < $2::date + 1
       GROUP BY game
       ORDER BY wins DESC, game`,
      [since, until]
    );
  }
}
