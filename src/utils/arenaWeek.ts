/**
 * Arena week boundaries — CLIENT MIRROR.
 *
 * ⚠️ THIS FILE IS A COPY OF server/shared/arenaWeek.ts. Edit that one and copy
 * it here; do not diverge. The server is the source of truth and its version is
 * the one with the tests (server/__tests__/arenaWeek.test.ts).
 *
 * The copy exists because the client renders a live countdown to the close
 * instant. If it computed that boundary with its own logic it would eventually
 * disagree with the server by an hour across a DST shift, and the visible
 * symptom would be a countdown hitting zero while the arena still accepts
 * minutes. Standard library only (Date, Intl).
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

/** Day-of-week indices as returned by Date.prototype.getUTCDay(). */
const TUESDAY = 2;
const SUNDAY = 0;

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

const MS_PER_MINUTE = 60 * 1000;
const MS_PER_HOUR = 60 * MS_PER_MINUTE;
const MS_PER_DAY = 24 * MS_PER_HOUR;

/** Broken-down local wall-clock time. */
interface LocalParts {
  year: number;
  month: number; // 1-12
  day: number;
  hour: number;
  minute: number;
  second: number;
  dow: number; // 0 = Sunday
}

/**
 * Decompose an instant into wall-clock parts in `tz`.
 */
function partsInZone(instant: Date, tz: string): LocalParts {
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

/**
 * The offset of `tz` from UTC at `instant`, in milliseconds (positive = ahead).
 */
function zoneOffsetMs(instant: Date, tz: string): number {
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
 * Neither can affect a real arena boundary today: no zone shifts DST at 04:00
 * or 16:00. This is defensive, not load-bearing — but if a zone ever did, the
 * behaviour is defined instead of arbitrary.
 */
function zonedWallClockToUtc(
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
 * Validate an IANA timezone identifier, falling back to 'UTC'.
 *
 * Mirrors resolveTimezone in streakDay.ts. Duplicated rather than imported so
 * this module keeps zero internal dependencies and can be copied to the client
 * verbatim; if a third module needs it, extract it then.
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

  // Step back in whole local days via a UTC-noon proxy: noon is far from any DST
  // boundary, so the calendar arithmetic cannot slip a day.
  const noonProxy = Date.UTC(p.year, p.month - 1, p.day, 12) - daysBack * MS_PER_DAY;
  const back = new Date(noonProxy);

  return zonedWallClockToUtc(
    back.getUTCFullYear(),
    back.getUTCMonth() + 1,
    back.getUTCDate(),
    ARENA_WEEK_START_HOUR,
    tz,
  );
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
  const p = partsInZone(weekStart, tz);
  // Tuesday -> Sunday is +5 days. Same noon-proxy trick.
  const noonProxy = Date.UTC(p.year, p.month - 1, p.day, 12) + 5 * MS_PER_DAY;
  const fwd = new Date(noonProxy);

  return zonedWallClockToUtc(
    fwd.getUTCFullYear(),
    fwd.getUTCMonth() + 1,
    fwd.getUTCDate(),
    ARENA_CLOSE_HOUR,
    tz,
  );
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
  const p = partsInZone(weekStart, tz);
  return `${p.year}-${String(p.month).padStart(2, '0')}-${String(p.day).padStart(2, '0')}`;
}

/**
 * The week key of the NEXT arena week — the one an opt-in during the break
 * enrolls the user into.
 */
export function nextArenaWeekKey(instant: Date, tz: string): string {
  const start = arenaWeekStart(instant, tz);
  const p = partsInZone(start, tz);
  const noonProxy = Date.UTC(p.year, p.month - 1, p.day, 12) + 7 * MS_PER_DAY;
  const next = new Date(noonProxy);
  return zonedWeekKeyOf(next);
}

/** Format a UTC-noon-proxy date as a YYYY-MM-DD week key. */
function zonedWeekKeyOf(proxy: Date): string {
  const y = proxy.getUTCFullYear();
  const m = String(proxy.getUTCMonth() + 1).padStart(2, '0');
  const d = String(proxy.getUTCDate()).padStart(2, '0');
  return `${y}-${m}-${d}`;
}
