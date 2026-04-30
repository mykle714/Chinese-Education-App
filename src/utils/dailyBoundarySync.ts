/**
 * Daily boundary utilities.
 *
 * On every app load we ping the server's new-day endpoint. The server is the
 * source of truth for streak breaks and is idempotent — it returns early
 * cheaply when no boundary has been crossed.
 *
 * Locally we also signal whether the in-memory daily timer should reset (UI only).
 */

import { newDayOperation } from './minutePointsSync';
import { type MinutePointsStorage } from './minutePointsStorage';

export async function checkAndSyncDailyReset(
  _userId: string,
  data: MinutePointsStorage,
  token?: string | null
): Promise<{ shouldReset: boolean }> {
  // Always notify the server.
  await newDayOperation(token);

  // Reset the local timer if the last activity was on a prior calendar day.
  const lastActivityDate = new Date(data.lastActivity).toDateString();
  const today = new Date().toDateString();
  return { shouldReset: lastActivityDate !== today };
}
