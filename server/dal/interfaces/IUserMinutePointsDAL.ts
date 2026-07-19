import { ITransaction } from '../../types/dal.js';
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

  // Day total summed across ALL languages — used by the global streak/leaderboard.
  getMinutesForDate(userId: string, streakDate: string): Promise<number>;

  // Day total for a single language — used by the per-language fire badge.
  getMinutesForDateAndLanguage(userId: string, streakDate: string, language: string): Promise<number>;

  // Lifetime total for a single language — used by the home screen "total study time".
  getTotalMinutesForLanguage(userId: string, language: string): Promise<number>;

  // GLOBAL gross minutes earned across ALL languages (Σ minutesEarned, ignoring penalties).
  // The "lifetime earned" figure; pairs with the penalty-debited net (users.totalMinutePoints).
  getGrossMinutesEarned(userId: string): Promise<number>;

  // Transaction-aware variant
  addMinutesForDateWithTransaction(
    userId: string,
    streakDate: string,
    language: string,
    delta: number,
    transaction: ITransaction
  ): Promise<{ previousMinutes: number; newMinutes: number }>;
}
