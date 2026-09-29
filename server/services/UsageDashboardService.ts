import type { IUserDAL } from '../dal/interfaces/IUserDAL.js';
import type { IUsageStatsDAL } from '../dal/interfaces/IUsageStatsDAL.js';
import { ForbiddenError, NotFoundError, ValidationError } from '../types/dal.js';
import { addDaysToDateString } from '../utils/streakDate.js';
import {
  USAGE_WINDOWS,
  type UsageDashboard,
  type UsageFeatureRow,
  type UsageWindowDays,
} from '../contracts/usage.js';

/** Display copy per feature key. Kept here (not in SQL) so the DAL returns data only. */
const FEATURE_LABELS: Record<UsageFeatureRow['key'], string> = {
  cardsAdded: 'Cards added',
  gameWins: 'Game wins',
  writingPractice: 'Writing practice',
  immersiveWorld: 'Immersive World runs',
  aiDictionary: 'AI dictionary lookups',
};

/**
 * UsageDashboardService — assembles the User Usage dashboard (docs/USAGE_DASHBOARD.md).
 *
 * LAYER: service. Owns the two decisions the DAL must not make:
 *   1. THE GATE — only `users.isAdmin` (migration 168) may read cross-user usage. This
 *      is a real security boundary, unlike the tester dashboard's client-side
 *      isValidator redirect, because every number here is about OTHER accounts.
 *   2. THE WINDOW — the caller picks from the closed `USAGE_WINDOWS` set; `0` means
 *      "since the first signup". The window is resolved to inclusive dates here.
 *
 * The six reads are independent and run in parallel; each borrows its own pooled
 * client, so one slow aggregate does not serialize the others.
 *
 * Depended on by: server/controllers/UsageDashboardController.ts, docs/USAGE_DASHBOARD.md.
 */
export class UsageDashboardService {
  constructor(
    private userDAL: IUserDAL,
    private usageStatsDAL: IUsageStatsDAL
  ) {}

  /** Parse the `?days=` query value into a supported window, or throw 400. */
  static parseWindow(raw: unknown): UsageWindowDays | undefined {
    if (raw === undefined || raw === '') return undefined;
    const n = Number(raw);
    if (!(USAGE_WINDOWS as readonly number[]).includes(n)) {
      throw new ValidationError(`days must be one of ${USAGE_WINDOWS.join(', ')}`);
    }
    return n as UsageWindowDays;
  }

  async getDashboard(userId: string, windowDays: UsageWindowDays): Promise<UsageDashboard> {
    const user = await this.userDAL.findById(userId);
    if (!user) throw new NotFoundError('User not found');
    if (!user.isAdmin) throw new ForbiddenError('Usage dashboard is restricted to admins');

    // "Today" is the server's UTC calendar day — the same day the DB's `::date` uses.
    const until = new Date().toISOString().slice(0, 10);
    const since =
      windowDays === 0
        ? (await this.usageStatsDAL.getFirstSignupDate()) ?? until
        : addDaysToDateString(until, -(windowDays - 1));

    const [headline, days, distinct, languages, featureCounts, games] = await Promise.all([
      this.usageStatsDAL.getHeadline(until),
      this.usageStatsDAL.getDailySeries(since, until),
      this.usageStatsDAL.getWindowDistinctUsers(since, until),
      this.usageStatsDAL.getLanguageBreakdown(since, until),
      this.usageStatsDAL.getFeatureCounts(since, until),
      this.usageStatsDAL.getGameWins(since, until),
    ]);

    // Additive totals come from the (already zero-filled) day series; only the
    // distinct-user counts need their own query, since users repeat across days.
    const sum = (pick: (d: (typeof days)[number]) => number) => days.reduce((acc, d) => acc + pick(d), 0);

    return {
      windowDays,
      since,
      until,
      generatedAt: new Date().toISOString(),
      headline,
      totals: {
        activeUsers: distinct.activeUsers,
        appOpenUsers: distinct.appOpenUsers,
        minutes: sum((d) => d.minutes),
        signups: sum((d) => d.signups),
        signIns: sum((d) => d.signIns),
      },
      days,
      languages,
      features: featureCounts.map((f) => ({ ...f, label: FEATURE_LABELS[f.key] })),
      games,
    };
  }
}
