import { Win, WinAggregate } from '../../types/wins.js';

/**
 * Data-access contract for the `wins` event log (one row per game win).
 * Generic by design: `game` and `level` are opaque client-chosen keys, so new
 * games need no new methods.
 *
 * "Weekly" everywhere below means: since the user's most-recent-Sunday-04:00 in
 * their local timezone — the same boundary the inactivity cron uses. It is a
 * query-time filter over this persistent log (the old weeklies table that a cron
 * wiped weekly is gone).
 */
export interface IWinsDAL {
  /** Append one win event for a user. Returns the created row. */
  recordWin(userId: string, game: string, level: string): Promise<Win>;

  /**
   * The distinct (game, level) pairs a user has won since their current week
   * boundary. Drives the per-level "earned this week" badges.
   */
  getWeeklyWins(userId: string): Promise<Array<{ game: string; level: string }>>;

  /**
   * A user's lifetime win counts grouped by (game, level), each with its last
   * win timestamp. Empty when the user has never won.
   */
  getLifetimeCounts(userId: string): Promise<WinAggregate[]>;

  /**
   * Count each user's DISTINCT (game, level) wins earned this week, in one
   * grouped query keyed by userId. Users with zero are absent (callers default
   * to 0). Used by the leaderboard to show this week's achievement count without
   * an N+1 per-user lookup.
   */
  getWeeklyCountsByUser(): Promise<Map<string, number>>;
}
