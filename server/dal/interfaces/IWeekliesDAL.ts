import { Weekly } from '../../types/weeklies.js';

/**
 * Data-access contract for per-user weekly achievement flags (the `weeklies`
 * table). Generic by design: `activity` is an opaque client-chosen key, so new
 * weekly achievements need no new methods.
 */
export interface IWeekliesDAL {
  /**
   * Record (or re-stamp) a weekly achievement for a user. Upserts on
   * (userId, activity): earning the same achievement again in the same week
   * bumps `achievedAt` rather than inserting a duplicate.
   */
  record(userId: string, activity: string): Promise<Weekly>;

  /** Remove a single weekly achievement for a user. No-op if absent. */
  remove(userId: string, activity: string): Promise<void>;

  /** List all of a user's weekly achievements (most recent first). */
  listByUser(userId: string): Promise<Weekly[]>;
}
