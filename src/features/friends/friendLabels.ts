/**
 * Secondary-line copy for the friend screens (docs/FRIENDS_FEATURE.md).
 *
 * The error-message fallback. (The request lists' "Sent …" / "Received …" date lines and
 * the Remove list's "friends since" were dropped 2026-11-13; the leaderboard's
 * "20h 40m · 🇨🇳 CN" subtitle, `netMinutesLabel`, was replaced by the @handle 2026-11-22.)
 */

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
