/**
 * Study Challenge week boundaries — ISOMORPHIC.
 *
 * Single source of truth for the challenge timeline (docs/STUDY_CHALLENGE.md § 2).
 * Standard library only (via shared/zonedTime.ts) so the browser bundle can compile
 * it — the client renders every deadline itself. (There is no client re-export today:
 * the server serializes each deadline as an absolute instant in `ChallengeSummary`,
 * and the pages format those. The isomorphic contract is kept because the countdowns
 * in § 5 will need it, and because one Node import here breaks that option silently.)
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
 * Every function here takes the challenge's WEEK INDEX plus the CURRENT
 * `users.timezone`. Nothing about a player's zone is snapshotted onto the
 * challenge row, so a player who travels or fixes a wrong timezone setting
 * immediately sees correct deadlines and no backfill or repair job is ever needed.
 *
 * The ONE exception is `study_challenges."weekIndex"`, which IS stored — but that
 * is the challenge's identity (which week it belongs to), not a deadline, and an
 * identity must not move under a unique index. See migration 150.
 *
 * ── THE WEEK IS A COUNTER, AND THE COUNTER IS UTC (2026-08-17) ────────────────
 * A challenge's week is an INTEGER: whole weeks since Monday 2026-01-05 00:00 UTC.
 * It replaced a stored `weekStart` timestamptz computed in the CHALLENGER's zone,
 * which was a real defect — the same calendar week produced a DIFFERENT instant per
 * zone (measured: `Asia/Shanghai` → 2026-08-16T20:00Z, `America/New_York` →
 * 2026-08-17T08:00Z), so `study_challenges_pair_week_uniq` never fired for a pair
 * in two zones and BOTH crossing challenges were created — one pair, one week, two
 * live challenges, two decks, two cap slots.
 *
 * A UTC-anchored counter FORCES the collision: every instant on earth maps to
 * exactly one index, so whoever inserts second always hits the unique index and
 * gets a 409. The accepted cost is that the ISSUE window now rolls at Monday 00:00
 * UTC rather than each player's local Monday 04:00 — up to 4h late in Shanghai,
 * 11h early in Los Angeles. The DEADLINES are unaffected and stay per-player local
 * (see below): only the question "which week is this" became global, which is the
 * only way two players can agree on the answer.
 *
 * Consequences accepted rather than engineered away: a window can move under a
 * player's feet. Travelling east shortens it; travelling far enough west can make
 * an open window retroactively closed, so the player is told the test is over
 * without having played. Rare, and the outcome is `no_contest`, never a loss.
 */

import {
  MONDAY,
  MS_PER_DAY,
  localDateKey,
  resolveTimezone,
  zonedWallClockToUtc,
} from './zonedTime.js';

/** Re-exported so callers need only this module for a timezone-safe boundary. */
export { resolveTimezone };

/**
 * The week runs Monday → Monday. Kept as a named constant because the epoch below
 * MUST be a Monday for the counter's weeks to line up with the app's week — this is
 * the fact that makes 2026-01-05 the right anchor rather than an arbitrary date.
 * (Nothing computes with it any more: the day-of-week search it used to drive went
 * away with the per-timezone `challengeWeekStart`.)
 */
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
 * The epoch the week counter counts from: **Monday 2026-01-05 00:00:00 UTC**.
 *
 * ⚠️ THIS CONSTANT IS DUPLICATED IN SQL — `database/cron/expire-study-challenges.sql`
 * and migration 150 both spell it `DATE '2026-01-05'`. Changing it here without
 * changing them renumbers every stored week and silently moves every deadline.
 */
export const CHALLENGE_WEEK_EPOCH_UTC = Date.UTC(2026, 0, 5);

const MS_PER_WEEK = 7 * MS_PER_DAY;

/**
 * Which challenge week an instant falls in — whole weeks since the epoch Monday,
 * in UTC.
 *
 * NO TIMEZONE PARAMETER, on purpose: this is the challenge's IDENTITY, and an
 * identity that varies by who is asking cannot be a unique index (see the module
 * header). Negative indices are well-defined for instants before the epoch;
 * `Math.floor` keeps the week boundaries evenly spaced on both sides of it.
 */
export function challengeWeekIndex(instant: Date): number {
  return Math.floor((instant.getTime() - CHALLENGE_WEEK_EPOCH_UTC) / MS_PER_WEEK);
}

/**
 * The UTC instant of `hour:00` local in `tz`, `dayOffset` days after the Monday
 * that `weekIndex` names — the one place a week index becomes a wall-clock
 * boundary.
 *
 * The day arithmetic is done in pure UTC before the zone is applied, which is exact:
 * UTC has no DST, so adding whole days to the epoch cannot slip a day. (Compare
 * `localHourOnOffsetDay`, which needs a noon proxy precisely because it steps days
 * through a zone that might shift under it.)
 */
function weekBoundary(weekIndex: number, tz: string, dayOffset: number): Date {
  const day = new Date(CHALLENGE_WEEK_EPOCH_UTC + (weekIndex * 7 + dayOffset) * MS_PER_DAY);
  return zonedWallClockToUtc(
    day.getUTCFullYear(),
    day.getUTCMonth() + 1,
    day.getUTCDate(),
    CHALLENGE_BOUNDARY_HOUR,
    tz,
  );
}

/**
 * When the challengee's chance to accept ends — Wednesday 04:00 in the
 * CHALLENGEE's zone (Q1).
 *
 * ⚠️ Pass the CHALLENGEE's timezone. Passing the challenger's is the single
 * easiest mistake to make here and it silently shortens or lengthens the other
 * player's window by the zone difference.
 */
export function acceptDeadline(weekIndex: number, challengeeTz: string): Date {
  return weekBoundary(weekIndex, challengeeTz, ACCEPT_DEADLINE_DAY_OFFSET);
}

/** When a player's test window opens — Friday 04:00 in THAT player's zone. */
export function testWindowOpen(weekIndex: number, playerTz: string): Date {
  return weekBoundary(weekIndex, playerTz, TEST_OPEN_DAY_OFFSET);
}

/**
 * When a player's test window closes — the following Monday 04:00 in THAT
 * player's zone, i.e. the instant the next issue window opens (Q2).
 */
export function testWindowClose(weekIndex: number, playerTz: string): Date {
  return weekBoundary(weekIndex, playerTz, TEST_CLOSE_DAY_OFFSET);
}

/**
 * The LATER of the two players' window closes — when the challenge may be
 * resolved (§ 2, § 9 maintenance pass 2).
 *
 * Resolving on the later close is what stops a player in an eastern zone from
 * timing their opponent out. It is the maintenance job's guard, so getting it
 * wrong would silently mark a still-playable challenge `no_contest`.
 */
export function latestTestWindowClose(weekIndex: number, tzA: string, tzB: string): Date {
  const a = testWindowClose(weekIndex, tzA);
  const b = testWindowClose(weekIndex, tzB);
  return a.getTime() >= b.getTime() ? a : b;
}

/** Is a challengee still able to accept, on their own clock? */
export function isAcceptWindowOpen(weekIndex: number, challengeeTz: string, now: Date): boolean {
  return now.getTime() < acceptDeadline(weekIndex, challengeeTz).getTime();
}

/**
 * Is this player's test window open right now, on their own clock?
 *
 * This is the gate that decides whether `gameSequence` may be serialized to them
 * (Q63) as well as whether a round may be submitted, so it has to be one
 * function — two copies of "is the window open" would eventually disagree and the
 * disagreement would leak the hidden field.
 */
export function isTestWindowOpen(weekIndex: number, playerTz: string, now: Date): boolean {
  const t = now.getTime();
  return t >= testWindowOpen(weekIndex, playerTz).getTime()
      && t < testWindowClose(weekIndex, playerTz).getTime();
}

/**
 * The week's Monday as a YYYY-MM-DD label, in UTC — for display and logging.
 *
 * The stored identity is the INDEX, not this label; the label is derived from it
 * and, being UTC, is the same string for both players (the old local-date version
 * could disagree across a pair, which was the bug the counter fixed).
 */
export function challengeWeekKey(weekIndex: number): string {
  return localDateKey(new Date(CHALLENGE_WEEK_EPOCH_UTC + weekIndex * MS_PER_WEEK), 'UTC');
}
