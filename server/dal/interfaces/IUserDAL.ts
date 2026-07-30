import { IBaseDAL } from './IBaseDAL.js';
import { User, UserCreateData, UserUpdateData } from '../../types/index.js';

/**
 * Interface for User Data Access Layer
 * Extends base DAL with user-specific operations
 */
export interface IUserDAL extends IBaseDAL<User, UserCreateData, UserUpdateData> {
  // User-specific query operations
  findByEmail(email: string): Promise<User | null>;
  findByEmailWithPassword(email: string): Promise<User | null>;

  // Password management
  updatePassword(id: string, hashedPassword: string): Promise<boolean>;

  // User deletion
  deleteUser(userId: string): Promise<boolean>;

  // Batch operations
  findUsersCreatedAfter(date: Date): Promise<User[]>;

  // Minute-points counters and streak state are NOT on `users` — they live per
  // (userId, language) in user_language_minute_totals (migration 134). See
  // IUserLanguageTotalsDAL. The leaderboard rollups above aggregate them.

  // Minute point increment rate limiting
  updateLastMinutePointIncrement(userId: string, timestamp: Date): Promise<boolean>;

  // Timezone tracking — kept fresh from the client so the streak-expiration
  // cron can compute "today" in each user's local 4 AM-bounded day.
  updateTimezoneIfChanged(userId: string, timezone: string): Promise<void>;

  // Streak operations live on IUserLanguageTotalsDAL — streaks are per-language
  // since migration 134 (a live zh streak can coexist with a broken es one).
  // NOTE: streak-break / inactivity penalties are applied exclusively by the SQL
  // cron (database/cron/expire-stale-streaks.sql), not from application code.

  // Leaderboard operations (returns isPublic so callers can mask streak from non-public users)
  getAllUsersWithTotalPoints(): Promise<Array<{ userId: string; email: string; name: string; totalMinutePoints: number }>>;
  getPublicUsersWithTotalPoints(): Promise<Array<{ userId: string; email: string; name: string; totalMinutePoints: number; currentStreak: number; isPublic: boolean; avatarIconId: string | null }>>;
}
