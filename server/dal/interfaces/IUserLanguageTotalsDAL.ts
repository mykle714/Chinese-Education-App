import { UserLanguageTotals } from '../../types/minutePoints.js';

/**
 * Per-(user, language) minute-points counters and streak state
 * (`user_language_minute_totals`, migration 134).
 *
 * Replaces the global counters that used to live on `users`. Every method here is
 * language-scoped; nothing in this interface returns a cross-language figure except
 * {@link findAllForUser}, which hands back the rows so a caller can aggregate them
 * itself (bounded by language count, never by account age).
 *
 * WHICH METHOD MOVES WHICH COUNTER — the split is deliberate and load-bearing:
 *   creditEarnedMinutes  → net ↑ AND gross ↑ (the only method that raises gross)
 *   adjustNetMinutes     → net only, floored at 0 (penalties; gross is monotonic)
 * Do not add a gross write to the adjust path. See docs/MINUTE_POINTS_SYSTEM.md.
 */
export interface IUserLanguageTotalsDAL {
  /** One language's row, or null when the user has never earned in that language. */
  find(userId: string, language: string): Promise<UserLanguageTotals | null>;

  /**
   * Every language row the user has. Used where a genuinely global figure is still
   * needed (e.g. the test-only leaderboard); callers sum in application code rather
   * than issuing a SUM, because the row count is bounded by supported languages.
   */
  findAllForUser(userId: string): Promise<UserLanguageTotals[]>;

  /**
   * EARN: credit `minutes` to BOTH counters for one language, inserting the row when
   * this is the user's first minute in it. Both columns move in a SINGLE statement so
   * they cannot drift. Rejects negative input — a debit must go through
   * {@link adjustNetMinutes}. Returns the resulting row.
   */
  creditEarnedMinutes(userId: string, language: string, minutes: number): Promise<UserLanguageTotals>;

  /**
   * Signed adjust of ONE language's NET balance, floored at 0. Never touches gross.
   * Used by the author minute-adjust tool's loss path; the hourly penalty cron does
   * the equivalent in SQL. Returns the resulting net.
   */
  adjustNetMinutes(userId: string, language: string, delta: number): Promise<number>;

  /**
   * Set one language's streak counter and the date it was last satisfied. Called only
   * when that language's own day total crosses RETENTION_MINUTES.
   */
  setStreak(userId: string, language: string, streak: number, streakDate: string): Promise<void>;
}
