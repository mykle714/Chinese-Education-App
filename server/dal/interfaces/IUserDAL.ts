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

  // Minute point increment rate limiting
  updateLastMinutePointIncrement(userId: string, timestamp: Date): Promise<boolean>;

  // Timezone tracking — kept fresh from the client so the streak-expiration
  // cron can compute "today" in each user's local 4 AM-bounded day. Still a
  // property of the PERSON, not of the language they are studying.
  updateTimezoneIfChanged(userId: string, timezone: string): Promise<void>;

  // NOTE: wallets and streaks are NOT here — since migration 130 they are
  // per-(user, language) and live in IUserLanguagePointsDAL. `users` no longer has
  // totalMinutePoints / currentStreak / lastStreakDate / lastPenaltyDate columns.
  // See docs/PER_LANGUAGE_STREAKS.md.
  //
  // Streak-break / inactivity penalties remain the exclusive province of the SQL
  // cron (database/cron/expire-stale-streaks.sql), never application code.

  // Leaderboard roster. Returns identity + isPublic only; the caller joins the
  // per-language totals from IUserLanguagePointsDAL.getTotalsForAllUsers().
  getLeaderboardRoster(): Promise<Array<{ userId: string; email: string; name: string; isPublic: boolean; avatarIconId: string | null }>>;

  /**
   * Identity + the two things a per-user SCORE depends on — which language the
   * account is studying and which mastery goals it pursues — for a set of ids in
   * one query. Feeds the friends leaderboard, which scores every person in their
   * OWN selected language (docs/FRIENDS_FEATURE.md § Leaderboard).
   *
   * Ids with no account are simply absent from the result; the caller must not
   * assume the array is the same length as its input.
   */
  findScoringProfilesByIds(userIds: string[]): Promise<UserScoringProfile[]>;
}

/** What {@link IUserDAL.findScoringProfilesByIds} returns for one account. */
export interface UserScoringProfile {
  userId: string;
  email: string;
  name: string | null;
  avatarIconId: string | null;
  /** Null when the account never picked one; callers default it. */
  selectedLanguage: string | null;
  readingGoal: boolean;
  writingGoal: boolean;
}
