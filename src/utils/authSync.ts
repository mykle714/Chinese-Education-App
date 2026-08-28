/**
 * Post-login client hooks — keeps the server's copy of the user's IANA timezone
 * (`users.timezone`) in step with the browser's.
 *
 * WHY THIS MATTERS. Every day/week boundary in the app is 04:00 in the user's
 * stored zone: the streak-expiration cron, the AI usage day, and — the visible
 * one — the study-challenge accept/test windows. Those windows are computed
 * server-side from `users.timezone` and shipped as ABSOLUTE instants, which the
 * client then formats in the BROWSER's zone. When the two disagree the user sees
 * a boundary at the wrong hour ("test opens 9 PM Thursday" for a Friday 04:00
 * window computed in UTC for a UTC−7 viewer), with nothing on screen to explain
 * it. The column is NOT NULL DEFAULT 'UTC', so an account that has never been
 * through here reads as a UTC user.
 *
 * THE FRESHNESS CONTRACT — four triggers, deliberately overlapping:
 *   1. account creation (`POST /api/auth/register` sends `tz`);
 *   2. login + session restore (`notifyLogin` below);
 *   3. every access-token rotation (`utils/tokenRefresh.ts`, ~15 min) — the only
 *      trigger that catches a zone changing mid-session;
 *   4. a foregrounded tab whose zone no longer matches what it last sent
 *      (`syncTimezoneIfChanged` below).
 * The minute-point paths refresh it server-side as well, but only for users who
 * actually study — which is exactly the set this file exists to widen.
 *
 * Still best-effort: no user-visible flow blocks on it. It is no longer SILENT,
 * though — the one failure it can hide is a user stranded on the wrong clock, so
 * failures go to the auth log.
 */

import { API_BASE_URL } from '../constants';
import { getBrowserTimezone } from './browserTimezone';
import { authError, authLog } from './authDebug';

/**
 * The zone this tab last successfully sent, so the visibility hook can send only
 * on a real change. Module-scoped rather than persisted: a fresh page load goes
 * through `notifyLogin` anyway, so the only thing a stored value would buy is the
 * risk of trusting a write that never landed.
 */
let lastSentTimezone: string | null = null;

export async function notifyLogin(token?: string | null): Promise<void> {
  const tz = getBrowserTimezone();
  try {
    const response = await fetch(`${API_BASE_URL}/api/auth/onLogin`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        ...(token ? { 'Authorization': `Bearer ${token}` } : {}),
      },
      credentials: 'include',
      body: JSON.stringify({ tz }),
    });
    if (!response.ok) {
      // Not thrown: the session is fine, only the clock is stale. Logged because
      // the symptom downstream (a deadline shown at the wrong hour) is otherwise
      // impossible to trace back to here.
      authError('notifyLogin: timezone sync REJECTED', { status: response.status, tz });
      return;
    }
    lastSentTimezone = tz;
    authLog('notifyLogin: timezone synced', { tz });
  } catch (e) {
    authError('notifyLogin: timezone sync failed', e);
  }
}

/**
 * Re-send the timezone if this tab's zone has changed since it last sent one.
 *
 * For the long-lived tab: a session that never re-logs in and never rotates a
 * token while backgrounded can otherwise sit for days on a zone the user has
 * left. Change-detected, so the common case costs one `Intl` lookup and no
 * request.
 *
 * Note it fires on the zone the BROWSER reports, which also shifts when a user
 * changes their OS setting — that is intended; the browser is the authority on
 * what clock the user is reading.
 */
export async function syncTimezoneIfChanged(token?: string | null): Promise<void> {
  const tz = getBrowserTimezone();
  if (tz === lastSentTimezone) return;
  await notifyLogin(token);
}
