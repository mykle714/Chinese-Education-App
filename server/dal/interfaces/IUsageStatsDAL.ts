import type {
  UsageDay,
  UsageGameRow,
  UsageHeadline,
  UsageLanguageRow,
  UsageFeatureRow,
} from '../../contracts/usage.js';

/**
 * Read-only, CROSS-USER aggregates behind the User Usage dashboard
 * (docs/USAGE_DASHBOARD.md).
 *
 * ⚠️ Unlike almost every other DAL, nothing here is scoped to a caller: each method
 * reads every account's rows. The DAL does not gate — the `users.isAdmin` check is
 * UsageDashboardService's job — so never wire these methods to a route that skips
 * that service.
 *
 * All `since` / `until` arguments are inclusive `YYYY-MM-DD` days.
 */
export interface IUsageStatsDAL {
  /** The day the first account was created — the start of the "all time" window. */
  getFirstSignupDate(): Promise<string | null>;

  /** Today-anchored DAU / WAU / MAU (by studied minutes) + total accounts. */
  getHeadline(today: string): Promise<UsageHeadline>;

  /** One row per day in [since, until], zero-filled. */
  getDailySeries(since: string, until: string): Promise<UsageDay[]>;

  /** DISTINCT-user counts over the whole window (these cannot be summed from days). */
  getWindowDistinctUsers(since: string, until: string): Promise<{ activeUsers: number; appOpenUsers: number }>;

  /** Minutes and active users per study language, most minutes first. */
  getLanguageBreakdown(since: string, until: string): Promise<UsageLanguageRow[]>;

  /** Events + distinct users per feature, labels excluded (the service owns copy). */
  getFeatureCounts(since: string, until: string): Promise<Array<Pick<UsageFeatureRow, 'key' | 'events' | 'users'>>>;

  /** Wins per game, most wins first. */
  getGameWins(since: string, until: string): Promise<UsageGameRow[]>;
}
