import { IUserMinutePointsDAL } from '../dal/interfaces/IUserMinutePointsDAL.js';
import { IUserDAL } from '../dal/interfaces/IUserDAL.js';
import {
  MinutePointsIncrementRequest,
  MinutePointsNewDayRequest,
  CalendarResponse,
  CalendarDay,
} from '../types/minutePoints.js';
import { ValidationError, NotFoundError } from '../types/dal.js';
import { STREAK_CONFIG } from '../constants.js';
import {
  resolveTimezone,
  streakDateOf,
  addDaysToDateString,
  daysBetween,
  isValidDateString,
} from '../utils/streakDate.js';

/**
 * UserMinutePoints Service.
 *
 * Streak day = a 4 AM-bounded calendar day in the user's local timezone.
 * Increment ticks the streak the moment a user crosses STREAK_CONFIG.RETENTION_MINUTES
 * for the current streak day.
 * newDayOperation handles streak breaks: if the gap since lastStreakDate is ≥ 2 days,
 * the streak is reset and a penalty is stamped on the day the user first missed.
 */
export class UserMinutePointsService {
  constructor(
    private userMinutePointsDAL: IUserMinutePointsDAL,
    private userDAL: IUserDAL
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

    const { previousMinutes, newMinutes } = await this.userMinutePointsDAL.addMinutesForDate(userId, streakDate, 1);

    await this.userDAL.incrementTotalMinutePoints(userId, 1);

    const crossedThreshold =
      previousMinutes < STREAK_CONFIG.RETENTION_MINUTES &&
      newMinutes >= STREAK_CONFIG.RETENTION_MINUTES;

    if (crossedThreshold) {
      await this.advanceStreakForDate(userId, streakDate);
      console.log(`[MINUTE-POINTS-SERVICE] 🔥 Streak advanced for user ${userId.substring(0, 8)}... on ${streakDate}`);
    }

    await this.userDAL.updateLastMinutePointIncrement(userId, now);
  }

  /**
   * Apply day-boundary streak logic.
   * Idempotent — safe to call on every app load.
   */
  async newDayOperation(userId: string, request: MinutePointsNewDayRequest): Promise<void> {
    const tz = resolveTimezone(request.tz);
    const clientTimestamp = this.parseTimestamp(request.timestamp);
    const today = streakDateOf(clientTimestamp, tz);

    const streakInfo = await this.userDAL.getUserStreakInfo(userId);
    if (!streakInfo.lastStreakDate) {
      // No streak history → nothing to break.
      return;
    }

    const gap = daysBetween(streakInfo.lastStreakDate, today);
    if (gap < 2) {
      // Streak is alive (today is same day, or yesterday at worst).
      return;
    }

    // Streak broken. Stamp penalty on the FIRST missed day = lastStreakDate + 1.
    const missedDate = addDaysToDateString(streakInfo.lastStreakDate, 1);

    console.log(`[MINUTE-POINTS-SERVICE] 💔 Streak broken for ${userId.substring(0, 8)}... gap=${gap} days; penalty stamped on ${missedDate}`);

    await this.userMinutePointsDAL.addPenaltyMinutesForDate(userId, missedDate, STREAK_CONFIG.DAILY_PENALTY_MINUTES);
    await this.userDAL.applyStreakPenalty(userId, STREAK_CONFIG.DAILY_PENALTY_MINUTES, today);
  }

  /**
   * Build a dense list of CalendarDay rows for the given YYYY-MM month, filling in zeroes
   * for days the user has no row.
   */
  async getCalendar(userId: string, yearMonth: string): Promise<CalendarResponse> {
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

    const rows = await this.userMinutePointsDAL.findInRange(userId, startDate, endDate);
    const userFirstActivityDate = await this.userMinutePointsDAL.getFirstActivityDate(userId);

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

  // ─────────────────────────────────────────────────────────────
  // internals
  // ─────────────────────────────────────────────────────────────

  /**
   * Update the user's currentStreak after they crossed the daily threshold for `streakDate`.
   * Continues if the previous streak day was yesterday; otherwise restarts at 1.
   */
  private async advanceStreakForDate(userId: string, streakDate: string): Promise<void> {
    const info = await this.userDAL.getUserStreakInfo(userId);
    let newStreak: number;

    if (!info.lastStreakDate) {
      newStreak = 1;
    } else if (info.lastStreakDate === streakDate) {
      // Already credited for today. (Shouldn't happen given the threshold guard, but harmless.)
      return;
    } else if (daysBetween(info.lastStreakDate, streakDate) === 1) {
      newStreak = info.currentStreak + 1;
    } else {
      // Gap > 1 day means the user came back after a break before newDayOperation noticed.
      // Treat this as a fresh streak.
      newStreak = 1;
    }

    await this.userDAL.setStreak(userId, newStreak, streakDate);
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
