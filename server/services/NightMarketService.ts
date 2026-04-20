import { INightMarketDAL } from '../dal/interfaces/INightMarketDAL.js';
import { IUserDAL } from '../dal/interfaces/IUserDAL.js';
import { NightMarketUnlock, NightMarketUnlocksResponse, NightMarketNewUnlockResponse } from '../types/nightMarket.js';
import { NIGHT_MARKET_BASE_SET, NIGHT_MARKET_UNLOCK_POOL, NIGHT_MARKET_CONFIG } from '../config/nightMarketRegistry.js';
import { ValidationError } from '../types/dal.js';

/**
 * Night Market Service
 * Business logic for the night market unlock system:
 * - Base set seeding on first visit
 * - Threshold verification against work points
 * - Random item selection from the unlock pool
 */
export class NightMarketService {
  constructor(
    private nightMarketDAL: INightMarketDAL,
    private userDAL: IUserDAL
  ) {}

  /**
   * Get all unlocks for a user. Seeds the base set if this is the user's first visit.
   * Called by GET /api/night-market/unlocks
   */
  async getUnlocks(userId: string): Promise<NightMarketUnlocksResponse> {
    // Seed base set on first visit
    const hasUnlocks = await this.nightMarketDAL.hasAnyUnlocks(userId);
    if (!hasUnlocks) {
      await this.seedBaseSet(userId);
    }

    const unlocks = await this.nightMarketDAL.findByUserId(userId);
    const earnedCount = unlocks.filter(u => u.unlockOrder > 0).length;
    const nextThreshold = (earnedCount + 1) * NIGHT_MARKET_CONFIG.POINTS_PER_UNLOCK;

    return {
      unlocks,
      nextThreshold,
      totalUnlockable: NIGHT_MARKET_UNLOCK_POOL.length,
    };
  }

  /**
   * Attempt to unlock the next random item.
   * Verifies the user has enough work points, picks a random asset
   * not yet unlocked, persists the selection, and returns it.
   * Called by POST /api/night-market/unlock
   */
  async unlockNext(userId: string): Promise<NightMarketNewUnlockResponse> {
    // Get user's total work points from the server-authoritative source
    const { totalWorkPoints } = await this.userDAL.getTotalWorkPoints(userId);

    // Calculate how many earned unlocks this user is allowed
    const allowedUnlocks = Math.floor(totalWorkPoints / NIGHT_MARKET_CONFIG.POINTS_PER_UNLOCK);

    // Get current earned unlock count
    const earnedCount = await this.nightMarketDAL.getEarnedUnlockCount(userId);

    // Verify the user has earned enough points for a new unlock
    if (earnedCount >= allowedUnlocks) {
      throw new ValidationError(
        `Not enough work points for next unlock. Need ${(earnedCount + 1) * NIGHT_MARKET_CONFIG.POINTS_PER_UNLOCK} points, have ${totalWorkPoints}.`
      );
    }

    // Get already-unlocked asset IDs to exclude from the pool
    const unlockedAssetIds = await this.nightMarketDAL.getUnlockedAssetIds(userId);
    const unlockedSet = new Set(unlockedAssetIds);

    // Filter pool to only items not yet owned
    const available = NIGHT_MARKET_UNLOCK_POOL.filter(asset => !unlockedSet.has(asset.assetId));

    if (available.length === 0) {
      throw new ValidationError('All night market items have been unlocked!');
    }

    // Pick a random item from the available pool
    const randomIndex = Math.floor(Math.random() * available.length);
    const selectedAsset = available[randomIndex];

    // Persist the unlock with the next unlockOrder
    const newUnlockOrder = earnedCount + 1;
    const unlock = await this.nightMarketDAL.createUnlock(
      userId,
      selectedAsset.assetId,
      selectedAsset.unlockType,
      newUnlockOrder
    );

    // Calculate next threshold after this unlock
    const nextThreshold = (newUnlockOrder + 1) * NIGHT_MARKET_CONFIG.POINTS_PER_UNLOCK;

    return { unlock, nextThreshold };
  }

  /**
   * Seed the base set for a new user.
   * Bulk-inserts all NIGHT_MARKET_BASE_SET items with unlockOrder = 0.
   */
  private async seedBaseSet(userId: string): Promise<NightMarketUnlock[]> {
    if (NIGHT_MARKET_BASE_SET.length === 0) return [];

    const bulkData = NIGHT_MARKET_BASE_SET.map(asset => ({
      userId,
      assetId: asset.assetId,
      unlockType: asset.unlockType,
      unlockOrder: 0,
    }));

    return await this.nightMarketDAL.createBulkUnlocks(bulkData);
  }
}
