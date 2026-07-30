import { UserMinutePoints } from '../../types/minutePoints.js';

export interface IUserMinutePointsDAL {
  findByUserAndStreakDate(userId: string, streakDate: string, language: string): Promise<UserMinutePoints | null>;

  // Increment minutes earned for a (user, streakDate, language) by `delta`.
  // Inserts the row if missing. Returns the previous and new minutesEarned
  // values *for that language row*.
  addMinutesForDate(
    userId: string,
    streakDate: string,
    language: string,
    delta: number
  ): Promise<{ previousMinutes: number; newMinutes: number }>;

  // Add `amount` to penaltyMinutes for a (user, streakDate, language), inserting the row if
  // missing (minutesEarned untouched). Written by the hourly SQL cron for real inactivity
  // penalties; also by the AUTHOR minute-adjust tool's −N "lose minutes" path.
  addPenaltyMinutesForDate(
    userId: string,
    streakDate: string,
    language: string,
    amount: number
  ): Promise<void>;

  // Calendar rows for one language over a date range, plus the per-language
  // first-activity lookup that bounds "hasData" on the calendar.
  findInRange(userId: string, language: string, startDate: string, endDate: string): Promise<UserMinutePoints[]>;
  getFirstActivityDate(userId: string, language: string): Promise<string | null>;

  // Day total summed across ALL languages — used by the global streak check.
  getMinutesForDate(userId: string, streakDate: string): Promise<number>;

  // Batch form of the above: many users × many dates in ONE grouped query, returned
  // as userId → streakDate → minutes. Used by the leaderboard, which needs today's
  // and yesterday's totals for every ranked user and must not issue 2N round trips.
  // Absent pairs mean "no minutes recorded"; callers default with `?? 0`.
  getMinutesForDatesByUser(userIds: string[], streakDates: string[]): Promise<Map<string, Map<string, number>>>;

  // Day total for a single language — used by the per-language fire badge.
  getMinutesForDateAndLanguage(userId: string, streakDate: string, language: string): Promise<number>;

  // Lifetime total for a single language — used by the home screen "total study time".
  getTotalMinutesForLanguage(userId: string, language: string): Promise<number>;

  // NOTE: lifetime-earned is NOT served from this table. It is the maintained per-language
  // counter user_language_minute_totals."lifetimeMinutesEarned" (migrations 133 then 134),
  // read via IUserLanguageTotalsDAL — summing the ledger grew with account age.

}
