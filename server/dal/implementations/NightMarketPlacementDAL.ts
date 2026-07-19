import { INightMarketPlacementDAL } from '../interfaces/INightMarketPlacementDAL.js';
import { dbManager } from '../base/DatabaseManager.js';
import { TemplatePlacementRow, PlacementOccupant } from '../../types/nightMarket.js';
import { ValidationError } from '../../types/dal.js';

/**
 * Night Market PLACEMENT DAL (migrations 112/113).
 *
 * Reads/writes `nightmarkettemplatelocations` (the per-user layout) and reads occupants from
 * `nightmarketunlocks` joined by placement. Pure persistence — version selection, seeding
 * policy, and definition loading live in NightMarketWorldService. See INightMarketPlacementDAL.
 */
export class NightMarketPlacementDAL implements INightMarketPlacementDAL {

  async findPlacementsByUser(userId: string): Promise<TemplatePlacementRow[]> {
    if (!userId) throw new ValidationError('User ID is required');

    const result = await dbManager.executeQuery<TemplatePlacementRow>(async (client) => {
      return await client.query(`
        SELECT id, "userId", "templateName", "activeVersion", "offsetCol", "offsetRow", "createdAt"
        FROM nightmarkettemplatelocations
        WHERE "userId" = $1
        ORDER BY "createdAt" ASC
      `, [userId]);
    });

    return result.recordset;
  }

  async countPlacementsByUser(userId: string): Promise<number> {
    if (!userId) throw new ValidationError('User ID is required');

    const result = await dbManager.executeQuery<{ count: string }>(async (client) => {
      return await client.query(
        'SELECT COUNT(*) AS count FROM nightmarkettemplatelocations WHERE "userId" = $1',
        [userId],
      );
    });

    return parseInt(result.recordset[0]?.count || '0', 10);
  }

  async insertPlacement(
    userId: string,
    templateName: string,
    activeVersion: number,
    offsetCol: number,
    offsetRow: number,
  ): Promise<TemplatePlacementRow> {
    if (!userId) throw new ValidationError('User ID is required');
    if (!templateName) throw new ValidationError('Template name is required');

    const result = await dbManager.executeQuery<TemplatePlacementRow>(async (client) => {
      return await client.query(`
        INSERT INTO nightmarkettemplatelocations
          ("userId", "templateName", "activeVersion", "offsetCol", "offsetRow")
        VALUES ($1, $2, $3, $4, $5)
        RETURNING id, "userId", "templateName", "activeVersion", "offsetCol", "offsetRow", "createdAt"
      `, [userId, templateName, activeVersion, offsetCol, offsetRow]);
    });

    return result.recordset[0];
  }

  async findOccupantsByUser(userId: string): Promise<PlacementOccupant[]> {
    if (!userId) throw new ValidationError('User ID is required');

    // Join unlocks (occupants) to their placement so we can filter by the placement's owner.
    // Occupant → placement is the placedTemplateId FK; the placement carries the userId.
    const result = await dbManager.executeQuery<PlacementOccupant>(async (client) => {
      return await client.query(`
        SELECT u."placedTemplateId", u."placeholderAreaId", u."assetId"
        FROM nightmarketunlocks u
        JOIN nightmarkettemplatelocations l ON l.id = u."placedTemplateId"
        WHERE l."userId" = $1
      `, [userId]);
    });

    return result.recordset;
  }

  async countOccupantsByUser(userId: string): Promise<number> {
    if (!userId) throw new ValidationError('User ID is required');

    const result = await dbManager.executeQuery<{ count: string }>(async (client) => {
      return await client.query(
        `SELECT COUNT(*) AS count
         FROM nightmarketunlocks u
         JOIN nightmarkettemplatelocations l ON l.id = u."placedTemplateId"
         WHERE l."userId" = $1`,
        [userId],
      );
    });

    return parseInt(result.recordset[0]?.count || '0', 10);
  }

  async insertOccupant(
    userId: string,
    placedTemplateId: string,
    placeholderAreaId: string,
    assetId: string,
  ): Promise<void> {
    if (!userId) throw new ValidationError('User ID is required');
    if (!placedTemplateId) throw new ValidationError('Placement ID is required');
    if (!placeholderAreaId) throw new ValidationError('Placeholder area ID is required');
    if (!assetId) throw new ValidationError('Asset ID is required');

    // userId is denormalized onto the occupant row (NOT NULL); unlockType/unlockOrder/createdAt
    // keep their column defaults ('stall' / 0 / now). The UNIQUE (placedTemplateId,
    // placeholderAreaId) index guards against filling an already-occupied slot.
    await dbManager.executeQuery(async (client) => {
      return await client.query(
        `INSERT INTO nightmarketunlocks ("userId", "assetId", "placedTemplateId", "placeholderAreaId")
         VALUES ($1, $2, $3, $4)`,
        [userId, assetId, placedTemplateId, placeholderAreaId],
      );
    });
  }

  async deleteSurplusOccupants(userId: string, keep: number): Promise<number> {
    if (!userId) throw new ValidationError('User ID is required');
    const keepCount = Math.max(0, Math.floor(keep));

    // Keep the oldest `keepCount` occupants (ORDER BY createdAt ASC ... OFFSET keepCount selects
    // everything AFTER them — i.e. the newest surplus — to delete). userId is denormalized on the
    // row, so no join is needed.
    const result = await dbManager.executeQuery(async (client) => {
      return await client.query(
        `DELETE FROM nightmarketunlocks
         WHERE id IN (
           SELECT id FROM nightmarketunlocks
           WHERE "userId" = $1
           ORDER BY "createdAt" ASC, id ASC
           OFFSET $2
         )`,
        [userId, keepCount],
      );
    });

    return result.rowsAffected;
  }

  async updateActiveVersion(placementId: string, activeVersion: number): Promise<void> {
    if (!placementId) throw new ValidationError('Placement ID is required');

    await dbManager.executeQuery(async (client) => {
      return await client.query(
        'UPDATE nightmarkettemplatelocations SET "activeVersion" = $2 WHERE id = $1',
        [placementId, activeVersion],
      );
    });
  }

  async deletePlacements(userId: string, placementIds: string[]): Promise<number> {
    if (!userId) throw new ValidationError('User ID is required');
    if (placementIds.length === 0) return 0;

    // Delete the named placements, re-asserting ownership via userId so a stray/foreign id can
    // never remove another user's template. Occupants (nightmarketunlocks) cascade automatically.
    const result = await dbManager.executeQuery(async (client) => {
      return await client.query(
        `DELETE FROM nightmarkettemplatelocations
         WHERE "userId" = $1 AND id = ANY($2::uuid[])`,
        [userId, placementIds],
      );
    });

    return result.rowsAffected;
  }
}
