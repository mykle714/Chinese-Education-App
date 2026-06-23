/**
 * Game-win types.
 * Shared shapes used by the wins DAL and controller.
 *
 * The `wins` table is an append-only event log (one row per win). All "tallies"
 * are derived: lifetime = COUNT, lastWin = MAX("wonAt"), weekly badge = a row
 * since the user's Sunday-04:00-local week boundary.
 */

/** A row from the wins table: one win event by one user. */
export interface Win {
  id: string;
  userId: string;
  /** Opaque game key, e.g. 'bubbleMatch'. */
  game: string;
  /** Opaque level key within the game, e.g. '1'. */
  level: string;
  wonAt: Date;
}

/** Lifetime aggregate for one (game, level) the user has won. */
export interface WinAggregate {
  game: string;
  level: string;
  /** Lifetime number of wins (COUNT of rows). */
  winCount: number;
  /** Most recent win timestamp (MAX of "wonAt"). */
  lastWin: Date;
}

/**
 * Response for GET /api/users/me/wins.
 * - `weekly`: the distinct (game, level) pairs won since the user's current
 *   week boundary — drives the "earned this week" ⭐ badges (replaces weeklies).
 * - `lifetime`: nested lifetime win counts, { game: { level: count } }.
 */
export interface WinsResponse {
  weekly: Array<{ game: string; level: string }>;
  lifetime: Record<string, Record<string, number>>;
}
