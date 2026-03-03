/**
 * Daily boundary utilities
 * Detects when the calendar day changes and notifies the server.
 */

import { newDayOperation, getTodayDateString } from './workPointsSync';
import { type WorkPointsStorage } from './workPointsStorage';

/**
 * Check if a daily reset is needed.
 * If the last activity was on a different calendar day, call the server's new-day endpoint
 * (which handles streak penalty logic) and signal that today's counters should reset.
 */
export async function checkAndSyncDailyReset(
  _userId: string,
  data: WorkPointsStorage
): Promise<{ shouldReset: boolean }> {
  const lastActivityDate = new Date(data.lastActivity).toDateString();
  const today = new Date().toDateString();

  if (lastActivityDate !== today) {
    const todayDateString = getTodayDateString();
    await newDayOperation(todayDateString);
    return { shouldReset: true };
  }

  return { shouldReset: false };
}
