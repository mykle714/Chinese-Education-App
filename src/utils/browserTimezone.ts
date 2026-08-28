/**
 * The browser's IANA timezone — one lookup, one fallback, used app-wide.
 *
 * Lived in `minutePoints/minutePointsSync.ts` until 2026-08-28, which was its
 * address rather than its subject: five of its callers (auth, token refresh,
 * dictionary search, word compare, the streak-day helper) have nothing to do with
 * minute points, and a shared util under a feature directory reads as a private
 * one that someone reached into. Nothing about the behaviour changed in the move.
 *
 * Every server-side day/week boundary in the app is 04:00 in the user's zone, and
 * this is where the client's answer to "which zone is that" comes from — both for
 * the requests that carry `tz` per call (minute points, dictionary AI usage) and
 * for the writes that keep `users.timezone` fresh (see `utils/authSync.ts`).
 *
 * The `try/catch` is not defensive padding: `Intl.DateTimeFormat()` can throw in
 * a locked-down or exotic runtime, and callers use the result to build a request
 * body. Falling back to 'UTC' matches the `users.timezone` column default, so the
 * failure mode is "the server's existing default", never a thrown request.
 */
export function getBrowserTimezone(): string {
  try {
    return Intl.DateTimeFormat().resolvedOptions().timeZone || 'UTC';
  } catch {
    return 'UTC';
  }
}
