/**
 * Interface for the per-language progress Data Access Layer.
 *
 * LAYER: DAL. Owns `user_language_points` — the (userId, language)-keyed wallet +
 * streak state introduced by migration 130. Everything here used to be four global
 * columns on `users`; see docs/PER_LANGUAGE_STREAKS.md for why they were split.
 *
 * Invariant: `lastStreakDate` is advanced ONLY by the increment path (via
 * {@link setStreak}). The penalty cron never writes it — that is what makes the
 * penalty tier gap grow by exactly one per continued missed day.
 */

/** A user's full progress state for one language. */
export interface LanguageProgress {
  language: string;
  /** NET wallet: penalty-debited, floored at 0. Funds this language's night market. */
  totalMinutePoints: number;
  /** Consecutive qualifying days in this language. */
  currentStreak: number;
  /** Last local day this language crossed RETENTION_MINUTES, as YYYY-MM-DD. */
  lastStreakDate: string | null;
}

/** Per-user aggregate across every language — what the global leaderboard ranks on. */
export interface UserPointsTotals {
  userId: string;
  /** Σ totalMinutePoints over all of the user's languages. */
  totalMinutePoints: number;
  /** MAX currentStreak over all of the user's languages. */
  bestStreak: number;
}

export interface IUserLanguagePointsDAL {
  /**
   * Read one language's progress. Returns a zeroed record (not null) for a language
   * the user has never studied, so callers never branch on existence — a language
   * with no row is semantically identical to one at zero.
   */
  getProgress(userId: string, language: string): Promise<LanguageProgress>;

  /** Every language the user has a progress row for. */
  getAllProgress(userId: string): Promise<LanguageProgress[]>;

  /**
   * Add `pointsToAdd` (≥ 0) to one language's wallet, creating the row if absent.
   * Returns the resulting balance. The study-tick +1 path.
   */
  incrementPoints(userId: string, language: string, pointsToAdd: number): Promise<number>;

  /**
   * Signed adjust of one language's wallet, floored at 0; returns the new balance.
   * The general form of {@link incrementPoints} that also allows debits without
   * underflowing (author minute-adjust tool; mirrors the cron's GREATEST(0, …)).
   */
  adjustPoints(userId: string, language: string, delta: number): Promise<number>;

  /**
   * Set one language's `currentStreak` and stamp its `lastStreakDate`.
   * Called only when the increment path crosses the threshold for that language.
   */
  setStreak(userId: string, language: string, currentStreak: number, lastStreakDate: string): Promise<void>;

  /**
   * Σ wallets and MAX streak for EVERY user, for the global leaderboard.
   * One grouped query — never call {@link getAllProgress} in a per-user loop.
   */
  getTotalsForAllUsers(): Promise<Map<string, UserPointsTotals>>;
}
