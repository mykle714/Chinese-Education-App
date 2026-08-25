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

  /**
   * ATOMICALLY claim the next minute-point increment slot.
   *
   * Returns true iff this call won the claim — i.e. the row's
   * `lastMinutePointIncrement` was null or at least `cooldownSeconds` old, and has
   * now been stamped to `now` by this same statement. Returns false when the
   * cooldown has not elapsed.
   *
   * This EXISTS BECAUSE THE READ-THEN-WRITE VERSION MINTS CURRENCY. The service
   * used to read `lastMinutePointIncrement`, compare it in JS, bank the minute, and
   * only then stamp the column — so N concurrent requests all read the same stale
   * timestamp, all passed the check, and all banked a minute. Minute points fund
   * night-market unlocks, which made the gap a currency generator rather than a
   * cosmetic rate-limit miss. Compare-and-set in ONE statement is the fix: Postgres
   * serialises the row update, so exactly one concurrent caller sees rowCount 1.
   */
  claimMinutePointIncrement(userId: string, now: Date, cooldownSeconds: number): Promise<boolean>;

  // Timezone tracking — kept fresh from the client so the streak-expiration
  // cron can compute "today" in each user's local 4 AM-bounded day. Still a
  // property of the PERSON, not of the language they are studying.
  updateTimezoneIfChanged(userId: string, timezone: string): Promise<void>;

  // NOTE: wallets and streaks are NOT here — since migration 130 they are
  // per-(user, language) and live in IUserLanguagesDAL. `users` no longer has
  // totalMinutePoints / currentStreak / lastStreakDate / lastPenaltyDate columns.
  // See docs/PER_LANGUAGE_STREAKS.md.
  //
  // Streak-break / inactivity penalties remain the exclusive province of the SQL
  // cron (database/cron/expire-stale-streaks.sql), never application code.

  // Leaderboard roster. Returns identity + isPublic only; the caller joins the
  // per-language totals from IUserLanguagesDAL.getTotalsForAllUsers().
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

  /**
   * One account's PUBLIC identity by id, or null if there is no such account.
   *
   * Backs the user profile page (docs/USER_PROFILE_PAGE.md), which any signed-in
   * user may open for any other account. The column list is enumerated in the query
   * rather than selected with `*` precisely because this row leaves the account it
   * belongs to: adding a private column to `users` must not silently widen this
   * payload.
   */
  findPublicProfileById(userId: string): Promise<UserPublicProfile | null>;
}

/**
 * What {@link IUserDAL.findPublicProfileById} returns. A superset of
 * {@link UserScoringProfile} by `createdAt` — the two are kept as separate types
 * rather than one optional field so the leaderboard's bulk read is not silently
 * widened by a column only the profile needs.
 */
export interface UserPublicProfile extends UserScoringProfile {
  /** ISO timestamp, or null for a row predating the column's default. */
  createdAt: string | null;
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
