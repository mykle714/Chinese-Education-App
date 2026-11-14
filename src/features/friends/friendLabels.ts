/**
 * Secondary-line copy for the friend screens (docs/FRIENDS_FEATURE.md).
 *
 * The leaderboard subtitle and the error-message fallback. (The request lists' "Sent …" /
 * "Received …" date lines and the Remove list's "friends since" were dropped 2026-11-13.)
 */
import { LANGUAGE_FLAGS, languageRegionCode } from "../../types";
import { formatMinutesAsDuration } from "../../utils/formatDuration";
import type { Language } from "../../types";

/**
 * The leaderboard subtitle: "20h 40m · 🇨🇳 CN".
 *
 * The FIGURE is the NET wallet — `user_languages.totalMinutePoints`, which the
 * inactivity penalty debits (docs/STREAK_EXPIRATION_CRON.md) — not the monotonic
 * `lifetimeMinutesEarned`. Keep that in mind when changing what this formats, because
 * the two figures drift apart for any learner who has ever been penalised.
 *
 * A minute point IS a minute of study, so the balance renders as a DURATION
 * (`formatMinutesAsDuration`, weeks enabled) rather than a bare count: "3w 2d 4h 10m"
 * sizes up at a glance where "32,650 minutes" does not, which is the whole job of a
 * column being compared across rows.
 *
 * The language is shown as flag + REGION CODE, not its name: the row is a compact
 * scoreboard line, and the code carries the same identification in a third of the
 * width. Both come from the same source (`languageRegionCode` decodes the flag), so
 * they cannot disagree — and on Windows, which draws no flag glyph, the badge still
 * reads as letters rather than vanishing. See docs/FRIENDS_FEATURE.md § Leaderboard.
 */
export function netMinutesLabel(netMinutes: number, language: string): string {
    const minutes = formatMinutesAsDuration(netMinutes, { weeks: true });
    // An unknown language (a value this client build doesn't know yet) has no flag and
    // no region code, so it degrades to its own raw code rather than rendering "".
    const flag = LANGUAGE_FLAGS[language as Language] ?? "";
    const code = languageRegionCode(language as Language) || language.toUpperCase();
    return `${minutes} · ${flag}${flag ? " " : ""}${code}`;
}

/**
 * User-facing message for a rejected friends API call.
 *
 * src/api/friends.ts already wraps every call in `withFallback`, so an ApiError
 * arrives carrying either the server's message ("You are already friends with this
 * user") or that fallback. `fallback` here only covers a non-Error rejection,
 * which shouldn't happen but must not render "[object Object]" if it does.
 */
export function friendErrorMessage(err: unknown, fallback: string): string {
    return err instanceof Error && err.message ? err.message : fallback;
}
