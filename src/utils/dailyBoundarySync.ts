/**
 * Daily boundary utilities
 * Detects when the calendar day changes and notifies the server.
 */

import { newDayOperation, getTodayDateString } from './workPointsSync';
import { type WorkPointsStorage } from './workPointsStorage';

/**
 * Notify the server of the current date on every app load.
 * The server's newDayOperation is idempotent — it returns early cheaply when no day has passed,
 * so we skip the local date guard and always call it.
 *
 * Separately, signal whether the local daily timer should reset (UI concern only).
 */
export async function checkAndSyncDailyReset(
  _userId: string,
  data: WorkPointsStorage
): Promise<{ shouldReset: boolean }> {
  const todayDateString = getTodayDateString();

  // Always notify the server — it decides if a streak penalty applies
  await newDayOperation(todayDateString);

  // Determine if the local daily timer should reset (last activity was a prior calendar day)
  const lastActivityDate = new Date(data.lastActivity).toDateString();
  const today = new Date().toDateString();
  return { shouldReset: lastActivityDate !== today };
}
