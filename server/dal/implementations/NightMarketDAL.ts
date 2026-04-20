import { INightMarketDAL } from '../interfaces/INightMarketDAL.js';
import { dbManager } from '../base/DatabaseManager.js';
import { NightMarketUnlock } from '../../types/nightMarket.js';
import { ValidationError } from '../../types/dal.js';

/**
 * Night Market Data Access Layer implementation
 * Handles all database operations for nightmarketunlocks table
 */
export class NightMarketDAL implements INightMarketDAL {

  /**
   * Get all unlocks for a user, ordered by unlockOrder
   */
  async findByUserId(userId: string): Promise<NightMarketUnlock[]> {
    if (!userId) {
      throw new ValidationError('User ID is required');
    }

    const result = await dbManager.executeQuery<NightMarketUnlock>(async (client) => {
      return await client.query(`
        SELECT id, "userId", "assetId", "unlockType", "unlockOrder", "createdAt"
        FROM nightmarketunlocks
        WHERE "userId" = $1
        ORDER BY "unlockOrder" ASC, "createdAt" ASC
      `, [userId]);
    });

    return result.recordset;
  }

  /**
   * Get count of earned unlocks (unlockOrder > 0) for a user
   */
  async getEarnedUnlockCount(userId: string): Promise<number> {
    if (!userId) {
      throw new ValidationError('User ID is required');
    }

    const result = await dbManager.executeQuery<{ count: string }>(async (client) => {
      return await client.query(`
        SELECT COUNT(*) as count
        FROM nightmarketunlocks
        WHERE "userId" = $1 AND "unlockOrder" > 0
      `, [userId]);
    });

    return parseInt(result.recordset[0]?.count || '0', 10);
  }

  /**
   * Insert a single unlock record
   */
  async createUnlock(userId: string, assetId: string, unlockType: string, unlockOrder: number): Promise<NightMarketUnlock> {
    if (!userId) throw new ValidationError('User ID is required');
    if (!assetId) throw new ValidationError('Asset ID is required');
    if (!unlockType) throw new ValidationError('Unlock type is required');

    const result = await dbManager.executeQuery<NightMarketUnlock>(async (client) => {
      return await client.query(`
        INSERT INTO nightmarketunlocks ("userId", "assetId", "unlockType", "unlockOrder")
        VALUES ($1, $2, $3, $4)
        RETURNING id, "userId", "assetId", "unlockType", "unlockOrder", "createdAt"
      `, [userId, assetId, unlockType, unlockOrder]);
    });

    return result.recordset[0];
  }

  /**
   * Insert multiple unlock records at once (used for base set seeding).
   * Uses a single INSERT with multi-row VALUES for efficiency.
   */
  async createBulkUnlocks(unlocks: Array<{ userId: string; assetId: string; unlockType: string; unlockOrder: number }>): Promise<NightMarketUnlock[]> {
    if (!unlocks.length) return [];

    // Build parameterized multi-row VALUES clause
    const values: unknown[] = [];
    const valueRows: string[] = [];
    unlocks.forEach((unlock, i) => {
      const offset = i * 4;
      valueRows.push(`($${offset + 1}, $${offset + 2}, $${offset + 3}, $${offset + 4})`);
      values.push(unlock.userId, unlock.assetId, unlock.unlockType, unlock.unlockOrder);
    });

    const result = await dbManager.executeQuery<NightMarketUnlock>(async (client) => {
      return await client.query(`
        INSERT INTO nightmarketunlocks ("userId", "assetId", "unlockType", "unlockOrder")
        VALUES ${valueRows.join(', ')}
        RETURNING id, "userId", "assetId", "unlockType", "unlockOrder", "createdAt"
      `, values);
    });

    return result.recordset;
  }

  /**
   * Check if user has any unlock records (to determine if base set needs seeding)
   */
  async hasAnyUnlocks(userId: string): Promise<boolean> {
    if (!userId) {
      throw new ValidationError('User ID is required');
    }

    const result = await dbManager.executeQuery<{ exists: boolean }>(async (client) => {
      return await client.query(`
        SELECT EXISTS(
          SELECT 1 FROM nightmarketunlocks WHERE "userId" = $1
        ) as exists
      `, [userId]);
    });

    return result.recordset[0]?.exists === true;
  }

  /**
   * Get all assetIds already unlocked by a user (for exclusion during random selection)
   */
  async getUnlockedAssetIds(userId: string): Promise<string[]> {
    if (!userId) {
      throw new ValidationError('User ID is required');
    }

    const result = await dbManager.executeQuery<{ assetId: string }>(async (client) => {
      return await client.query(`
        SELECT "assetId" FROM nightmarketunlocks WHERE "userId" = $1
      `, [userId]);
    });

    return result.recordset.map(row => row.assetId);
  }
}
