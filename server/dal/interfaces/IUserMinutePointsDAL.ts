import { ITransaction } from '../../types/dal.js';
import { UserMinutePoints } from '../../types/minutePoints.js';

export interface IUserMinutePointsDAL {
  findByUserAndStreakDate(userId: string, streakDate: string): Promise<UserMinutePoints | null>;

  // Increment minutes earned for a (user, streakDate) by `delta`. Inserts the row if missing.
  // Returns the previous and new minutesEarned values.
  addMinutesForDate(
    userId: string,
    streakDate: string,
    delta: number
  ): Promise<{ previousMinutes: number; newMinutes: number }>;

  // Stamp penaltyMinutes on a specific streakDate (the day the user missed).
  // Inserts the row with zero earned minutes if missing.
  addPenaltyMinutesForDate(
    userId: string,
    streakDate: string,
    penaltyMinutes: number
  ): Promise<void>;

  // Range queries (calendar + first-activity lookup)
  findInRange(userId: string, startDate: string, endDate: string): Promise<UserMinutePoints[]>;
  getMinutesForDate(userId: string, streakDate: string): Promise<number>;
  getFirstActivityDate(userId: string): Promise<string | null>;

  // Transaction-aware variant
  addMinutesForDateWithTransaction(
    userId: string,
    streakDate: string,
    delta: number,
    transaction: ITransaction
  ): Promise<{ previousMinutes: number; newMinutes: number }>;
}
