import { INightMarketDAL } from '../interfaces/INightMarketDAL.js';
import { dbManager } from '../base/DatabaseManager.js';
import { NightMarketUnlock } from '../../types/nightMarket.js';
import { ValidationError } from '../../types/dal.js';

/**
 * Night Market Data Access Layer implementation
 *
 * ⚠️ The legacy asset-unlock write methods were RETIRED (2026-07-17) — migrations 112/113
 * repurposed `nightmarketunlocks` for the template-placement occupant model, so the old
 * INSERTs (`assetId`/`unlockType`/`unlockOrder` only) can no longer satisfy the NOT NULL
 * `placedTemplateId`/`placeholderAreaId` columns. Only the legacy read remains. See
 * NightMarketService header; the occupant DAL arrives in Slice 3/4.
 */
export class NightMarketDAL implements INightMarketDAL {

  /**
   * Legacy read: all unlock rows for a user, ordered by unlockOrder.
   * The old value columns still exist on the table, so this SELECT is still valid; it is
   * retained for back-compat/debugging but is no longer on the live request path.
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
}
