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
  /**
   * GROSS lifetime minutes earned in this language (migration 134). Monotonic — the earn
   * path raises it and nothing lowers it, so it is the "total earned" figure beside the
   * decaying wallet. A maintained counter, not a SUM over the day ledger: that SUM was the
   * only aggregate here whose cost grew with account age.
   *
   * gross ≥ net holds for every write path, but NOT for migration 130's backfill of a
   * multi-language account — see the invariant note in migration 134.
   */
  lifetimeMinutesEarned: number;
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
   * Returns the resulting NET balance. The study-tick +1 path.
   *
   * THE EARN PATH: raises BOTH `totalMinutePoints` and `lifetimeMinutesEarned`, in one
   * statement so the pair cannot drift. This is why it rejects a negative input — a debit
   * must never touch gross.
   */
  incrementPoints(userId: string, language: string, pointsToAdd: number): Promise<number>;

  /**
   * Signed adjust of one language's NET wallet, floored at 0; returns the new balance.
   * The general form of {@link incrementPoints} that also allows debits without
   * underflowing (author minute-adjust tool; mirrors the cron's GREATEST(0, …)).
   *
   * Deliberately does NOT touch `lifetimeMinutesEarned` — gross is monotonic. Callers with
   * a positive delta that should count as EARNED must use {@link incrementPoints} instead,
   * or they will push net above gross.
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

  /**
   * NET wallets for a set of users, kept split by language:
   * `userId → (language → totalMinutePoints)`.
   *
   * Unlike {@link getTotalsForAllUsers} this does NOT sum across languages — the
   * friends leaderboard reports each person's balance in the one language they are
   * studying, so collapsing the languages here would over-report a multi-language
   * account. Absent (user, language) pairs mean "never studied" — read them as 0.
   */
  getNetPointsForUsers(userIds: string[]): Promise<Map<string, Map<string, number>>>;
}
