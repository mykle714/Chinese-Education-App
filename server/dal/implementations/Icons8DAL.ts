import { IIcons8DAL, Icons8Asset } from '../interfaces/IIcons8DAL.js';
import { dbManager } from '../base/DatabaseManager.js';
import { ValidationError } from '../../types/dal.js';

/**
 * Data Access Layer for the `icons8` table (downloaded icons8 icons + their v5
 * search-API metadata; see migration 71). Currently read-only — population happens
 * via a backfill script, not the request path.
 */
export class Icons8DAL implements IIcons8DAL {
  async getAssetById(icons8Id: string): Promise<Icons8Asset | null> {
    if (!icons8Id) throw new ValidationError('icons8Id is required');

    const result = await dbManager.executeQuery<Icons8Asset>(async (client) => {
      // Only return rows that actually have bytes — an icon row can exist as
      // metadata-only (assetBytes NULL) before it has been downloaded.
      return await client.query(`
        SELECT "assetBytes", "downloadedFormat"
        FROM icons8
        WHERE "icons8Id" = $1 AND "assetBytes" IS NOT NULL
      `, [icons8Id]);
    });

    return result.recordset[0] ?? null;
  }
}
