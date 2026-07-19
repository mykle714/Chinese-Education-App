/**
 * unlockSchedule — the pure minutes→unlocks entitlement curve (docs/NIGHT_MARKET_TEMPLATES.md
 * § "Unlock economy"). A user's total unlock count (placeholder OCCUPANTS they are entitled to)
 * is a pure function of their lifetime `users.totalMinutePoints`. Earning minutes grants
 * occupants; the hourly decay cron trims occupants back down when minutes are debited.
 *
 * LAYER: dep-free shared constant (same `server/dal/shared/*` family as the other mirrors). No
 * DB, no imports. SOURCE OF TRUTH for the schedule; two consumers must stay in sync:
 *   • the grant flow — NightMarketPlacementService.grantUnlocks (imports this directly);
 *   • the decay cron — database/cron/expire-stale-streaks.sql hard-codes the same breakpoints
 *     (SQL can't import TS), guarded by the note there.
 * If you change a breakpoint here, change it in the cron SQL too. (No client mirror exists yet —
 * nothing on the client computes unlocks; add one only when a UI needs the curve.)
 */

/**
 * Explicit low-end breakpoints, `[minMinutes, unlocks]`, ascending by minute threshold. A user
 * with `totalMinutePoints ≥ minMinutes` (and below the next breakpoint) is entitled to `unlocks`.
 * Above 60 the curve is the steady-state formula in {@link unlocksForMinutes}, so the table stops
 * at 60. Mirror of the § Unlock economy schedule table.
 */
export const UNLOCK_BREAKPOINTS: ReadonlyArray<readonly [minMinutes: number, unlocks: number]> = [
  [0, 0], // hub only
  [1, 1],
  [2, 2],
  [3, 3], // early unlocks are 1 minute apart
  [5, 4],
  [7, 5],
  [10, 6],
  [14, 7],
  [18, 8],
  [22, 9], // mid unlocks are 4 minutes apart
  [26, 10],
  [30, 11],
  [34, 12],
  [38, 13],
  [42, 14],
  [47, 15], // 5 minutes apart
  [52, 16],
  [60, 17],
];

/** First minute threshold covered by the steady-state formula (the last explicit breakpoint). */
const STEADY_STATE_MINUTES = 60;
/** Unlock count at {@link STEADY_STATE_MINUTES}; the formula counts up from here. */
const STEADY_STATE_UNLOCKS = 17;
/** Steady state: one extra unlock per this many minutes beyond {@link STEADY_STATE_MINUTES}. */
const MINUTES_PER_STEADY_UNLOCK = 60;

/**
 * The number of unlocks (placeholder occupants) a user with `minutePoints` lifetime minutes is
 * entitled to. Below 60 minutes it reads the explicit {@link UNLOCK_BREAKPOINTS} table; at/above
 * 60 it is `17 + floor((m − 60) / 60)` (steady state: +1 unlock per hour). Negative/NaN → 0.
 */
export function unlocksForMinutes(minutePoints: number): number {
  if (!Number.isFinite(minutePoints) || minutePoints <= 0) return 0;
  const m = Math.floor(minutePoints);

  if (m >= STEADY_STATE_MINUTES) {
    return STEADY_STATE_UNLOCKS + Math.floor((m - STEADY_STATE_MINUTES) / MINUTES_PER_STEADY_UNLOCK);
  }

  // Below steady state: highest breakpoint whose threshold ≤ m (table is ascending).
  let unlocks = 0;
  for (const [minMinutes, count] of UNLOCK_BREAKPOINTS) {
    if (m >= minMinutes) unlocks = count;
    else break;
  }
  return unlocks;
}
