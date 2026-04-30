/**
 * Minute points sync utilities — talks to the server for increment, new-day, and
 * timezone-aware bookkeeping.
 *
 * The server resolves "today" from (timestamp, tz) on every request. We never persist
 * a timezone server-side; the client supplies it on each call.
 */

import { API_BASE_URL } from '../constants';

/** Browser-resolved IANA timezone, with a UTC fallback. */
export function getBrowserTimezone(): string {
  try {
    return Intl.DateTimeFormat().resolvedOptions().timeZone || 'UTC';
  } catch {
    return 'UTC';
  }
}

/**
 * Increment minute points by exactly 1 (server-side rate-limited).
 */
export async function incrementMinutePoint(
  token?: string | null
): Promise<{ success: boolean; message: string }> {
  try {
    const response = await fetch(`${API_BASE_URL}/api/users/minute-points/increment`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        ...(token ? { 'Authorization': `Bearer ${token}` } : {}),
      },
      credentials: 'include',
      body: JSON.stringify({
        timestamp: new Date().toISOString(),
        tz: getBrowserTimezone(),
      }),
    });

    if (!response.ok) {
      const result = await response.json().catch(() => ({ error: response.statusText }));
      if (response.status === 400 && result.error?.includes('wait')) {
        return { success: false, message: result.error };
      }
      throw new Error(`Increment failed: ${result.error || response.statusText}`);
    }

    return { success: true, message: 'Minute point incremented' };
  } catch (error) {
    return {
      success: false,
      message: `Failed to increment minute point: ${error instanceof Error ? error.message : 'Unknown error'}`,
    };
  }
}

/**
 * Notify the server that a day boundary may have crossed.
 * The server resolves the streak day from (timestamp, tz) and applies a penalty
 * if the user missed two or more consecutive days. Idempotent.
 */
export async function newDayOperation(token?: string | null): Promise<void> {
  try {
    await fetch(`${API_BASE_URL}/api/users/minute-points/new-day`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        ...(token ? { 'Authorization': `Bearer ${token}` } : {}),
      },
      credentials: 'include',
      body: JSON.stringify({
        timestamp: new Date().toISOString(),
        tz: getBrowserTimezone(),
      }),
    });
  } catch {
    // Silent — best-effort
  }
}
