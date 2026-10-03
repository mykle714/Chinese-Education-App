import { IUsageStatsDAL } from '../interfaces/IUsageStatsDAL.js';
import { dbManager as defaultDbManager, DatabaseManager } from '../base/DatabaseManager.js';
import { VET_PHYSICAL_TABLES, vetProvisionalClause, vetSortedClause } from '../shared/vetTable.js';
import type {
  UsageDay,
  UsageFeatureRow,
  UsageGameRow,
  UsageHeadline,
  UsageLanguageRow,
  UsageUserRow,
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
 *   recent learners     users ⋈ refresh_tokens ⋈ userminutepoints ⋈ vet ⋈
 *                       category_promotions ⋈ iw_scene_runs ⋈ wins, one row per learner
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

  async getRecentUsers(since: string, until: string, limit: number): Promise<UsageUserRow[]> {
    // Sorted = every bucket a learner can sort a card INTO (library or skip), i.e.
    // anything but a lent provisional row. Bucketed by "createdAt": a lent card later
    // promoted in place keeps its lend-time createdAt, so it counts on the lend day.
    const sortedUnion = VET_PHYSICAL_TABLES.map(
      (t) => `SELECT ve."userId" FROM ${t} ve
              WHERE NOT (${vetProvisionalClause('ve')})
                AND ve."createdAt" >= $1::date AND ve."createdAt" < $2::date + 1`
    ).join(' UNION ALL ');

    // Six per-user aggregates joined onto users. A learner qualifies with EITHER a
    // session or studied minutes in the window — the same two signals the window
    // totals count ("opened the app" / "studied"), so the list and the totals agree.
    // "createdAt" is timestamptz, so to_char under the session's UTC zone + a literal
    // "Z" is a correct ISO instant.
    return this.rows<UsageUserRow>(
      `WITH opens AS (
         -- Same predecessor LEFT JOIN as getDailySeries: no predecessor = a fresh sign-in.
         SELECT r."userId",
                MAX(r."createdAt")                      AS last_seen,
                COUNT(DISTINCT r."createdAt"::date)     AS days_opened,
                COUNT(*) FILTER (WHERE prev.id IS NULL) AS sign_ins
         FROM refresh_tokens r
         LEFT JOIN refresh_tokens prev ON prev."replacedByHash" = r."tokenHash"
         WHERE r."createdAt" >= $1::date AND r."createdAt" < $2::date + 1
         GROUP BY 1
       ),
       sorted AS (
         SELECT "userId", COUNT(*) AS cards FROM (${sortedUnion}) s GROUP BY 1
       ),
       climbed AS (
         -- Velocity (docs/VELOCITY.md): band-steps on the bars the account is pursuing.
         -- Core always counts; reading / writing only while that goal is on — the same
         -- read-time goal filter as CategoryPromotionDAL.getVelocityByLanguage.
         SELECT cp."userId", SUM(cp."bandsClimbed") AS steps
         FROM category_promotions cp
         JOIN users cu ON cu.id = cp."userId"
         WHERE cp."promotedAt" >= $1::date AND cp."promotedAt" < $2::date + 1
           AND (cp.bar = 'core'
                OR (cp.bar = 'reading' AND cu."readingGoal")
                OR (cp.bar = 'writing' AND cu."writingGoal"))
         GROUP BY 1
       ),
       studied AS (
         SELECT "userId",
                SUM("minutesEarned")                             AS minutes,
                COUNT(DISTINCT "streakDate")                     AS days_studied,
                array_agg(DISTINCT language::text ORDER BY language::text) AS languages
         FROM userminutepoints
         WHERE "minutesEarned" > 0 AND "streakDate" BETWEEN $1::date AND $2::date
         GROUP BY 1
       ),
       iw AS (
         -- Runs STARTED: the row is inserted when a run begins, so this is plays.
         SELECT "userId", COUNT(*) AS runs
         FROM iw_scene_runs
         WHERE "startedAt" >= $1::date AND "startedAt" < $2::date + 1
         GROUP BY 1
       ),
       won AS (
         -- One JSON array per learner: [{ game, wins }], most-won first. Wins, not
         -- plays — the wins table is the only per-round record a game writes.
         SELECT "userId",
                jsonb_agg(jsonb_build_object('game', game, 'wins', n) ORDER BY n DESC, game) AS games
         FROM (
           SELECT "userId", game, COUNT(*)::int AS n
           FROM wins
           WHERE "wonAt" >= $1::date AND "wonAt" < $2::date + 1
           GROUP BY 1, 2
         ) per_game
         GROUP BY 1
       )
       SELECT u.id                                   AS "userId",
              u.name                                 AS name,
              to_char(opens.last_seen AT TIME ZONE 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS"Z"') AS "lastSeenAt",
              COALESCE(studied.minutes, 0)::int      AS minutes,
              COALESCE(studied.days_studied, 0)::int AS "daysStudied",
              COALESCE(opens.days_opened, 0)::int    AS "daysOpened",
              COALESCE(studied.languages, '{}')      AS languages,
              COALESCE(opens.sign_ins, 0)::int       AS "signIns",
              COALESCE(sorted.cards, 0)::int         AS "cardsSorted",
              COALESCE(climbed.steps, 0)::int        AS velocity,
              COALESCE(iw.runs, 0)::int              AS "iwRuns",
              COALESCE(won.games, '[]'::jsonb)       AS "gameWins"
       FROM users u
       LEFT JOIN opens   ON opens."userId"   = u.id
       LEFT JOIN studied ON studied."userId" = u.id
       LEFT JOIN sorted  ON sorted."userId"  = u.id
       LEFT JOIN climbed ON climbed."userId" = u.id
       LEFT JOIN iw      ON iw."userId"      = u.id
       LEFT JOIN won     ON won."userId"     = u.id
       WHERE opens."userId" IS NOT NULL OR studied."userId" IS NOT NULL
       ORDER BY opens.last_seen DESC NULLS LAST, minutes DESC, u.name
       LIMIT $3`,
      [since, until, limit]
    );
  }
}
