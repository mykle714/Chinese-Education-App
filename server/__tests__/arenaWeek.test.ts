import { describe, it, expect } from 'vitest';
import {
  arenaWeekStart,
  arenaCloseFor,
  arenaFormationAt,
  isBreakPeriod,
  arenaWeekKey,
  nextArenaWeekKey,
  resolveTimezone,
  ARENA_WEEK_START_HOUR,
  ARENA_CLOSE_HOUR,
} from '../shared/arenaWeek.js';

/**
 * Boundary maths for the arena week (docs/ARENA_FEATURE.md § 3).
 *
 * These tests exist because a wrong boundary is SILENT: nothing crashes, minutes
 * simply land on the wrong week or a countdown hits zero early. Every assertion
 * below is stated as a local wall-clock expectation, because that is the thing
 * the design actually promises the user.
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
  return {
    weekday: bag.weekday,
    hour: Number(bag.hour),
    minute: Number(bag.minute),
    date: `${bag.year}-${bag.month}-${bag.day}`,
  };
}

const ZONES = [
  'America/New_York',
  'America/Los_Angeles',
  'Europe/London',
  'Asia/Tokyo',       // no DST
  'Australia/Sydney', // southern-hemisphere DST, opposite phase
  'Asia/Kolkata',     // +05:30, non-whole-hour offset
  'UTC',
];

describe('arenaWeekStart', () => {
  it('always lands on Tuesday at 04:00 local, in every zone', () => {
    for (const tz of ZONES) {
      // Sample every 7 hours across a full year: catches DST shifts in both
      // hemispheres and every hour-of-week phase.
      for (let h = 0; h < 24 * 365; h += 7) {
        const instant = new Date(Date.UTC(2026, 0, 1) + h * 3600_000);
        const start = arenaWeekStart(instant, tz);
        const local = localOf(start, tz);
        expect(local.weekday, `${tz} @ ${instant.toISOString()}`).toBe('Tue');
        expect(local.hour, `${tz} @ ${instant.toISOString()}`).toBe(ARENA_WEEK_START_HOUR);
        expect(local.minute).toBe(0);
      }
    }
  });

  it('never returns a start in the future', () => {
    for (const tz of ZONES) {
      for (let h = 0; h < 24 * 120; h += 5) {
        const instant = new Date(Date.UTC(2026, 2, 1) + h * 3600_000);
        expect(arenaWeekStart(instant, tz).getTime()).toBeLessThanOrEqual(instant.getTime());
      }
    }
  });

  it('treats Tuesday 03:59 local as the PREVIOUS week and 04:00 as the new one', () => {
    const tz = 'America/New_York';
    // 2026-08-18 is a Tuesday.
    const justBefore = new Date('2026-08-18T07:59:00Z'); // 03:59 EDT
    const justAfter = new Date('2026-08-18T08:00:00Z');  // 04:00 EDT

    expect(arenaWeekKey(arenaWeekStart(justBefore, tz), tz)).toBe('2026-08-11');
    expect(arenaWeekKey(arenaWeekStart(justAfter, tz), tz)).toBe('2026-08-18');
  });

  it('is stable — a week start maps to itself', () => {
    for (const tz of ZONES) {
      const start = arenaWeekStart(new Date('2026-06-10T12:00:00Z'), tz);
      expect(arenaWeekStart(start, tz).getTime()).toBe(start.getTime());
    }
  });
});

describe('arenaCloseFor', () => {
  it('always lands on Sunday at 16:00 local — the deliberate exception to the 04:00 rule', () => {
    for (const tz of ZONES) {
      for (let w = 0; w < 52; w++) {
        const instant = new Date(Date.UTC(2026, 0, 6) + w * 7 * 86_400_000);
        const start = arenaWeekStart(instant, tz);
        const local = localOf(arenaCloseFor(start, tz), tz);
        expect(local.weekday, `${tz} week ${w}`).toBe('Sun');
        expect(local.hour, `${tz} week ${w}`).toBe(ARENA_CLOSE_HOUR);
        expect(local.minute).toBe(0);
      }
    }
  });

  it('closes after it opens, by roughly 5 days, even across DST', () => {
    for (const tz of ZONES) {
      for (let w = 0; w < 52; w++) {
        const instant = new Date(Date.UTC(2026, 0, 6) + w * 7 * 86_400_000);
        const start = arenaWeekStart(instant, tz);
        const close = arenaCloseFor(start, tz);
        const hours = (close.getTime() - start.getTime()) / 3_600_000;
        expect(close.getTime()).toBeGreaterThan(start.getTime());
        // 5 days + 12 hours = 132h; a DST shift moves it one hour either way.
        expect(hours).toBeGreaterThanOrEqual(131);
        expect(hours).toBeLessThanOrEqual(133);
      }
    }
  });

  it('survives a spring-forward week (US) without drifting an hour', () => {
    // US DST begins 2026-03-08. The week Tue 2026-03-03 -> Sun 2026-03-08
    // contains the shift, so a naive +5*24h would land at 17:00.
    const tz = 'America/New_York';
    const start = arenaWeekStart(new Date('2026-03-04T12:00:00Z'), tz);
    const close = arenaCloseFor(start, tz);
    expect(localOf(close, tz)).toMatchObject({ weekday: 'Sun', hour: 16 });
    // 131 hours, not 132 — the week is genuinely an hour shorter.
    expect((close.getTime() - start.getTime()) / 3_600_000).toBe(131);
  });

  it('survives a southern-hemisphere fall-back week', () => {
    // Sydney DST ends 2026-04-05 (a Sunday).
    const tz = 'Australia/Sydney';
    const start = arenaWeekStart(new Date('2026-04-01T12:00:00Z'), tz);
    const close = arenaCloseFor(start, tz);
    expect(localOf(close, tz)).toMatchObject({ weekday: 'Sun', hour: 16 });
    expect((close.getTime() - start.getTime()) / 3_600_000).toBe(133);
  });
});

describe('isBreakPeriod', () => {
  const tz = 'America/New_York';

  it('is false while the arena is live and true after it closes', () => {
    // Week of Tue 2026-08-18; closes Sun 2026-08-23 16:00 EDT = 20:00Z.
    expect(isBreakPeriod(new Date('2026-08-18T08:00:00Z'), tz)).toBe(false); // Tue 04:00
    expect(isBreakPeriod(new Date('2026-08-21T15:00:00Z'), tz)).toBe(false); // Fri
    expect(isBreakPeriod(new Date('2026-08-23T19:59:00Z'), tz)).toBe(false); // Sun 15:59
    expect(isBreakPeriod(new Date('2026-08-23T20:00:00Z'), tz)).toBe(true);  // Sun 16:00
    expect(isBreakPeriod(new Date('2026-08-24T12:00:00Z'), tz)).toBe(true);  // Mon
    expect(isBreakPeriod(new Date('2026-08-25T07:59:00Z'), tz)).toBe(true);  // Tue 03:59
    expect(isBreakPeriod(new Date('2026-08-25T08:00:00Z'), tz)).toBe(false); // Tue 04:00
  });

  it('spans 36 hours, as the design states', () => {
    for (const zone of ZONES) {
      const start = arenaWeekStart(new Date('2026-09-16T12:00:00Z'), zone);
      const close = arenaCloseFor(start, zone);
      const nextStart = arenaWeekStart(new Date(close.getTime() + 86_400_000 * 2), zone);
      const breakHours = (nextStart.getTime() - close.getTime()) / 3_600_000;
      expect(breakHours, zone).toBeGreaterThanOrEqual(35);
      expect(breakHours, zone).toBeLessThanOrEqual(37);
    }
  });
});

describe('arenaFormationAt', () => {
  it('runs one hour before the week opens, so arenas exist at 04:00', () => {
    const tz = 'Asia/Tokyo';
    const start = arenaWeekStart(new Date('2026-05-13T12:00:00Z'), tz);
    const formation = arenaFormationAt(start);
    expect(start.getTime() - formation.getTime()).toBe(3_600_000);
    expect(localOf(formation, tz).hour).toBe(3);
  });
});

describe('week keys', () => {
  it('labels a week by its Tuesday, and the next key is 7 days on', () => {
    const tz = 'Europe/London';
    const instant = new Date('2026-08-20T12:00:00Z'); // Thursday
    const start = arenaWeekStart(instant, tz);
    expect(arenaWeekKey(start, tz)).toBe('2026-08-18');
    expect(nextArenaWeekKey(instant, tz)).toBe('2026-08-25');
  });

  it('advances across a month boundary', () => {
    const tz = 'UTC';
    expect(nextArenaWeekKey(new Date('2026-08-29T12:00:00Z'), tz)).toBe('2026-09-01');
  });

  it('advances across a year boundary', () => {
    const tz = 'UTC';
    expect(nextArenaWeekKey(new Date('2026-12-30T12:00:00Z'), tz)).toBe('2027-01-05');
  });

  it('produces a key that round-trips back to the same week start', () => {
    for (const tz of ZONES) {
      for (let d = 0; d < 90; d++) {
        const instant = new Date(Date.UTC(2026, 1, 1) + d * 86_400_000);
        const start = arenaWeekStart(instant, tz);
        expect(arenaWeekKey(arenaWeekStart(start, tz), tz)).toBe(arenaWeekKey(start, tz));
      }
    }
  });
});

describe('resolveTimezone', () => {
  it('accepts valid zones and falls back to UTC on anything else', () => {
    expect(resolveTimezone('Asia/Tokyo')).toBe('Asia/Tokyo');
    expect(resolveTimezone('  Europe/Paris  ')).toBe('Europe/Paris');
    expect(resolveTimezone('Not/AZone')).toBe('UTC');
    expect(resolveTimezone('')).toBe('UTC');
    expect(resolveTimezone(undefined)).toBe('UTC');
    expect(resolveTimezone(42)).toBe('UTC');
  });
});
