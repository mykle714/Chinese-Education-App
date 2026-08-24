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
 *   Mon 04:00  ISSUE OPENS    each player's OWN clock — challenger picks friend
 *                             + variant + word set
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
 * gets a 409. The counter is the challenge's NAME; only the question "which week is
 * this" is global, which is the only way two players can agree on the answer.
 *
 * ── ...BUT THE WEEK OPENS ON THE PLAYER'S OWN CLOCK (2026-08-23) ──────────────
 * Naming the week in UTC is not the same as STARTING it in UTC, and for a while
 * this file did both. `challengeWeekIndex` answers "which week is this instant in,
 * in UTC"; `localChallengeWeekIndex` answers "which week is this PLAYER in, on the
 * clock every other boundary in the app uses" — Monday 04:00 local, like the streak
 * cron and the AI usage counter. Issuing uses the latter, so a new week opens for a
 * player at 4 AM their Monday, which is what the timeline above promises and what
 * the UI copy ("Next challenge on Monday") says.
 *
 * Stamping the issue from UTC instead was not merely 'early' or 'late' — it was a
 * BUG east of UTC. Shanghai's Monday 04:00 arrives at Sun 20:00 UTC, four hours
 * before the counter rolls, so a challenge issued in that gap was stamped with the
 * OUTGOING week and born already past its Wednesday accept deadline: dead on
 * arrival, and occupying the pair's previous week. West of UTC the error ran the
 * other way and was harmless (Los Angeles could issue next week's challenge up to
 * 11 hours early).
 *
 * ⚠️ THE TWO PLAYERS' WEEKS ROLL AT DIFFERENT INSTANTS, and between them a pair
 * disagrees about which week it is — the same disagreement that let a crossing pair
 * create two live challenges before migration 150. What contains it now is not the
 * unique index (two different indices never collide) but the LIVE-PAIR GUARD in
 * `StudyChallengeService.issueChallenge`: a pair may hold at most one unfinished
 * challenge at a time, whatever week it is named after. See docs/STUDY_CHALLENGE.md
 * § 2 "When a week opens".
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
const WEEK_OPEN_DAY_OFFSET = 0;      // Monday 04:00 — the week opens
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
 * When a week OPENS for a player — Monday 04:00 in THAT player's zone, the instant
 * they may issue that week's challenges and the instant the previous week's test
 * window closes (they are the same boundary, one week apart).
 */
export function weekOpen(weekIndex: number, playerTz: string): Date {
  return weekBoundary(weekIndex, playerTz, WEEK_OPEN_DAY_OFFSET);
}

/**
 * Which challenge week THIS PLAYER is in right now — the week whose local Monday
 * 04:00 has most recently passed for them.
 *
 * This is the counterpart to `challengeWeekIndex`, and choosing between them is the
 * whole distinction the module header draws:
 *   * `challengeWeekIndex(now)` — which week an INSTANT is in, in UTC. The
 *     challenge's identity. No timezone, because an identity that varies by who is
 *     asking cannot be a unique index.
 *   * `localChallengeWeekIndex(tz, now)` — which week a PLAYER is in. Used
 *     everywhere a user's own "this week" is meant: what a new challenge is stamped
 *     with, and whether this pair has already had their turn.
 *
 * The two answers differ for up to 16 hours around the roll (a zone runs from
 * UTC−12 to UTC+14, and the boundary sits at 04:00 rather than midnight), which is
 * why the search below has to look at the neighbouring weeks and cannot simply
 * offset the arithmetic.
 *
 * Implemented as a short descending scan rather than closed-form arithmetic because
 * the local boundary is a WALL CLOCK: `weekBoundary` resolves 04:00 through the
 * zone, so a DST shift moves it by an hour and no fixed offset from the UTC counter
 * is correct in every week. Scanning asks the boundary itself, which is always
 * right. Three candidates is provably enough — the local Monday 04:00 of week k can
 * sit at most 16h after and 10h before the UTC instant that starts week k, so the
 * answer is never further than one week from `challengeWeekIndex`.
 */
export function localChallengeWeekIndex(playerTz: string, now: Date): number {
  const t = now.getTime();
  const utcWeek = challengeWeekIndex(now);
  for (const candidate of [utcWeek + 1, utcWeek, utcWeek - 1]) {
    if (weekOpen(candidate, playerTz).getTime() <= t) return candidate;
  }
  // Unreachable for any real zone; returning the UTC answer keeps the function
  // total rather than letting an exotic offset produce `undefined` downstream.
  return utcWeek;
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
