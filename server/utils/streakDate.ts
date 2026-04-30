/**
 * Streak-day helpers.
 *
 * The "streak day" is a 4 AM-bounded calendar day in the user's local timezone.
 * Activity at 03:30 local on the 13th counts toward the 12th's streak day;
 * activity at 04:00 on the 13th counts toward the 13th.
 *
 * The user's tz is supplied per-request — it is never persisted.
 */

const STREAK_DAY_OFFSET_HOURS = 4;
const MS_PER_DAY = 24 * 60 * 60 * 1000;

/**
 * Validate an IANA timezone identifier. Returns the tz if valid, otherwise 'UTC'.
 */
export function resolveTimezone(rawTz: unknown): string {
  if (typeof rawTz !== 'string' || rawTz.trim().length === 0) {
    return 'UTC';
  }
  const tz = rawTz.trim();
  try {
    new Intl.DateTimeFormat('en-US', { timeZone: tz }).format(new Date());
    return tz;
  } catch {
    return 'UTC';
  }
}

/**
 * Resolve a (timestamp, tz) pair to its streak day label in YYYY-MM-DD form.
 *
 * Implementation: format the timestamp into the user's tz to get
 * year/month/day/hour parts, then subtract STREAK_DAY_OFFSET_HOURS by
 * decrementing the day if hour < offset.
 */
export function streakDateOf(timestamp: Date | string, tz: string): string {
  const date = typeof timestamp === 'string' ? new Date(timestamp) : timestamp;
  if (isNaN(date.getTime())) {
    throw new Error('streakDateOf: invalid timestamp');
  }

  const formatter = new Intl.DateTimeFormat('en-US', {
    timeZone: tz,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    hourCycle: 'h23',
  });

  const parts: Record<string, string> = {};
  for (const part of formatter.formatToParts(date)) {
    if (part.type !== 'literal') parts[part.type] = part.value;
  }

  const year = parseInt(parts.year, 10);
  const month = parseInt(parts.month, 10);
  const day = parseInt(parts.day, 10);
  const hour = parseInt(parts.hour, 10);

  // Build a UTC date for the local YMD, then shift back a day if before the 4 AM cutoff.
  const local = Date.UTC(year, month - 1, day);
  const adjusted = hour < STREAK_DAY_OFFSET_HOURS ? local - MS_PER_DAY : local;
  const d = new Date(adjusted);
  const y = d.getUTCFullYear();
  const m = String(d.getUTCMonth() + 1).padStart(2, '0');
  const dd = String(d.getUTCDate()).padStart(2, '0');
  return `${y}-${m}-${dd}`;
}

/**
 * Add (or subtract) n days from a YYYY-MM-DD string. Returns YYYY-MM-DD.
 */
export function addDaysToDateString(yyyymmdd: string, n: number): string {
  const [y, m, d] = yyyymmdd.split('-').map(Number);
  const ms = Date.UTC(y, m - 1, d) + n * MS_PER_DAY;
  const out = new Date(ms);
  const yy = out.getUTCFullYear();
  const mm = String(out.getUTCMonth() + 1).padStart(2, '0');
  const dd = String(out.getUTCDate()).padStart(2, '0');
  return `${yy}-${mm}-${dd}`;
}

/**
 * Difference in whole days between two YYYY-MM-DD strings (b - a).
 */
export function daysBetween(a: string, b: string): number {
  const [ay, am, ad] = a.split('-').map(Number);
  const [by, bm, bd] = b.split('-').map(Number);
  const aMs = Date.UTC(ay, am - 1, ad);
  const bMs = Date.UTC(by, bm - 1, bd);
  return Math.round((bMs - aMs) / MS_PER_DAY);
}

/**
 * Validate a YYYY-MM-DD string.
 */
export function isValidDateString(s: string): boolean {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(s)) return false;
  const [y, m, d] = s.split('-').map(Number);
  const date = new Date(Date.UTC(y, m - 1, d));
  return (
    date.getUTCFullYear() === y &&
    date.getUTCMonth() === m - 1 &&
    date.getUTCDate() === d
  );
}
