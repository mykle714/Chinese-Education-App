import { IUserMinutePointsDAL } from '../dal/interfaces/IUserMinutePointsDAL.js';
import { IUserDAL } from '../dal/interfaces/IUserDAL.js';
import { IUserLanguagesDAL } from '../dal/interfaces/IUserLanguagesDAL.js';
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
  addDaysToDateString,
} from '../utils/streakDate.js';

/**
 * How long a user must wait between credited minutes. Just under 60s so a client
 * ticking on a one-minute timer is never rejected for arriving a few milliseconds
 * early. Enforced as an atomic compare-and-set, not a read-then-check — see
 * `incrementMinutePoints`.
 */
const MINUTE_POINT_COOLDOWN_SECONDS = 59;

/**
 * How far a client's self-reported timestamp may sit from server time before it is
 * ignored. Generous enough for a genuinely skewed device clock, far too small to
 * reach another 04:00-bounded local day, which is the thing an attacker wants.
 */
const MAX_CLIENT_CLOCK_SKEW_MS = 30 * 60 * 1000;

/**
 * UserMinutePoints Service.
 *
 * LAYER: service. Owns the study-time economy: earning minutes, crossing the daily
 * threshold, and crediting the arena.
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
    // Optional: the arena. When present, every credited minute is also added to
    // the user's live arena membership for THIS language. Best-effort — see the
    // call site below.
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
    // ── THE COOLDOWN IS CLAIMED, NOT CHECKED ────────────────────────────────
    // One statement decides eligibility AND stamps the row, so concurrent requests
    // cannot all pass. This used to be a read here plus an UPDATE at the end of the
    // method, with a dozen awaits in between: a scripted client firing N requests at
    // once had them all read the same stale timestamp and all bank a minute. Minute
    // points are a currency (they fund the leaderboard, arena and streaks), so that gap
    // MINTED CURRENCY rather than merely relaxing a rate limit. See IUserDAL.claimMinutePointIncrement.
    //
    // Side effect of claiming up front: the window now runs from the start of a
    // request rather than its completion. That is strictly the safer direction and
    // is invisible at a 59-second granularity.
    const claimed = await this.userDAL.claimMinutePointIncrement(
      userId, now, MINUTE_POINT_COOLDOWN_SECONDS
    );
    if (!claimed) {
      // Only reached on the losing side of the claim, so re-reading for an exact
      // remaining-seconds figure is not worth a second round trip.
      throw new ValidationError('Please wait before incrementing again');
    }

    const tz = resolveTimezone(request.tz);
    // CLAMPED, NOT TRUSTED. The client's own clock decides which LOCAL DAY the minute
    // lands on, which is legitimate (it drove the timer), but an unbounded timestamp
    // let a scripted client bank minutes into arbitrary past or future days —
    // fabricating calendar history and, worse, stamping `lastStreakDate` far in the
    // future, where the penalty cron reads the account as permanently current and the
    // streak can never break. Anything further from server time than the tolerance is
    // replaced by server now, so a merely skewed device still works and a crafted
    // timestamp buys nothing.
    const clientTimestamp = this.clampToServerNow(this.parseTimestamp(request.timestamp), now);
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

    // Credit the same minute to this language's live arena membership, if any
    // (docs/ARENA_FEATURE.md § 4.1). Scoped to the language for the same reason
    // the streak is: an arena membership IS a (user, language).
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
   * One-shot snapshot for the client's minute-points hook. EVERY figure is scoped to
   * `language` — since migration 130 there is no global balance or global streak:
   *   • totalMinutePoints — that language's penalty-debited NET wallet
   *     (user_languages.totalMinutePoints); drives the
   *     prominent "current balance" number. Decays when the language is neglected.
   *   • lifetimeMinutesEarned — that language's lifetime minutes earned, ignoring penalties;
   *     only ever grows. Shown as the secondary "total earned" figure. gross ≥ net, and they
   *     DIFFER once that language has been penalised. Read from the migration-134 counter,
   *     not summed over the ledger.
   *   • todayMinutes — that language's minutes today (the fire badge).
   *   • yesterdayMinutes — that language's minutes on the previous streak day. The size
   *     of the td daily banking animation (docs/DAILY_MINUTE_BANKING.md § 4).
   *   • bankingPending — whether today's banking run is still owed: yesterday > 0 and
   *     the run has not started yet this streak day (migration 175). Decided HERE so the
   *     client never compares streak dates itself.
   *   • currentStreak — that language's streak.
   *
   * Switching languages therefore swaps the entire snapshot, which is the intended UX:
   * each language shows its own independent progress.
   *
   * Three single-row reads in parallel: today's and yesterday's ledger rows (both PK
   * lookups) and the user_languages row, which serves the wallet, the streak, the gross
   * counter and the banking marker at once.
   */
  async getLanguageSummary(
    userId: string,
    language: string,
    timestamp: string,
    tz: string
  ): Promise<{
    totalMinutePoints: number;
    lifetimeMinutesEarned: number;
    todayMinutes: number;
    yesterdayMinutes: number;
    bankingPending: boolean;
    currentStreak: number;
  }> {
    const streakDate = streakDateOf(this.parseTimestamp(timestamp), resolveTimezone(tz));
    const yesterday = addDaysToDateString(streakDate, -1);
    const [todayMinutes, yesterdayMinutes, progress] = await Promise.all([
      this.userMinutePointsDAL.getMinutesForDateAndLanguage(userId, streakDate, language),
      this.userMinutePointsDAL.getMinutesForDateAndLanguage(userId, yesterday, language),
      this.userLanguagesDAL.getProgress(userId, language),
    ]);
    return {
      totalMinutePoints: progress.totalMinutePoints,
      lifetimeMinutesEarned: progress.lifetimeMinutesEarned,
      todayMinutes,
      yesterdayMinutes,
      // Q11a: a zero day has nothing to bank, so it never owes a run.
      bankingPending: yesterdayMinutes > 0 && progress.lastBankingShownDate !== streakDate,
      currentStreak: progress.currentStreak,
    };
  }

  /**
   * Record that the td daily banking animation has STARTED for this (user, language)
   * today (docs/DAILY_MINUTE_BANKING.md § 5). Sent at the start of the run, not the end,
   * so closing the tab mid-animation cannot replay it on another device.
   *
   * The streak date is resolved here from the client's clock + timezone, clamped to
   * server time exactly as the increment path is, so the stamp always matches the date
   * `getLanguageSummary` compares it against.
   */
  async markBankingSeen(userId: string, language: string, timestamp: string, tz: string): Promise<void> {
    const now = new Date();
    const clientTimestamp = this.clampToServerNow(this.parseTimestamp(timestamp), now);
    const streakDate = streakDateOf(clientTimestamp, resolveTimezone(tz));
    await this.userLanguagesDAL.markBankingShown(userId, language, streakDate);
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

  /**
   * Replace a client timestamp that is implausibly far from server time with server
   * now. See the call site for why this is a clamp rather than a rejection: a user
   * with a skewed device clock keeps working (their minute simply lands on the
   * server-derived day), while a crafted timestamp cannot reach `streakDateOf`.
   */
  private clampToServerNow(clientTimestamp: Date, now: Date): Date {
    const skewMs = Math.abs(clientTimestamp.getTime() - now.getTime());
    if (skewMs <= MAX_CLIENT_CLOCK_SKEW_MS) return clientTimestamp;
    console.warn(
      `[MINUTE-POINTS-SERVICE] client timestamp ${clientTimestamp.toISOString()} is ` +
        `${Math.round(skewMs / 1000)}s from server time — clamping to now`
    );
    return now;
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
