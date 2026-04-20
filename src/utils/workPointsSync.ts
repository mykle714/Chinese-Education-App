/**
 * Work points sync utilities
 * Handles communication with the server for work points operations
 */

import { API_BASE_URL } from '../constants';

/**
 * Increment work points by exactly 1 (server-side rate-limited)
 */
export async function incrementWorkPoint(
  date: string,
  token?: string | null
): Promise<{ success: boolean; message: string }> {
  try {
    const response = await fetch(`${API_BASE_URL}/api/users/work-points/increment`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        ...(token ? { 'Authorization': `Bearer ${token}` } : {}),
      },
      credentials: 'include',
      body: JSON.stringify({ date })
    });

    if (!response.ok) {
      const result = await response.json().catch(() => ({ error: response.statusText }));
      if (response.status === 400 && result.error?.includes('wait')) {
        return { success: false, message: result.error };
      }
      throw new Error(`Increment failed: ${result.error || response.statusText}`);
    }

    return { success: true, message: 'Work point incremented' };
  } catch (error) {
    return {
      success: false,
      message: `Failed to increment work point: ${error instanceof Error ? error.message : 'Unknown error'}`
    };
  }
}

/**
 * Notify the server that a new day has started.
 * The server will reset the streak and apply a penalty if the user missed 2+ days.
 * Fire-and-forget; 204 means the server handled it.
 */
export async function newDayOperation(date: string, token?: string | null): Promise<void> {
  try {
    await fetch(`${API_BASE_URL}/api/users/work-points/new-day`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        ...(token ? { 'Authorization': `Bearer ${token}` } : {}),
      },
      credentials: 'include',
      body: JSON.stringify({ date })
    });
  } catch {
    // Intentionally silent — best-effort call
  }
}

/**
 * Get today's date in YYYY-MM-DD format (local timezone)
 */
export function getTodayDateString(): string {
  const now = new Date();
  const year = now.getFullYear();
  const month = (now.getMonth() + 1).toString().padStart(2, '0');
  const day = now.getDate().toString().padStart(2, '0');
  return `${year}-${month}-${day}`;
}
