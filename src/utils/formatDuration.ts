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

/**
 * A cooldown remainder as a unit-suffixed span: `4m 1w 3d 5h 37m 26s`.
 *
 * Same shape as `formatMinutesAsDuration` above — leading zero units are dropped, a
 * zero *middle* unit is kept, and the smallest unit always prints — extended down to
 * seconds and up to months, because the cooldown windows span five minutes to 180
 * days and the cdp counts down live.
 *
 * Keeping the middle zeros matters more here than it does for a minute-points
 * balance: with them dropped, six months and change would render `6m 26s`, which
 * reads as six MINUTES and 26 seconds. Suffix `m` is doing double duty (months and
 * minutes) — it is only ever unambiguous because the units always appear in order
 * with nothing missing between them.
 *
 * A month is a flat 30 days and a week a flat 7 (the Mastered window is itself
 * defined as 180 days, not as six calendar months), so no calendar arithmetic is
 * involved and `180d` is exactly `6m`.
 *
 * A ready track reads `0s`.
 *
 * Depended on by: src/features/flashcards/MasteryProgressBar.tsx.
 * Tested by: src/__tests__/formatDuration.test.ts.
 */
export function formatCooldownRemaining(remainingMs: number): string {
    // Guards a NaN/negative remainder into something renderable: every caller is
    // showing this to a user, and "NaNs" is worse than "0s".
    const ms = Number.isFinite(remainingMs) ? Math.max(0, remainingMs) : 0;

    // Round UP to the second, so a track with 300ms left still reads 1s and the
    // countdown only hits 0s once the window has genuinely elapsed.
    let rest = Math.ceil(ms / 1000);

    const SECONDS_PER = { m: 30 * 86400, w: 7 * 86400, d: 86400, h: 3600, min: 60 } as const;
    const months = Math.floor(rest / SECONDS_PER.m); rest -= months * SECONDS_PER.m;
    const weeks = Math.floor(rest / SECONDS_PER.w); rest -= weeks * SECONDS_PER.w;
    const days = Math.floor(rest / SECONDS_PER.d); rest -= days * SECONDS_PER.d;
    const hours = Math.floor(rest / SECONDS_PER.h); rest -= hours * SECONDS_PER.h;
    const minutes = Math.floor(rest / SECONDS_PER.min); rest -= minutes * SECONDS_PER.min;

    // Each unit prints once any LARGER unit has printed, which is what keeps the
    // middle zeros ("1w 0d 0h 0m 5s") while still dropping the leading ones. Seconds
    // print unconditionally, so the result is never an empty string.
    const units: Array<[number, string]> = [
        [months, 'm'],
        [weeks, 'w'],
        [days, 'd'],
        [hours, 'h'],
        [minutes, 'm'],
    ];
    const parts: string[] = [];
    for (const [value, suffix] of units) {
        if (parts.length > 0 || value > 0) parts.push(`${value}${suffix}`);
    }
    parts.push(`${rest}s`);
    return parts.join(' ');
}
