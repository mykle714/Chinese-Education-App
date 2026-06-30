/**
 * Post-login client hooks. Sends the browser's IANA timezone to the server so
 * the hourly streak-expiration cron can compute each user's local-day boundary
 * even when the user never crosses the minute-points threshold.
 *
 * Best-effort: failures are swallowed because no user-visible flow depends on
 * this succeeding.
 */

import { API_BASE_URL } from '../constants';
import { getBrowserTimezone } from '../minutePoints/minutePointsSync';

export async function notifyLogin(token?: string | null): Promise<void> {
  try {
    await fetch(`${API_BASE_URL}/api/auth/on-login`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        ...(token ? { 'Authorization': `Bearer ${token}` } : {}),
      },
      credentials: 'include',
      body: JSON.stringify({ tz: getBrowserTimezone() }),
    });
  } catch {
    // Silent — best-effort.
  }
}
