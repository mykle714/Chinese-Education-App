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

/** Per-language snapshot powering the home screen + fire badge. */
export interface LanguageMinuteSummary {
  totalMinutePoints: number; // lifetime minutes for this language
  todayMinutes: number;      // minutes earned today (4 AM-local day) for this language
  currentStreak: number;     // GLOBAL streak (not language-scoped)
}

/**
 * Fetch the per-language minute-points summary for the selected language.
 * The server attributes minutes by the user's selectedLanguage; we pass the
 * language explicitly so a just-switched (not-yet-persisted) selection still
 * reads the right bucket, plus tz/timestamp so "today" resolves in local time.
 */
export async function fetchLanguageSummary(
  language: string,
  token?: string | null
): Promise<LanguageMinuteSummary | null> {
  try {
    const params = new URLSearchParams({
      language,
      tz: getBrowserTimezone(),
      timestamp: new Date().toISOString(),
    });
    const response = await fetch(`${API_BASE_URL}/api/users/minute-points/summary?${params.toString()}`, {
      headers: token ? { Authorization: `Bearer ${token}` } : {},
      credentials: 'include',
    });
    if (response.ok) {
      return (await response.json()) as LanguageMinuteSummary;
    }
  } catch {
    // Intentionally silent — caller falls back to local storage.
  }
  return null;
}

/**
 * Increment minute points by exactly 1 (server-side rate-limited).
 */
export async function incrementMinutePoint(
  language: string,
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
        // Attribute the minute to the language this hook accrued for — matches
        // the badge/localStorage the client already incremented optimistically.
        language,
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

