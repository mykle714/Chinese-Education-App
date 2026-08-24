import { describe, it, expect } from 'vitest';
import {
  CHALLENGE_WEEK_EPOCH_UTC,
  CHALLENGE_BOUNDARY_HOUR,
  acceptDeadline,
  challengeWeekIndex,
  challengeWeekKey,
  isAcceptWindowOpen,
  isTestWindowOpen,
  latestTestWindowClose,
  localChallengeWeekIndex,
  testWindowClose,
  weekOpen,
  testWindowOpen,
} from '../shared/challengeWeek.js';

/**
 * Boundary maths for the study challenge week (docs/STUDY_CHALLENGE.md § 2).
 *
 * These tests exist because every failure here is SILENT: nothing crashes, a
 * challenge simply lands in the wrong week or a deadline moves by hours. Two
 * properties in particular are load-bearing and are pinned below:
 *
 *   1. THE INDEX IS GLOBAL. One instant → one index, in every timezone. This is
 *      what makes `study_challenges_pair_week_uniq` fire for a crossing pair; the
 *      per-timezone `weekStart` it replaced did not (migration 150).
 *   2. THE DEADLINES ARE LOCAL. Derived from the index's Monday plus each player's
 *      own zone — 04:00 local, never midnight, never the other player's clock.
 *
 * The SQL in database/cron/expire-study-challenges.sql computes (2) independently,
 * as `DATE '2026-01-05' + 7 * "weekIndex" + N` at 04:00 in the player's zone. The
 * expectations below were cross-checked against that query for all five zones on
 * 2026-08-17; if this file and that file ever disagree, a player sees a deadline the
 * maintenance job has already acted on.
 */

/** Read an instant back as local wall-clock parts, for assertions. */
function localOf(instant: Date, tz: string) {
  const fmt = new Intl.DateTimeFormat('en-US', {
    timeZone: tz,
    year: 'numeric', month: '2-digit', day: '2-digit',
    hour: '2-digit', minute: '2-digit', weekday: 'short', hourCycle: 'h23',
  });
  const bag: Record<string, string> = {};
  for (const p of fmt.formatToParts(instant)) {
    if (p.type !== 'literal') bag[p.type] = p.value;
  }
  return { ...bag, label: `${bag.weekday} ${bag.hour}:${bag.minute}` };
}

const ZONES = ['UTC', 'Asia/Shanghai', 'America/New_York', 'Europe/London', 'Pacific/Kiritimati'];

describe('localChallengeWeekIndex — when a week OPENS for a player', () => {
  it('opens the week at 04:00 on that player\'s own Monday, in every zone', () => {
    for (const tz of ZONES) {
      const open = weekOpen(32, tz);
      expect(localOf(open, tz).label).toBe('Mon 04:00');
      // One millisecond before, the player is still in the previous week.
      expect(localChallengeWeekIndex(tz, new Date(open.getTime() - 1))).toBe(31);
      expect(localChallengeWeekIndex(tz, open)).toBe(32);
    }
  });

  it('is EAST of UTC that the old UTC stamp was a bug, not just early', () => {
    // Shanghai's Monday 04:00 lands at Sun 20:00 UTC, four hours BEFORE the counter
    // rolls. A challenge issued in that gap used to be stamped with the outgoing
    // week, whose accept deadline had passed five days earlier — born expired.
    const inTheGap = new Date('2026-08-16T21:00:00Z'); // Mon 05:00 in Shanghai
    expect(challengeWeekIndex(inTheGap)).toBe(31);
    expect(localChallengeWeekIndex('Asia/Shanghai', inTheGap)).toBe(32);

    // The proof it matters: the week the UTC counter would have chosen has an
    // accept deadline in the past, and the one the player's clock chooses does not.
    expect(acceptDeadline(31, 'Asia/Shanghai').getTime()).toBeLessThan(inTheGap.getTime());
    expect(acceptDeadline(32, 'Asia/Shanghai').getTime()).toBeGreaterThan(inTheGap.getTime());
  });

  it('west of UTC, holds the new week back until the local Monday', () => {
    // Los Angeles: the counter rolls at Sun 17:00 local, 11 hours before their
    // Monday 04:00. Issuing in that gap must still be LAST week's business.
    const afterTheRoll = new Date('2026-08-17T02:00:00Z'); // Sun 19:00 in LA
    expect(challengeWeekIndex(afterTheRoll)).toBe(32);
    expect(localChallengeWeekIndex('America/Los_Angeles', afterTheRoll)).toBe(31);
  });

  it('the week a player is in always contains the moment', () => {
    // The property the descending scan exists to guarantee: for any instant and any
    // zone, this week has opened and the next has not.
    const instants = [
      '2026-08-16T19:59:00Z', '2026-08-16T20:00:00Z', '2026-08-17T00:00:00Z',
      '2026-08-17T11:00:00Z', '2026-08-17T16:01:00Z', '2026-11-01T09:00:00Z',
    ].map((iso) => new Date(iso));
    for (const tz of [...ZONES, 'America/Los_Angeles', 'Pacific/Midway']) {
      for (const now of instants) {
        const week = localChallengeWeekIndex(tz, now);
        expect(weekOpen(week, tz).getTime()).toBeLessThanOrEqual(now.getTime());
        expect(weekOpen(week + 1, tz).getTime()).toBeGreaterThan(now.getTime());
      }
    }
  });

  it('a week opens exactly when the previous week\'s test window closes', () => {
    // The same boundary named twice (§ 2) — if these ever drift apart there is a gap
    // in which a player can neither play nor start again.
    for (const tz of ZONES) {
      expect(weekOpen(33, tz).getTime()).toBe(testWindowClose(32, tz).getTime());
    }
  });

  it('survives a DST shift — the boundary is a wall clock, not a fixed offset', () => {
    // US DST ends Sun 2026-11-01. The Monday after is 04:00 EST, an hour later in
    // UTC than the Monday before was in EDT; a closed-form offset from the UTC
    // counter would put the roll an hour wrong for that one week.
    const before = weekOpen(42, 'America/New_York'); // Mon 2026-10-26, EDT
    const after = weekOpen(43, 'America/New_York');  // Mon 2026-11-02, EST
    expect(localOf(before, 'America/New_York').label).toBe('Mon 04:00');
    expect(localOf(after, 'America/New_York').label).toBe('Mon 04:00');
    expect(after.getTime() - before.getTime()).toBe((7 * 24 + 1) * 60 * 60 * 1000);
    expect(localChallengeWeekIndex('America/New_York', new Date(after.getTime() - 1))).toBe(42);
    expect(localChallengeWeekIndex('America/New_York', after)).toBe(43);
  });
});

describe('challengeWeekIndex', () => {
  it('anchors week 0 at Monday 2026-01-05 00:00 UTC', () => {
    expect(new Date(CHALLENGE_WEEK_EPOCH_UTC).toISOString()).toBe('2026-01-05T00:00:00.000Z');
    // A Monday — the whole reason this date is the anchor.
    expect(new Date(CHALLENGE_WEEK_EPOCH_UTC).getUTCDay()).toBe(1);
    expect(challengeWeekIndex(new Date('2026-01-05T00:00:00Z'))).toBe(0);
    expect(challengeWeekIndex(new Date('2026-01-11T23:59:59Z'))).toBe(0);
    expect(challengeWeekIndex(new Date('2026-01-12T00:00:00Z'))).toBe(1);
  });

  it('counts whole weeks forward', () => {
    // 2026-08-17 is 224 days (exactly 32 weeks) after the epoch.
    expect(challengeWeekIndex(new Date('2026-08-17T04:00:00Z'))).toBe(32);
    expect(challengeWeekKey(32)).toBe('2026-08-17');
  });

  it('is defined before the epoch, with evenly spaced weeks', () => {
    expect(challengeWeekIndex(new Date('2026-01-04T23:59:59Z'))).toBe(-1);
    expect(challengeWeekIndex(new Date('2025-12-29T00:00:00Z'))).toBe(-1);
    expect(challengeWeekIndex(new Date('2025-12-28T23:59:59Z'))).toBe(-2);
  });

  it('FORCES A COLLISION: one instant maps to one index in every timezone', () => {
    // The regression this replaced: `weekStart` was the challenger's local Monday
    // 04:00 as an instant, so this same moment produced 2026-08-16T20:00Z in
    // Shanghai and 2026-08-17T08:00Z in New York — two different unique-index keys
    // for one pair in one week, so both crossing challenges were created.
    const instant = new Date('2026-08-19T02:00:00Z');
    const indices = new Set(ZONES.map(() => challengeWeekIndex(instant)));
    expect(indices.size).toBe(1);
    expect([...indices][0]).toBe(32);
  });
});

describe('deadlines', () => {
  it('are 04:00 local on Wednesday / Friday / the following Monday, per zone', () => {
    for (const tz of ZONES) {
      expect(localOf(acceptDeadline(32, tz), tz).label).toBe(`Wed 0${CHALLENGE_BOUNDARY_HOUR}:00`);
      expect(localOf(testWindowOpen(32, tz), tz).label).toBe('Fri 04:00');
      expect(localOf(testWindowClose(32, tz), tz).label).toBe('Mon 04:00');
    }
  });

  it('match the cron SQL, instant for instant (cross-checked 2026-08-17)', () => {
    // SELECT (((DATE '2026-01-05' + 7 * 32 + 2) + TIME '04:00') AT TIME ZONE tz)
    expect(acceptDeadline(32, 'Asia/Shanghai').toISOString()).toBe('2026-08-18T20:00:00.000Z');
    expect(acceptDeadline(32, 'America/New_York').toISOString()).toBe('2026-08-19T08:00:00.000Z');
    expect(acceptDeadline(32, 'Europe/London').toISOString()).toBe('2026-08-19T03:00:00.000Z');
    expect(acceptDeadline(32, 'UTC').toISOString()).toBe('2026-08-19T04:00:00.000Z');
    // SELECT (((DATE '2026-01-05' + 7 * 32 + 7) + TIME '04:00') AT TIME ZONE tz)
    expect(testWindowClose(32, 'Asia/Shanghai').toISOString()).toBe('2026-08-23T20:00:00.000Z');
    expect(testWindowClose(32, 'America/New_York').toISOString()).toBe('2026-08-24T08:00:00.000Z');
    expect(testWindowClose(32, 'Pacific/Kiritimati').toISOString()).toBe('2026-08-23T14:00:00.000Z');
  });

  it("resolves on the LATER close, so nobody is timed out by the other player's clock", () => {
    const east = 'Asia/Shanghai';       // closes first in absolute time
    const west = 'America/New_York';    // closes last
    expect(latestTestWindowClose(32, east, west).toISOString())
      .toBe(testWindowClose(32, west).toISOString());
    // Order of the arguments must not matter.
    expect(latestTestWindowClose(32, west, east).toISOString())
      .toBe(latestTestWindowClose(32, east, west).toISOString());
  });

  it('opens and closes the windows on each player\'s own clock', () => {
    const tz = 'America/New_York';
    const deadline = acceptDeadline(32, tz);
    expect(isAcceptWindowOpen(32, tz, new Date(deadline.getTime() - 1))).toBe(true);
    expect(isAcceptWindowOpen(32, tz, deadline)).toBe(false);

    const opens = testWindowOpen(32, tz);
    const closes = testWindowClose(32, tz);
    expect(isTestWindowOpen(32, tz, new Date(opens.getTime() - 1))).toBe(false);
    expect(isTestWindowOpen(32, tz, opens)).toBe(true);
    expect(isTestWindowOpen(32, tz, new Date(closes.getTime() - 1))).toBe(true);
    expect(isTestWindowOpen(32, tz, closes)).toBe(false);
  });

  it('spans a DST transition without slipping a day', () => {
    // US DST ends 2026-11-01. Week 43 = Monday 2026-11-02, so the accept deadline
    // (Wed) is on the far side of the shift from the epoch arithmetic.
    const idx = challengeWeekIndex(new Date('2026-11-04T12:00:00Z'));
    expect(challengeWeekKey(idx)).toBe('2026-11-02');
    expect(localOf(acceptDeadline(idx, 'America/New_York'), 'America/New_York').label).toBe('Wed 04:00');
    expect(localOf(testWindowClose(idx, 'America/New_York'), 'America/New_York').label).toBe('Mon 04:00');
  });
});
