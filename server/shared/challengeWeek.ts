/**
 * Study Challenge week boundaries — ISOMORPHIC.
 *
 * Single source of truth for the challenge timeline (docs/STUDY_CHALLENGE.md § 2),
 * imported by both the Node server and the browser client (re-exported at
 * src/features/studyChallenge/challengeWeek.ts). Standard library only, via
 * shared/zonedTime.ts.
 *
 * Why shared rather than server-only: the client renders every deadline as a
 * countdown and as copy ("until 4 AM Wednesday"). A client that derived those
 * boundaries with its own logic would eventually disagree with the server by an
 * hour across a DST shift, and the visible symptom would be an Accept button that
 * is still offered after the server has started refusing it.
 *
 * ── The timeline ──────────────────────────────────────────────────────────────
 *
 *   Mon 04:00  ISSUE OPENS    challenger picks friend + variant + word set
 *   Wed 04:00  ACCEPT DEADLINE  the CHALLENGEE's clock — end of their Tuesday
 *   Fri 04:00  TEST OPENS     each player's OWN clock
 *   Mon 04:00  TEST CLOSES    each player's own clock — the instant the next
 *                             issue window opens
 *
 * ── Every boundary is 04:00 local, never midnight ─────────────────────────────
 * The same boundary the streak cron, the AI usage counter (migration 100) and the
 * community vote week (migration 86) use. "Monday" therefore means Monday 04:00 →
 * Tuesday 04:00 in that user's zone. UI copy must say "4 AM Wednesday", never
 * "midnight", or it is four hours wrong.
 *
 * ── WHOSE CLOCK, AND WHY IT MATTERS ───────────────────────────────────────────
 * The two players can be in different zones, so their windows do NOT coincide:
 *  * the accept deadline is the CHALLENGEE's, so they always get their own Tuesday;
 *  * each player's test window is their own, so one may start hours before the
 *    other (harmless in async mode);
 *  * expiry fires on the LATER of the two window closes, so nobody is timed out by
 *    someone else's clock — see `latestTestWindowClose`.
 *
 * ── Boundaries are RECOMPUTED, never stored (Q50) ─────────────────────────────
 * Every function here takes the challenge's `issuedAt` anchor plus the CURRENT
 * `users.timezone`. Nothing about a player's zone is snapshotted onto the
 * challenge row, so a player who travels or fixes a wrong timezone setting
 * immediately sees correct deadlines and no backfill or repair job is ever needed.
 *
 * The ONE exception is `study_challenges."weekStart"`, which IS stored — but that
 * is the challenge's identity (which week it belongs to), not a deadline, and an
 * identity must not move under a unique index. See migration 148.
 *
 * Consequences accepted rather than engineered away: a window can move under a
 * player's feet. Travelling east shortens it; travelling far enough west can make
 * an open window retroactively closed, so the player is told the test is over
 * without having played. Rare, and the outcome is `no_contest`, never a loss.
 */

import {
  MONDAY,
  localHourOnOffsetDay,
  partsInZone,
  localDateKey,
  resolveTimezone,
} from './zonedTime.js';

/** Re-exported so callers need only this module for a timezone-safe boundary. */
export { resolveTimezone };

/** The challenge week opens Monday at this local hour. */
export const CHALLENGE_WEEK_START_DOW = MONDAY;

/**
 * Every challenge boundary sits at this local hour — the app-wide 4 AM day
 * boundary (Q1). Unlike Arena, Study Challenge has no exception to it.
 */
export const CHALLENGE_BOUNDARY_HOUR = 4;

/** Days from the week's Monday to each boundary. */
const ACCEPT_DEADLINE_DAY_OFFSET = 2; // Wednesday 04:00 — the end of the challengee's Tuesday
const TEST_OPEN_DAY_OFFSET = 4;       // Friday 04:00
const TEST_CLOSE_DAY_OFFSET = 7;      // the following Monday 04:00

/**
 * The UTC instant at which the challenge week CONTAINING `instant` opened —
 * Monday 04:00 local in `tz`.
 *
 * This is what the service stores as `weekStart`, computed in the CHALLENGER's
 * zone, and what makes "one challenge per pair per week" a unique index rather
 * than a service-layer check (migration 148).
 */
export function challengeWeekStart(instant: Date, tz: string): Date {
  const p = partsInZone(instant, tz);

  // Days back to the most recent Monday, in local terms.
  let daysBack = (p.dow - CHALLENGE_WEEK_START_DOW + 7) % 7;
  // On Monday before 04:00 we still belong to the PREVIOUS week.
  if (daysBack === 0 && p.hour < CHALLENGE_BOUNDARY_HOUR) daysBack = 7;

  return localHourOnOffsetDay(instant, tz, -daysBack, CHALLENGE_BOUNDARY_HOUR);
}

/**
 * When the challengee's chance to accept ends — Wednesday 04:00 in the
 * CHALLENGEE's zone (Q1).
 *
 * ⚠️ Pass the CHALLENGEE's timezone. Passing the challenger's is the single
 * easiest mistake to make here and it silently shortens or lengthens the other
 * player's window by the zone difference.
 */
export function acceptDeadline(weekStart: Date, challengeeTz: string): Date {
  return localHourOnOffsetDay(weekStart, challengeeTz, ACCEPT_DEADLINE_DAY_OFFSET, CHALLENGE_BOUNDARY_HOUR);
}

/** When a player's test window opens — Friday 04:00 in THAT player's zone. */
export function testWindowOpen(weekStart: Date, playerTz: string): Date {
  return localHourOnOffsetDay(weekStart, playerTz, TEST_OPEN_DAY_OFFSET, CHALLENGE_BOUNDARY_HOUR);
}

/**
 * When a player's test window closes — the following Monday 04:00 in THAT
 * player's zone, i.e. the instant the next issue window opens (Q2).
 */
export function testWindowClose(weekStart: Date, playerTz: string): Date {
  return localHourOnOffsetDay(weekStart, playerTz, TEST_CLOSE_DAY_OFFSET, CHALLENGE_BOUNDARY_HOUR);
}

/**
 * The LATER of the two players' window closes — when the challenge may be
 * resolved (§ 2, § 9 maintenance pass 2).
 *
 * Resolving on the later close is what stops a player in an eastern zone from
 * timing their opponent out. It is the maintenance job's guard, so getting it
 * wrong would silently mark a still-playable challenge `no_contest`.
 */
export function latestTestWindowClose(weekStart: Date, tzA: string, tzB: string): Date {
  const a = testWindowClose(weekStart, tzA);
  const b = testWindowClose(weekStart, tzB);
  return a.getTime() >= b.getTime() ? a : b;
}

/** Is a challengee still able to accept, on their own clock? */
export function isAcceptWindowOpen(weekStart: Date, challengeeTz: string, now: Date): boolean {
  return now.getTime() < acceptDeadline(weekStart, challengeeTz).getTime();
}

/**
 * Is this player's test window open right now, on their own clock?
 *
 * This is the gate that decides whether `gameSequence` may be serialized to them
 * (Q63) as well as whether a round may be submitted, so it has to be one
 * function — two copies of "is the window open" would eventually disagree and the
 * disagreement would leak the hidden field.
 */
export function isTestWindowOpen(weekStart: Date, playerTz: string, now: Date): boolean {
  const t = now.getTime();
  return t >= testWindowOpen(weekStart, playerTz).getTime()
      && t < testWindowClose(weekStart, playerTz).getTime();
}

/**
 * The Monday date label (YYYY-MM-DD, local) identifying a challenge week.
 *
 * For display and logging only. The stored identity is the `weekStart` INSTANT,
 * because that is what the unique index keys on; a label cannot serve that role
 * across two players in different zones.
 */
export function challengeWeekKey(weekStart: Date, tz: string): string {
  return localDateKey(weekStart, tz);
}
