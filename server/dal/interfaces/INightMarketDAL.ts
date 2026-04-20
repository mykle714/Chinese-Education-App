import { NightMarketUnlock } from '../../types/nightMarket.js';

/**
 * Night Market Data Access Layer interface
 * Defines contract for night market unlock persistence operations
 */
export interface INightMarketDAL {
  /** Get all unlocks for a user, ordered by unlockOrder */
  findByUserId(userId: string): Promise<NightMarketUnlock[]>;

  /** Get count of earned unlocks (unlockOrder > 0) for a user */
  getEarnedUnlockCount(userId: string): Promise<number>;

  /** Insert a single unlock record */
  createUnlock(userId: string, assetId: string, unlockType: string, unlockOrder: number): Promise<NightMarketUnlock>;

  /** Insert multiple unlock records at once (used for base set seeding) */
  createBulkUnlocks(unlocks: Array<{ userId: string; assetId: string; unlockType: string; unlockOrder: number }>): Promise<NightMarketUnlock[]>;

  /** Check if user has any unlock records (to determine if base set needs seeding) */
  hasAnyUnlocks(userId: string): Promise<boolean>;

  /** Get all assetIds already unlocked by a user (for exclusion during random selection) */
  getUnlockedAssetIds(userId: string): Promise<string[]>;
}
