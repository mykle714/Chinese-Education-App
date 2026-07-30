import { IUserMinutePointsDAL } from '../dal/interfaces/IUserMinutePointsDAL.js';
import { IUserLanguageTotalsDAL } from '../dal/interfaces/IUserLanguageTotalsDAL.js';
import { IUserDAL } from '../dal/interfaces/IUserDAL.js';
import { NightMarketPlacementService } from './NightMarketPlacementService.js';
import {
  MinutePointsIncrementRequest,
  CalendarResponse,
  CalendarDay,
  UserLanguageTotals,
} from '../types/minutePoints.js';
import { ValidationError, NotFoundError, DALError } from '../types/dal.js';
import { STREAK_CONFIG } from '../constants.js';
import {
  resolveTimezone,
  streakDateOf,
  daysBetween,
} from '../utils/streakDate.js';

/**
 * UserMinutePoints Service.
 *
 * Streak day = a 4 AM-bounded calendar day in the user's local timezone.
 * Increment ticks the streak the moment a user crosses STREAK_CONFIG.RETENTION_MINUTES
 * for the current streak day.
 *
 * Streak breaks (gap ≥ 2 days since lastStreakDate) are handled exclusively by
 * the hourly Postgres cron at database/cron/expire-stale-streaks.sql — it
 * stamps the penalty row and rolls users.lastStreakDate / currentStreak /
 * totalMinutePoints forward.
 */
export class UserMinutePointsService {
  constructor(
    private userMinutePointsDAL: IUserMinutePointsDAL,
    // Per-(user,language) counters + streak state (migration 134). Every balance and
    // streak lives here; `users` no longer carries a global one.
    private userLanguageTotalsDAL: IUserLanguageTotalsDAL,
    private userDAL: IUserDAL,
    // Optional: the night-market grant flow. When present, earning a minute reconciles the
    // user's unlock entitlement (fill slots / spawn templates). Best-effort — a failure here
    // must never break the minute-point increment, so the call is wrapped + swallowed below.
    private nightMarketPlacementService?: NightMarketPlacementService
  ) {}

  /**
   * Add 1 minute point.
   * If this crosses RETENTION_MINUTES for the current streak day, update the streak.
   * Rate-limited to roughly one call per 59 seconds via users.lastMinutePointIncrement.
   */
  async incrementMinutePoints(userId: string, request: MinutePointsIncrementRequest): Promise<void> {
    const user = await this.userDAL.findById(userId);
    if (!user) {
      throw new NotFoundError('User not found');
    }

    const now = new Date();
    if (user.lastMinutePointIncrement) {
      const secondsSinceLast = (now.getTime() - user.lastMinutePointIncrement.getTime()) / 1000;
      if (secondsSinceLast < 59) {
        const wait = Math.ceil(59 - secondsSinceLast);
        throw new ValidationError(`Please wait ${wait} more seconds before incrementing again`);
      }
    }

    const tz = resolveTimezone(request.tz);
    const clientTimestamp = this.parseTimestamp(request.timestamp);
    const streakDate = streakDateOf(clientTimestamp, tz);

    // The minute is attributed to the language the client says it accrued for —
    // the client drove the timer and the per-language badge, so it is the source
    // of truth. Fall back to selectedLanguage (then 'zh') only when an old client
    // omits it, avoiding a mismatch when selectedLanguage has raced ahead.
    const language = request.language || user.selectedLanguage || 'zh';

    // Keep users.timezone fresh so the hourly streak-expiration cron can compute
    // "today" in this user's local 4 AM-bounded day. No-op when tz is unchanged.
    await this.userDAL.updateTimezoneIfChanged(userId, tz);

    // Day ledger (drives the calendar + the threshold check below) and the language's
    // counters (net + gross, one statement) are separate writes: the ledger is per-day,
    // the counters are per-language lifetime.
    const { previousMinutes, newMinutes } =
      await this.userMinutePointsDAL.addMinutesForDate(userId, streakDate, language, 1);

    const totals = await this.userLanguageTotalsDAL.creditEarnedMinutes(userId, language, 1);

    // The threshold is PER LANGUAGE (migration 134): 3 minutes of zh advance the zh
    // streak and nothing else. `addMinutesForDate` already returned this language's
    // before/after day totals, so no second query is needed — and note this is the
    // single-language row, NOT the cross-language sum the global streak used to read.
    const crossedThreshold =
      previousMinutes < STREAK_CONFIG.RETENTION_MINUTES &&
      newMinutes >= STREAK_CONFIG.RETENTION_MINUTES;

    if (crossedThreshold) {
      await this.advanceStreakForDate(userId, language, streakDate, totals);
      console.log(`[MINUTE-POINTS-SERVICE] 🔥 ${language} streak advanced for user ${userId.substring(0, 8)}... on ${streakDate}`);
    }

    await this.userDAL.updateLastMinutePointIncrement(userId, now);

    // Reconcile the night-market unlock entitlement (best-effort). The grant flow fills
    // placeholder slots / spawns templates; it is idempotent (no-ops when already at
    // target) so calling it every tick is cheap when no new threshold was crossed. A
    // failure here must not surface to the study loop, so it is caught and logged only.
    //
    // Scoped to THIS LANGUAGE's market (migration 136): each language grows its own market
    // from its own balance. `totals.netMinutePoints` is the value the credit above just
    // returned, so this needs no extra read and cannot race with a concurrent tick.
    if (this.nightMarketPlacementService) {
      try {
        await this.nightMarketPlacementService.grantUnlocks(userId, language, totals.netMinutePoints);
      } catch (err) {
        console.error(`[MINUTE-POINTS-SERVICE] night-market grant failed for user ${userId.substring(0, 8)}…`, err);
      }
    }
  }

  /**
   * AUTHOR-ONLY minute nudge (the nmp ±1/±5/±30 buttons — docs/NIGHT_MARKET_TEMPLATE_RUNTIME_PLAN.md).
   * Emits an artificial earn or loss signal so a template author can exercise the unlock economy
   * without waiting on real study time. Everything is scoped to the author's SELECTED language
   * (migration 134) — the nudge moves that language's balance, not a global one:
   *   • delta > 0 → adds to today's `minutesEarned` AND credits both counters (NET ↑, GROSS ↑).
   *   • delta < 0 → adds the actually-removed amount to today's `penaltyMinutes` (GROSS unchanged)
   *     AND debits net (floored at 0) — the same shape as the real penalty cron, which is why
   *     GROSS stays put and the two dashboard numbers diverge.
   * Then reconciles the night market to the new NET (grant on +, decay on −). Gated on
   * users.isTemplateAuthor (403). NOT rate-limited (unlike the +1 study path). Returns the fresh
   * per-language NET + GROSS so the client can update both numbers immediately.
   */
  async adjustMinutesForAuthor(
    userId: string,
    delta: number,
    timestamp: string,
    tz: string
  ): Promise<{ totalMinutePoints: number; lifetimeMinutesEarned: number }> {
    const user = await this.userDAL.findById(userId);
    if (!user) throw new NotFoundError('User not found');
    if (!user.isTemplateAuthor) {
      throw new DALError('Only template authors can adjust minutes', 'ERR_FORBIDDEN', 403);
    }
    if (!Number.isInteger(delta)) throw new ValidationError('delta must be an integer');

    const resolvedTz = resolveTimezone(tz);
    const streakDate = streakDateOf(this.parseTimestamp(timestamp), resolvedTz);
    const language = user.selectedLanguage || 'zh';
    await this.userDAL.updateTimezoneIfChanged(userId, resolvedTz);

    if (delta > 0) {
      // Earn signal: gross + net both rise for this language.
      await this.userMinutePointsDAL.addMinutesForDate(userId, streakDate, language, delta);
      await this.userLanguageTotalsDAL.creditEarnedMinutes(userId, language, delta);
    } else if (delta < 0) {
      // Loss signal: penalty rises (gross intact), net falls floored at 0.
      //
      // Stamp the amount ACTUALLY removed, not the requested amount. Debiting 30 from a
      // balance of 1 removes 1, and stamping 30 would leave the ledger claiming penalties
      // the user never paid — which is exactly how the pre-migration-134 data ended up
      // reconstructing to a negative balance (see migration 134's backfill notes). The
      // hourly cron has always stamped `total − new_total`; this path now matches it.
      const requested = -delta;
      const before = await this.userLanguageTotalsDAL.find(userId, language);
      const actuallyRemoved = Math.min(requested, before?.netMinutePoints ?? 0);

      if (actuallyRemoved > 0) {
        await this.userMinutePointsDAL.addPenaltyMinutesForDate(userId, streakDate, language, actuallyRemoved);
      }
      await this.userLanguageTotalsDAL.adjustNetMinutes(userId, language, -requested);
    }

    // Both counters for the adjusted language come back in one row read.
    const after = await this.userLanguageTotalsDAL.find(userId, language);

    // Make the market match the new balance. Unlike the passive study-tick grant, this is an
    // explicit author action, so a reconcile failure is allowed to surface (not swallowed).
    // Scoped to THIS LANGUAGE's market. reconcileUnlocks both grants and DECAYS, which is why
    // the author's −N path needs it where the study tick only ever grants.
    if (this.nightMarketPlacementService && delta !== 0) {
      await this.nightMarketPlacementService.reconcileUnlocks(userId, language, after?.netMinutePoints ?? 0);
    }

    // Field names are the API contract the nmp author panel reads; they now carry this
    // LANGUAGE's figures rather than global ones.
    return {
      totalMinutePoints: after?.netMinutePoints ?? 0,
      lifetimeMinutesEarned: after?.lifetimeMinutesEarned ?? 0,
    };
  }

  /**
   * Build a dense list of CalendarDay rows for the given YYYY-MM month, filling in zeroes
   * for days the user has no row.
   */
  async getCalendar(userId: string, language: string, yearMonth: string): Promise<CalendarResponse> {
    if (!/^\d{4}-\d{2}$/.test(yearMonth)) {
      throw new ValidationError('yearMonth must be in YYYY-MM format');
    }
    const [yearStr, monthStr] = yearMonth.split('-');
    const year = parseInt(yearStr, 10);
    const month = parseInt(monthStr, 10);
    if (month < 1 || month > 12) {
      throw new ValidationError('yearMonth has invalid month');
    }

    const startDate = `${yearStr}-${monthStr}-01`;
    // Last day of month: day 0 of the next month, in UTC.
    const lastDay = new Date(Date.UTC(year, month, 0)).getUTCDate();
    const endDate = `${yearStr}-${monthStr}-${String(lastDay).padStart(2, '0')}`;

    const rows = await this.userMinutePointsDAL.findInRange(userId, language, startDate, endDate);
    const userFirstActivityDate = await this.userMinutePointsDAL.getFirstActivityDate(userId, language);

    // Index rows by streakDate for O(1) lookup.
    const byDate = new Map<string, { minutesEarned: number; penaltyMinutes: number }>();
    for (const row of rows) {
      // pg returns DATE columns as Date objects; coerce to YYYY-MM-DD.
      const raw: unknown = row.streakDate;
      const dateKey =
        raw instanceof Date
          ? raw.toISOString().slice(0, 10)
          : String(raw).slice(0, 10);
      byDate.set(dateKey, {
        minutesEarned: row.minutesEarned ?? 0,
        penaltyMinutes: row.penaltyMinutes ?? 0,
      });
    }

    const days: CalendarDay[] = [];
    for (let d = 1; d <= lastDay; d++) {
      const date = `${yearStr}-${monthStr}-${String(d).padStart(2, '0')}`;
      const row = byDate.get(date) ?? { minutesEarned: 0, penaltyMinutes: 0 };
      days.push({
        date,
        minutesEarned: row.minutesEarned,
        penaltyMinutes: row.penaltyMinutes,
        streakMaintained: row.minutesEarned >= STREAK_CONFIG.RETENTION_MINUTES,
      });
    }

    return { yearMonth, days, userFirstActivityDate };
  }

  /**
   * Lifetime minutes the user has earned studying `language` (GROSS — penalties never
   * lower it). Powers the home screen's "total study time" for the selected language.
   *
   * Reads the maintained per-language counter as of migration 134. This was the last
   * figure still computed as a SUM over the user's whole `userminutepoints` history, so
   * its cost grew with account age; it is now O(1).
   */
  async getTotalForLanguage(userId: string, language: string): Promise<number> {
    const totals = await this.userLanguageTotalsDAL.find(userId, language);
    return totals?.lifetimeMinutesEarned ?? 0;
  }

  /**
   * Minutes earned today (4 AM-local-bounded streak day) studying `language`.
   * Powers the fire badge so switching languages shows that language's count.
   */
  async getTodayMinutes(userId: string, language: string, timestamp: string, tz: string): Promise<number> {
    const resolvedTz = resolveTimezone(tz);
    const streakDate = streakDateOf(this.parseTimestamp(timestamp), resolvedTz);
    return this.userMinutePointsDAL.getMinutesForDateAndLanguage(userId, streakDate, language);
  }

  /**
   * One-shot snapshot for the client's minute-points hook. **Every figure is scoped to
   * `language`** as of migration 134 — switching languages in the UI now switches the
   * whole panel, not just the fire badge:
   *   • totalMinutePoints — this language's penalty-debited NET balance. Decays on loss.
   *   • lifetimeMinutesEarned — this language's GROSS lifetime earned; only ever grows.
   *     gross ≥ net, and they DIFFER once this language has been penalised.
   *   • todayMinutes — this language's minutes on the current streak day (fire badge).
   *   • currentStreak — THIS LANGUAGE's streak. Previously one global streak kept alive
   *     by any language; a user can now hold a live zh streak and a broken es one.
   *
   * Two round trips: the day ledger for `todayMinutes` (inherently per-day) and one
   * counter row for the rest. The field names are unchanged because they are the API
   * contract the client hook reads; only their scope changed.
   */
  async getLanguageSummary(
    userId: string,
    language: string,
    timestamp: string,
    tz: string
  ): Promise<{ totalMinutePoints: number; lifetimeMinutesEarned: number; todayMinutes: number; currentStreak: number }> {
    const [todayMinutes, totals] = await Promise.all([
      this.getTodayMinutes(userId, language, timestamp, tz),
      this.userLanguageTotalsDAL.find(userId, language),
    ]);
    // A user who has never earned in this language has no row yet — that is a legitimate
    // zero state (they are about to earn their first minute), not an error.
    return {
      totalMinutePoints: totals?.netMinutePoints ?? 0,
      lifetimeMinutesEarned: totals?.lifetimeMinutesEarned ?? 0,
      todayMinutes,
      currentStreak: totals?.currentStreak ?? 0,
    };
  }

  // ─────────────────────────────────────────────────────────────
  // internals
  // ─────────────────────────────────────────────────────────────

  /**
   * Advance ONE language's streak after that language crossed its daily threshold for
   * `streakDate`. Continues if the language's previous streak day was yesterday;
   * otherwise restarts at 1.
   *
   * Per-language as of migration 134: a user can hold a live zh streak and a broken es
   * one simultaneously, and each advances only on its own qualifying days. `totals` is
   * the row the caller's credit just returned, so the prior streak state needs no re-read.
   */
  private async advanceStreakForDate(
    userId: string,
    language: string,
    streakDate: string,
    totals: UserLanguageTotals
  ): Promise<void> {
    let newStreak: number;

    if (!totals.lastStreakDate) {
      newStreak = 1;
    } else if (totals.lastStreakDate === streakDate) {
      // Already credited for today. (Shouldn't happen given the threshold guard, but harmless.)
      return;
    } else if (daysBetween(totals.lastStreakDate, streakDate) === 1) {
      newStreak = totals.currentStreak + 1;
    } else {
      // Gap > 1 day means the user came back after a break before the
      // hourly streak-expiration cron noticed. Treat this as a fresh streak.
      newStreak = 1;
    }

    await this.userLanguageTotalsDAL.setStreak(userId, language, newStreak, streakDate);
  }

  private parseTimestamp(input: string): Date {
    if (typeof input !== 'string') {
      throw new ValidationError('timestamp must be an ISO-8601 string');
    }
    const parsed = new Date(input);
    if (isNaN(parsed.getTime())) {
      throw new ValidationError('timestamp is not a valid date');
    }
    return parsed;
  }
}
