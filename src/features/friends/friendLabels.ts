/**
 * Secondary-line copy for the friend screens (docs/FRIENDS_FEATURE.md).
 *
 * Both labels are defensive about their input: `friendsSince` is null for a row
 * whose `respondedAt` was never stamped, and every timestamp arrives as a string
 * from JSON, so an unparseable value must degrade to a sensible line rather than
 * rendering "Invalid Date".
 */

/** Format an ISO timestamp as a short local date, or null if it isn't one. */
function shortDate(iso: string | null | undefined): string | null {
    if (!iso) return null;
    const date = new Date(iso);
    if (Number.isNaN(date.getTime())) return null;
    return date.toLocaleDateString(undefined, { year: "numeric", month: "short", day: "numeric" });
}

/** "Friends since 3 Aug 2026" — falls back to a plain label when the date is missing. */
export function friendsSinceLabel(friendsSince: string | null): string {
    const formatted = shortDate(friendsSince);
    return formatted ? `Friends since ${formatted}` : "Friends";
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

/** "Sent 3 Aug 2026" / "Received 3 Aug 2026" for a pending request row. */
export function requestedAtLabel(requestedAt: string, direction: "incoming" | "outgoing"): string {
    const formatted = shortDate(requestedAt);
    const verb = direction === "incoming" ? "Received" : "Sent";
    return formatted ? `${verb} ${formatted}` : verb;
}
