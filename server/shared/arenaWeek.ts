/**
 * Arena week boundaries — ISOMORPHIC.
 *
 * Single source of truth for the arena cycle, imported by BOTH the Node server
 * and the browser client (mirrored at src/utils/arenaWeek.ts, exactly as
 * server/shared/streakDay.ts is). Keep it free of Node- and browser-only
 * imports — standard library only (Date, Intl) — or one of the two bundles
 * breaks.
 *
 * Why it is shared rather than server-only: the client renders a live countdown
 * to the close instant. If the client computed that boundary independently it
 * would eventually disagree with the server by an hour across a DST shift, and
 * the visible symptom would be a countdown that hits zero while the arena is
 * still accepting minutes.
 *
 * ── The cycle (docs/ARENA_FEATURE.md § 3) ────────────────────────────────────
 *
 *   Tue 03:00  SNAPSHOT   candidate set frozen; sort-and-chunk runs
 *   Tue 04:00  LIVE       minutes begin counting
 *   Sun 16:00  CLOSE      ranks frozen, promotions/demotions applied
 *   Sun 16:00 -> Tue 04:00   BREAK (36h): results are readable, opt-in is open
 *
 * ── Why Sunday 16:00 and not 04:00 ───────────────────────────────────────────
 * This is the ONLY boundary in the app that is not the 4 AM streak-day
 * convention, and it is deliberate (§ 3). An arena that ended at 04:00 Monday
 * would resolve while essentially everyone was asleep, so the result — the
 * entire point of the week — would be discovered hours later, detached from the
 * effort. 16:00 Sunday lands while people are awake and turns the last hours
 * into a watchable finish. The cost is one exception to a rule that is
 * otherwise absolute, which is why it is written down in three places.
 */

import {
  MS_PER_MINUTE,
  SUNDAY,
  TUESDAY,
  localDateKey,
  localHourOnOffsetDay,
  partsInZone,
  resolveTimezone,
} from './zonedTime.js';

/**
 * Re-exported for the callers that imported it from here before the zoned-time
 * helpers were extracted (see shared/zonedTime.ts for why they moved).
 */
export { resolveTimezone };

/** The arena week opens Tuesday at this local hour. */
export const ARENA_WEEK_START_DOW = TUESDAY;
export const ARENA_WEEK_START_HOUR = 4;

/** The arena closes Sunday at this local hour — NOT the app's 04:00 convention. */
export const ARENA_CLOSE_DOW = SUNDAY;
export const ARENA_CLOSE_HOUR = 16;

/**
 * How long before the week opens the formation run takes its snapshot.
 *
 * This is a BUDGET, not a measurement (§ 5.3). The sort-and-chunk is fast enough
 * to run at 03:55; the margin exists so a slow run or a retry cannot miss the
 * 04:00 boundary, because arenas MUST exist by then — 04:00 is when credited
 * minutes start looking for a membership to land on.
 */
export const ARENA_FORMATION_LEAD_MINUTES = 60;

/**
 * The UTC instant at which the arena week CONTAINING `instant` opened
 * (Tuesday 04:00 local).
 *
 * "Containing" spans the break: at Sunday 20:00 the current week is the one that
 * opened the previous Tuesday and has already closed. Callers that need "is it
 * the break right now" ask isBreakPeriod, they do not compare against this.
 */
export function arenaWeekStart(instant: Date, tz: string): Date {
  const p = partsInZone(instant, tz);

  // Days since the most recent Tuesday, in local terms.
  let daysBack = (p.dow - ARENA_WEEK_START_DOW + 7) % 7;
  // On Tuesday before 04:00 we still belong to the PREVIOUS week.
  if (daysBack === 0 && p.hour < ARENA_WEEK_START_HOUR) daysBack = 7;

  return localHourOnOffsetDay(instant, tz, -daysBack, ARENA_WEEK_START_HOUR);
}

/**
 * The UTC instant at which the arena opened by `weekStart` closes —
 * Sunday 16:00 local, five days later.
 *
 * Derived from the week start rather than from "now" so a stored arena's close
 * can always be recomputed from its own anchor and checked against the stored
 * `closesAt`.
 */
export function arenaCloseFor(weekStart: Date, tz: string): Date {
  // Tuesday -> Sunday is +5 days.
  return localHourOnOffsetDay(weekStart, tz, 5, ARENA_CLOSE_HOUR);
}

/** The instant the formation snapshot runs for the week opening at `weekStart`. */
export function arenaFormationAt(weekStart: Date): Date {
  return new Date(weekStart.getTime() - ARENA_FORMATION_LEAD_MINUTES * MS_PER_MINUTE);
}

/**
 * Is `instant` inside the break — after this week's close, before the next open?
 *
 * The break is the 36-hour window in which results are readable and opt-in for
 * the next week is accepted. Opting in is REJECTED outside it (§ 8), which is
 * what keeps membership frozen once an arena is live.
 */
export function isBreakPeriod(instant: Date, tz: string): boolean {
  const start = arenaWeekStart(instant, tz);
  const close = arenaCloseFor(start, tz);
  return instant.getTime() >= close.getTime();
}

/**
 * The Tuesday date label (YYYY-MM-DD, local) identifying an arena week.
 *
 * This is what `user_languages."arenaOptInWeek"` stores. A date rather than a
 * timestamp because it is an IDENTITY, not an instant: it answers "which week
 * did you opt into", and a stale value is simply not this week — which is what
 * makes the opt-in self-expiring with no cleanup job.
 */
export function arenaWeekKey(weekStart: Date, tz: string): string {
  return localDateKey(weekStart, tz);
}

/**
 * The week key of the NEXT arena week — the one an opt-in during the break
 * enrolls the user into.
 */
export function nextArenaWeekKey(instant: Date, tz: string): string {
  const start = arenaWeekStart(instant, tz);
  return arenaWeekKey(localHourOnOffsetDay(start, tz, 7, ARENA_WEEK_START_HOUR), tz);
}
