import { IUserMinutePointsDAL } from '../dal/interfaces/IUserMinutePointsDAL.js';
import { IUserDAL } from '../dal/interfaces/IUserDAL.js';
import { IUserLanguagesDAL } from '../dal/interfaces/IUserLanguagesDAL.js';
import { NightMarketPlacementService } from './NightMarketPlacementService.js';
import {
  MinutePointsIncrementRequest,
  CalendarResponse,
  CalendarDay,
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
 * LAYER: service. Owns the study-time economy: earning minutes, crossing the daily
 * threshold, and reconciling the night market that minutes fund.
 *
 * EVERYTHING HERE IS PER-LANGUAGE (migration 130, docs/PER_LANGUAGE_STREAKS.md).
 * The wallet, the streak and the penalty schedule are keyed (userId, language) in
 * user_languages; a user studying zh and es has two independent tracks that
 * never read or write each other's state. Three minutes of Spanish no longer keeps
 * a Chinese streak alive.
 *
 * Streak day = a 4 AM-bounded calendar day in the user's local timezone. The
 * timezone stays a property of the PERSON (users.timezone) — only the progress it
 * bounds is per-language.
 *
 * Streak breaks (gap ≥ 2 days since that language's lastStreakDate) are handled
 * exclusively by the hourly Postgres cron at database/cron/expire-stale-streaks.sql
 * — it stamps the penalty row and rolls that language's lastStreakDate /
 * currentStreak / totalMinutePoints forward.
 */
export class UserMinutePointsService {
  constructor(
    private userMinutePointsDAL: IUserMinutePointsDAL,
    private userDAL: IUserDAL,
    private userLanguagesDAL: IUserLanguagesDAL,
    // Optional: the night-market grant flow. When present, earning a minute reconciles the
    // user's unlock entitlement (fill slots / spawn templates). Best-effort — a failure here
    // must never break the minute-point increment, so the call is wrapped + swallowed below.
    private nightMarketPlacementService?: NightMarketPlacementService,
    // Optional: the arena. When present, every credited minute is also added to
    // the user's live arena membership for THIS language. Best-effort in exactly
    // the same way the night-market grant is — see the call site below.
    private arenaService?: { creditMinutes(userId: string, language: string, minutes: number): Promise<void> }
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

    await this.userMinutePointsDAL.addMinutesForDate(userId, streakDate, language, 1);

    const totalMinutePoints = await this.userLanguagesDAL.incrementPoints(userId, language, 1);

    // The streak is PER-LANGUAGE: only minutes in THIS language can advance THIS
    // language's streak. Decide the threshold crossing on the single language row
    // we just bumped, never on the cross-language sum.
    const newMinutes = await this.userMinutePointsDAL.getMinutesForDateAndLanguage(
      userId,
      streakDate,
      language
    );
    const previousMinutes = newMinutes - 1;

    const crossedThreshold =
      previousMinutes < STREAK_CONFIG.RETENTION_MINUTES &&
      newMinutes >= STREAK_CONFIG.RETENTION_MINUTES;

    if (crossedThreshold) {
      await this.advanceStreakForDate(userId, language, streakDate);
      console.log(`[MINUTE-POINTS-SERVICE] 🔥 ${language} streak advanced for user ${userId.substring(0, 8)}... on ${streakDate}`);
    }

    await this.userDAL.updateLastMinutePointIncrement(userId, now);

    // Reconcile THIS LANGUAGE's night-market unlock entitlement against its new wallet
    // (best-effort). Each language grows its own market, so the grant is scoped to the
    // language whose minute we just banked. The grant flow fills placeholder slots /
    // spawns templates; it is idempotent (no-ops when already at target) so calling it
    // every tick is cheap when no new threshold was crossed. A failure here must not
    // surface to the study loop, so it is caught and logged only.
    if (this.nightMarketPlacementService) {
      try {
        await this.nightMarketPlacementService.grantUnlocks(userId, language, totalMinutePoints);
      } catch (err) {
        console.error(`[MINUTE-POINTS-SERVICE] night-market grant failed for user ${userId.substring(0, 8)}… (${language})`, err);
      }
    }

    // Credit the same minute to this language's live arena membership, if any
    // (docs/ARENA_FEATURE.md § 4.1). Scoped to the language for the same reason
    // the streak and the market are: an arena membership IS a (user, language).
    //
    // Best-effort and deliberately last. The ledger (userminutepoints) is the
    // source of truth for everything that matters; an arena is a view on top of
    // it. A broken arena must never be able to stop a minute being banked, so
    // ArenaService.creditMinutes swallows its own failures and this call is
    // guarded again here.
    if (this.arenaService) {
      try {
        await this.arenaService.creditMinutes(userId, language, 1);
      } catch (err) {
        console.error(`[MINUTE-POINTS-SERVICE] arena credit failed for user ${userId.substring(0, 8)}… (${language})`, err);
      }
    }
  }

  /**
   * AUTHOR-ONLY minute nudge (the nmp ±1/±5/±30 buttons — docs/NIGHT_MARKET_TEMPLATE_RUNTIME_PLAN.md).
   * Emits an artificial earn or loss signal so a template author can exercise the unlock economy
   * without waiting on real study time:
   *   • delta > 0 → adds to today's `minutesEarned` (GROSS ↑) AND credits totalMinutePoints (NET ↑).
   *   • delta < 0 → adds |delta| to today's `penaltyMinutes` (GROSS unchanged) AND debits
   *     totalMinutePoints (NET ↓, floored at 0) — the same shape as the real penalty cron, which is
   *     why GROSS stays put and the two dashboard numbers diverge.
   * Then reconciles that language's night market to the new NET (grant on +, decay on −).
   * Gated on users.isTemplateAuthor (403). NOT rate-limited (unlike the +1 study path).
   * Returns the fresh NET balance + gross for THAT LANGUAGE so the client can update both
   * numbers immediately. All of it is scoped to users.selectedLanguage.
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
      // Earn signal: gross + net both rise. One statement bumps both counters on the
      // language's user_languages row, so the pair cannot drift (migration 134).
      await this.userMinutePointsDAL.addMinutesForDate(userId, streakDate, language, delta);
      await this.userLanguagesDAL.incrementPoints(userId, language, delta);
    } else if (delta < 0) {
      // Loss signal: penalty rises (gross intact), net falls floored at 0.
      //
      // Stamp the amount ACTUALLY removed, not the requested amount. Debiting 30 from a
      // balance of 1 removes 1, and stamping 30 would leave the ledger claiming penalties
      // the user never paid, so reconstructing a balance from the ledger would go negative.
      // The hourly cron has always stamped `total − new_total`; this path now matches it.
      const requested = -delta;
      const before = await this.userLanguagesDAL.getProgress(userId, language);
      const actuallyRemoved = Math.min(requested, before.totalMinutePoints);

      if (actuallyRemoved > 0) {
        await this.userMinutePointsDAL.addPenaltyMinutesForDate(userId, streakDate, language, actuallyRemoved);
      }
      // Still pass the full request: adjustPoints floors at 0 itself, so this is a no-op
      // beyond the floor and keeps the DAL the single owner of the flooring rule.
      await this.userLanguagesDAL.adjustPoints(userId, language, -requested);
    }

    // Both of this language's counters come back in one row read — no unbounded SUM over
    // the day ledger (that is what migration 134's counter replaced).
    const after = await this.userLanguagesDAL.getProgress(userId, language);

    // Make THIS LANGUAGE's market match its new net balance. Unlike the passive study-tick
    // grant, this is an explicit author action, so a reconcile failure is allowed to surface
    // (not swallowed). reconcileUnlocks both grants and DECAYS, which is why the author's
    // −N path needs it where the study tick only ever grants.
    if (this.nightMarketPlacementService && delta !== 0) {
      await this.nightMarketPlacementService.reconcileUnlocks(userId, language, after.totalMinutePoints);
    }

    return {
      totalMinutePoints: after.totalMinutePoints,
      lifetimeMinutesEarned: after.lifetimeMinutesEarned,
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
   * Lifetime minutes the user has earned studying `language` — GROSS, ignoring
   * penalties, so it only ever grows. Powers the home screen's "total study time".
   * (Distinct from user_languages.totalMinutePoints, which is the same
   * language's penalty-debited NET wallet; the two DIVERGE once penalised.)
   *
   * Reads the maintained counter, NOT a SUM over the day ledger: that SUM was the one
   * aggregate in this system whose cost grew with account age. See migration 134.
   */
  async getTotalForLanguage(userId: string, language: string): Promise<number> {
    const { lifetimeMinutesEarned } = await this.userLanguagesDAL.getProgress(userId, language);
    return lifetimeMinutesEarned;
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
   * One-shot snapshot for the client's minute-points hook. EVERY figure is scoped to
   * `language` — since migration 130 there is no global balance or global streak:
   *   • totalMinutePoints — that language's penalty-debited NET wallet
   *     (user_languages.totalMinutePoints); drives ITS night-market unlocks and the
   *     prominent "current balance" number. Decays when the language is neglected.
   *   • lifetimeMinutesEarned — that language's lifetime minutes earned, ignoring penalties;
   *     only ever grows. Shown as the secondary "total earned" figure. gross ≥ net, and they
   *     DIFFER once that language has been penalised. Read from the migration-134 counter,
   *     not summed over the ledger.
   *   • todayMinutes — that language's minutes today (the fire badge).
   *   • currentStreak — that language's streak.
   *
   * Switching languages therefore swaps the entire snapshot, which is the intended UX:
   * each language shows its own independent progress.
   *
   * Two queries, not three: the wallet, the streak and the gross counter all live on the
   * same user_languages row, so one getProgress() serves all three.
   */
  async getLanguageSummary(
    userId: string,
    language: string,
    timestamp: string,
    tz: string
  ): Promise<{ totalMinutePoints: number; lifetimeMinutesEarned: number; todayMinutes: number; currentStreak: number }> {
    const [todayMinutes, progress] = await Promise.all([
      this.getTodayMinutes(userId, language, timestamp, tz),
      this.userLanguagesDAL.getProgress(userId, language),
    ]);
    return {
      totalMinutePoints: progress.totalMinutePoints,
      lifetimeMinutesEarned: progress.lifetimeMinutesEarned,
      todayMinutes,
      currentStreak: progress.currentStreak,
    };
  }

  // ─────────────────────────────────────────────────────────────
  // internals
  // ─────────────────────────────────────────────────────────────

  /**
   * Update ONE LANGUAGE's currentStreak after it crossed the daily threshold for
   * `streakDate`. Continues if that language's previous streak day was yesterday;
   * otherwise restarts at 1. Other languages are untouched.
   */
  private async advanceStreakForDate(
    userId: string,
    language: string,
    streakDate: string
  ): Promise<void> {
    const info = await this.userLanguagesDAL.getProgress(userId, language);
    let newStreak: number;

    if (!info.lastStreakDate) {
      // First time this language has ever hit the threshold. This is also the moment
      // it becomes eligible for the penalty cron, which skips lastStreakDate IS NULL.
      newStreak = 1;
    } else if (info.lastStreakDate === streakDate) {
      // Already credited for today. (Shouldn't happen given the threshold guard, but harmless.)
      return;
    } else if (daysBetween(info.lastStreakDate, streakDate) === 1) {
      newStreak = info.currentStreak + 1;
    } else {
      // Gap > 1 day means the user came back to this language after a break before the
      // hourly streak-expiration cron noticed. Treat this as a fresh streak.
      newStreak = 1;
    }

    await this.userLanguagesDAL.setStreak(userId, language, newStreak, streakDate);
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
