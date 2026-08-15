/**
 * Minute-points → duration copy ("2d 3h 5m", "7w 1d 2h 3m").
 *
 * A minute point IS a minute of study, so a balance reads naturally as a span of
 * time. Both surfaces that show a balance render it this way: the Night Market's
 * bottom-left badge and the friends leaderboard's per-row subtitle.
 *
 * Unit sizes match the minute-points domain, not the calendar: an hour is 60
 * minutes, a day is 1440 (the same 24-hour CHECKPOINT_MINUTES the inactivity penalty
 * floors at — see src/constants.ts) and a week is 7 of those. No DST, no month.
 *
 * Depended on by: src/features/friends/friendLabels.ts,
 * src/features/nightmarket/NightMarketEnginePage.tsx.
 * Tested by: src/__tests__/formatDuration.test.ts.
 */

export const MINUTES_PER_HOUR = 60;
export const MINUTES_PER_DAY = 24 * MINUTES_PER_HOUR;
export const MINUTES_PER_WEEK = 7 * MINUTES_PER_DAY;

interface FormatDurationOptions {
    /**
     * Break days out into weeks past 7 (10080 → "1w" rather than "7d").
     *
     * OFF by default so the Night Market badge keeps the output it has always had.
     * The friends leaderboard opts in: its rows compare long-running balances, where
     * "7w 1d" is easier to size up at a glance than "50d".
     */
    weeks?: boolean;
}

/**
 * Format a raw minute-points balance as a coarse duration.
 *
 * Leading zero units are dropped (90 → "1h 30m") so the string stays short, but a
 * zero *middle* unit is kept (1500 → "1d 1h 0m") to avoid the ambiguous-looking
 * "1d 0m". A balance under an hour renders as plain minutes, and 0 or negative
 * balances render as "0m" — never as an empty string.
 */
export function formatMinutesAsDuration(
    totalMinutes: number,
    { weeks = false }: FormatDurationOptions = {}
): string {
    // Guards a NaN/negative/fractional balance into something renderable: every
    // caller is showing a number to a user, and "NaNm" is worse than "0m".
    const safeMinutes = Number.isFinite(totalMinutes) ? Math.max(0, Math.floor(totalMinutes)) : 0;

    const weekCount = weeks ? Math.floor(safeMinutes / MINUTES_PER_WEEK) : 0;
    const afterWeeks = safeMinutes - weekCount * MINUTES_PER_WEEK;
    const days = Math.floor(afterWeeks / MINUTES_PER_DAY);
    const hours = Math.floor((afterWeeks % MINUTES_PER_DAY) / MINUTES_PER_HOUR);
    const minutes = safeMinutes % MINUTES_PER_HOUR;

    // Each unit prints once any LARGER unit has printed, which is what keeps the
    // middle zeros ("1d 0h 5m") while still dropping the leading ones.
    const parts: string[] = [];
    if (weekCount > 0) parts.push(`${weekCount}w`);
    if (weekCount > 0 || days > 0) parts.push(`${days}d`);
    if (weekCount > 0 || days > 0 || hours > 0) parts.push(`${hours}h`);
    parts.push(`${minutes}m`);
    return parts.join(' ');
}
