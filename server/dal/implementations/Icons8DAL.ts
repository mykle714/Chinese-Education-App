import { IIcons8DAL, Icons8Asset, Icons8Page, Icons8ListItem } from '../interfaces/IIcons8DAL.js';
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

  async iconExists(icons8Id: string): Promise<boolean> {
    if (!icons8Id) throw new ValidationError('icons8Id is required');

    const result = await dbManager.executeQuery<{ exists: boolean }>(async (client) => {
      // Mirror getAssetById: only downloaded icons (assetBytes NOT NULL) are pickable.
      return await client.query(`
        SELECT EXISTS (
          SELECT 1 FROM icons8 WHERE "icons8Id" = $1 AND "assetBytes" IS NOT NULL
        ) AS exists
      `, [icons8Id]);
    });

    return result.recordset[0]?.exists === true;
  }

  async listIcons(offset: number, limit: number): Promise<Icons8Page> {
    // Guard the pagination params so a bad query string can't trigger a huge scan or
    // a negative OFFSET error at the DB layer.
    const safeLimit = Math.min(Math.max(Math.trunc(limit) || 0, 1), 100);
    const safeOffset = Math.max(Math.trunc(offset) || 0, 0);

    const result = await dbManager.executeQuery<{ icons8id: string; name: string; total: string }>(async (client) => {
      // Window-function COUNT(*) OVER () returns the full match count alongside the
      // page slice in one round-trip (avoids a separate COUNT query). Stable order:
      // name then id, so offset paging never skips/repeats across requests.
      return await client.query(`
        SELECT "icons8Id" AS icons8id, name, COUNT(*) OVER () AS total
        FROM icons8
        WHERE "assetBytes" IS NOT NULL
        ORDER BY name ASC, "icons8Id" ASC
        LIMIT $1 OFFSET $2
      `, [safeLimit, safeOffset]);
    });

    const icons: Icons8ListItem[] = result.recordset.map(row => ({
      id: row.icons8id,
      name: row.name,
    }));
    // total is identical on every row of the window; 0 rows => empty page => total 0.
    const total = result.recordset.length > 0 ? parseInt(result.recordset[0].total, 10) : 0;

    return { icons, total, hasMore: safeOffset + icons.length < total };
  }
}
