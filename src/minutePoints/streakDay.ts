/**
 * Client-side streak-day helpers.
 *
 * Re-uses the EXACT same 4 AM-bounded streak-day logic the server uses
 * (server/shared/streakDay.ts) so the client and server never disagree about
 * which day a timestamp belongs to. This is the only place in the client that
 * reaches across into the shared server module; everything else imports from here.
 */
import { streakDateOf, resolveTimezone } from '../../server/shared/streakDay';
import { getBrowserTimezone } from './minutePointsSync';

/**
 * The streak-day label (YYYY-MM-DD, 4 AM-bounded) for a given instant, using the
 * browser's local timezone.
 */
export function streakDayLabel(when: Date | string): string {
  return streakDateOf(when, resolveTimezone(getBrowserTimezone()));
}

/**
 * Whether two instants fall on the same 4 AM-bounded streak day in the browser's
 * local timezone. Use this — NOT Date.toDateString() (which rolls at midnight) —
 * anywhere "is this from today?" must match the server's minute-points day.
 */
export function isSameStreakDay(a: Date | string, b: Date | string): boolean {
  return streakDayLabel(a) === streakDayLabel(b);
}
