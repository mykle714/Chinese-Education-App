/**
 * Zoned wall-clock arithmetic — ISOMORPHIC, standard library only.
 *
 * Single source of truth for "what UTC instant does this local wall-clock time
 * name in this timezone", which the app needs everywhere because EVERY user-facing
 * boundary is local to the user it applies to: the 04:00 streak day
 * (shared/streakDay.ts), the arena cycle (shared/arenaWeek.ts) and the study
 * challenge week (shared/challengeWeek.ts).
 *
 * ── Why this file exists ──────────────────────────────────────────────────────
 * `partsInZone` / `zoneOffsetMs` / `zonedWallClockToUtc` were private to
 * arenaWeek.ts, and `resolveTimezone` was duplicated between arenaWeek.ts and
 * streakDay.ts with a note reading "duplicated rather than imported so this module
 * keeps zero internal dependencies; if a third module needs it, extract it then."
 * Study Challenge is that third module, so this is the extraction that note asked
 * for. Nothing about the behaviour changed — the arena tests
 * (server/__tests__/arenaWeek.test.ts) pin it.
 *
 * ⚠️ CONTRACT: standard library only (Date, Intl), no Node and no DOM globals, no
 * relative imports outside `shared/`. Both the server and the browser bundle
 * compile this file, and one Node-only import breaks the client build.
 */

export const MS_PER_MINUTE = 60 * 1000;
export const MS_PER_HOUR = 60 * MS_PER_MINUTE;
export const MS_PER_DAY = 24 * MS_PER_HOUR;

/** Day-of-week indices, as `Date.prototype.getUTCDay()` returns them. */
export const SUNDAY = 0;
export const MONDAY = 1;
export const TUESDAY = 2;
export const WEDNESDAY = 3;
export const THURSDAY = 4;
export const FRIDAY = 5;
export const SATURDAY = 6;

/** Broken-down local wall-clock time. */
export interface LocalParts {
  year: number;
  month: number; // 1-12
  day: number;
  hour: number;
  minute: number;
  second: number;
  dow: number; // 0 = Sunday
}

/**
 * Validate an IANA timezone identifier. Returns the tz if valid, otherwise 'UTC'.
 *
 * Falling back rather than throwing is deliberate: `users.timezone` is client-set,
 * so a garbage value must degrade to a defined boundary instead of failing a read
 * the user cannot repair from the error.
 */
export function resolveTimezone(rawTz: unknown): string {
  if (typeof rawTz !== 'string' || rawTz.trim().length === 0) return 'UTC';
  const tz = rawTz.trim();
  try {
    new Intl.DateTimeFormat('en-US', { timeZone: tz }).format(new Date());
    return tz;
  } catch {
    return 'UTC';
  }
}

/** Decompose an instant into wall-clock parts in `tz`. */
export function partsInZone(instant: Date, tz: string): LocalParts {
  const fmt = new Intl.DateTimeFormat('en-US', {
    timeZone: tz,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
    second: '2-digit',
    weekday: 'short',
    hourCycle: 'h23',
  });

  const bag: Record<string, string> = {};
  for (const p of fmt.formatToParts(instant)) {
    if (p.type !== 'literal') bag[p.type] = p.value;
  }

  const dowByName: Record<string, number> = {
    Sun: 0, Mon: 1, Tue: 2, Wed: 3, Thu: 4, Fri: 5, Sat: 6,
  };

  return {
    year: parseInt(bag.year, 10),
    month: parseInt(bag.month, 10),
    day: parseInt(bag.day, 10),
    hour: parseInt(bag.hour, 10),
    minute: parseInt(bag.minute, 10),
    second: parseInt(bag.second, 10),
    dow: dowByName[bag.weekday],
  };
}

/** The offset of `tz` from UTC at `instant`, in milliseconds (positive = ahead). */
export function zoneOffsetMs(instant: Date, tz: string): number {
  const p = partsInZone(instant, tz);
  const asUtc = Date.UTC(p.year, p.month - 1, p.day, p.hour, p.minute, p.second);
  // Second-truncate the reference so the difference is a clean offset.
  const truncated = Math.floor(instant.getTime() / 1000) * 1000;
  return asUtc - truncated;
}

/**
 * Convert a local wall-clock time in `tz` to the UTC instant it names.
 *
 * Two-pass, because the offset we need depends on the answer we are computing:
 * guess with the offset at the naive instant, then re-read the offset AT that
 * guess and correct. The second pass is what makes DST-transition weeks land on
 * the right side of the shift.
 *
 * DST edge cases, stated rather than hidden:
 *  - A wall-clock time that does not exist (spring-forward gap) resolves to the
 *    instant just after the jump.
 *  - A time that occurs twice (fall-back overlap) resolves to the FIRST
 *    occurrence.
 * Neither can affect a real boundary today: no zone shifts DST at 04:00 or 16:00.
 * This is defensive, not load-bearing — but if a zone ever did, the behaviour is
 * defined instead of arbitrary.
 */
export function zonedWallClockToUtc(
  year: number,
  month: number,
  day: number,
  hour: number,
  tz: string,
): Date {
  const naive = Date.UTC(year, month - 1, day, hour, 0, 0);
  const firstGuess = new Date(naive - zoneOffsetMs(new Date(naive), tz));
  const corrected = new Date(naive - zoneOffsetMs(firstGuess, tz));
  return corrected;
}

/**
 * The UTC instant of `hour:00` local on the day `dayOffset` days from the local
 * calendar day containing `from`.
 *
 * The day arithmetic goes through a UTC-NOON PROXY: noon is far from any DST
 * boundary, so adding or subtracting whole days cannot slip a day the way it can
 * near midnight. Every boundary helper in the app that steps by days uses this,
 * which is the whole reason it is worth having in one place.
 */
export function localHourOnOffsetDay(
  from: Date,
  tz: string,
  dayOffset: number,
  hour: number,
): Date {
  const p = partsInZone(from, tz);
  const noonProxy = Date.UTC(p.year, p.month - 1, p.day, 12) + dayOffset * MS_PER_DAY;
  const shifted = new Date(noonProxy);
  return zonedWallClockToUtc(
    shifted.getUTCFullYear(),
    shifted.getUTCMonth() + 1,
    shifted.getUTCDate(),
    hour,
    tz,
  );
}

/**
 * A YYYY-MM-DD label for the local calendar day containing `instant` in `tz`.
 *
 * An IDENTITY, not an instant — it answers "which day/week is this", which is why
 * it is a date string rather than a timestamp.
 */
export function localDateKey(instant: Date, tz: string): string {
  const p = partsInZone(instant, tz);
  return `${p.year}-${String(p.month).padStart(2, '0')}-${String(p.day).padStart(2, '0')}`;
}
