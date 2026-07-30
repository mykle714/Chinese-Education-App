import { INightMarketPlacementDAL } from '../interfaces/INightMarketPlacementDAL.js';
import { dbManager as defaultDbManager, DatabaseManager } from '../base/DatabaseManager.js';
import { TemplatePlacementRow, PlacementOccupant } from '../../types/nightMarket.js';
import { ValidationError } from '../../types/dal.js';

/**
 * Night Market PLACEMENT DAL (migrations 112/113; language dimension added by 130).
 *
 * Reads/writes `nightmarkettemplatelocations` (the per-user, per-LANGUAGE layout) and reads
 * occupants from `nightmarketunlocks` joined by placement. Pure persistence — version selection,
 * seeding policy, and definition loading live in NightMarketWorldService.
 * See INightMarketPlacementDAL.
 *
 * EVERY query is scoped to ONE MARKET, i.e. one (userId, language) pair. Each language grows its
 * own market funded by its own wallet (docs/PER_LANGUAGE_STREAKS.md), so a query missing the
 * language predicate would bleed one language's stalls into another's layout. The unique corner
 * index is (userId, language, offsetCol, offsetRow), so the same grid corner can legitimately host
 * a stall in each language's market.
 */
export class NightMarketPlacementDAL implements INightMarketPlacementDAL {
  /**
   * The connection manager, injected so the DAL can be substituted in a test.
   * Defaults to the process-wide singleton, so `new NightMarketPlacementDAL()` at the
   * composition root (dal/setup.ts) keeps working unchanged.
   * See docs/CORRECTNESS_AND_PERFORMANCE_REVIEW.md finding 2.
   */
  constructor(protected readonly dbManager: DatabaseManager = defaultDbManager) {}


  async findPlacementsByUser(userId: string, language: string): Promise<TemplatePlacementRow[]> {
    if (!userId) throw new ValidationError('User ID is required');
    if (!language) throw new ValidationError('Language is required');

    const result = await this.dbManager.executeQuery<TemplatePlacementRow>(async (client) => {
      return await client.query(`
        SELECT id, "userId", language, "templateName", "activeVersion", "offsetCol", "offsetRow", "createdAt"
        FROM nightmarkettemplatelocations
        WHERE "userId" = $1 AND language = $2
        ORDER BY "createdAt" ASC
      `, [userId, language]);
    });

    return result.recordset;
  }

  async countPlacementsByUser(userId: string, language: string): Promise<number> {
    if (!userId) throw new ValidationError('User ID is required');
    if (!language) throw new ValidationError('Language is required');

    const result = await this.dbManager.executeQuery<{ count: string }>(async (client) => {
      return await client.query(
        'SELECT COUNT(*) AS count FROM nightmarkettemplatelocations WHERE "userId" = $1 AND language = $2',
        [userId, language],
      );
    });

    return parseInt(result.recordset[0]?.count || '0', 10);
  }

  async insertPlacement(
    userId: string,
    language: string,
    templateName: string,
    activeVersion: number,
    offsetCol: number,
    offsetRow: number,
  ): Promise<TemplatePlacementRow> {
    if (!userId) throw new ValidationError('User ID is required');
    if (!language) throw new ValidationError('Language is required');
    if (!templateName) throw new ValidationError('Template name is required');

    const result = await this.dbManager.executeQuery<TemplatePlacementRow>(async (client) => {
      return await client.query(`
        INSERT INTO nightmarkettemplatelocations
          ("userId", language, "templateName", "activeVersion", "offsetCol", "offsetRow")
        VALUES ($1, $2, $3, $4, $5, $6)
        RETURNING id, "userId", language, "templateName", "activeVersion", "offsetCol", "offsetRow", "createdAt"
      `, [userId, language, templateName, activeVersion, offsetCol, offsetRow]);
    });

    return result.recordset[0];
  }

  async findOccupantsByUser(userId: string, language: string): Promise<PlacementOccupant[]> {
    if (!userId) throw new ValidationError('User ID is required');
    if (!language) throw new ValidationError('Language is required');

    // Join unlocks (occupants) to their placement so we can filter by the placement's owner.
    // Occupant → placement is the placedTemplateId FK; the placement carries the userId. The
    // language predicate is applied to the PLACEMENT (the authoritative side) — the occupant's
    // own denormalized language must agree, and does, since both are written together.
    const result = await this.dbManager.executeQuery<PlacementOccupant>(async (client) => {
      return await client.query(`
        SELECT u."placedTemplateId", u."placeholderAreaId", u."assetId"
        FROM nightmarketunlocks u
        JOIN nightmarkettemplatelocations l ON l.id = u."placedTemplateId"
        WHERE l."userId" = $1 AND l.language = $2
      `, [userId, language]);
    });

    return result.recordset;
  }

  async countOccupantsByUser(userId: string, language: string): Promise<number> {
    if (!userId) throw new ValidationError('User ID is required');
    if (!language) throw new ValidationError('Language is required');

    const result = await this.dbManager.executeQuery<{ count: string }>(async (client) => {
      return await client.query(
        `SELECT COUNT(*) AS count
         FROM nightmarketunlocks u
         JOIN nightmarkettemplatelocations l ON l.id = u."placedTemplateId"
         WHERE l."userId" = $1 AND l.language = $2`,
        [userId, language],
      );
    });

    return parseInt(result.recordset[0]?.count || '0', 10);
  }

  async insertOccupant(
    userId: string,
    language: string,
    placedTemplateId: string,
    placeholderAreaId: string,
    assetId: string,
  ): Promise<void> {
    if (!userId) throw new ValidationError('User ID is required');
    if (!language) throw new ValidationError('Language is required');
    if (!placedTemplateId) throw new ValidationError('Placement ID is required');
    if (!placeholderAreaId) throw new ValidationError('Placeholder area ID is required');
    if (!assetId) throw new ValidationError('Asset ID is required');

    // userId and language are denormalized onto the occupant row (both NOT NULL) so the decay cron
    // can partition by (userId, language) without joining the placement table;
    // unlockType/unlockOrder/createdAt keep their column defaults ('stall' / 0 / now). The UNIQUE
    // (placedTemplateId, placeholderAreaId) index guards against filling an occupied slot.
    await this.dbManager.executeQuery(async (client) => {
      return await client.query(
        `INSERT INTO nightmarketunlocks ("userId", language, "assetId", "placedTemplateId", "placeholderAreaId")
         VALUES ($1, $2, $3, $4, $5)`,
        [userId, language, assetId, placedTemplateId, placeholderAreaId],
      );
    });
  }

  async deleteSurplusOccupants(userId: string, language: string, keep: number): Promise<number> {
    if (!userId) throw new ValidationError('User ID is required');
    if (!language) throw new ValidationError('Language is required');
    const keepCount = Math.max(0, Math.floor(keep));

    // Keep the oldest `keepCount` occupants OF THIS LANGUAGE (ORDER BY createdAt ASC ... OFFSET
    // keepCount selects everything AFTER them — i.e. the newest surplus — to delete). Both userId
    // and language are denormalized on the row, so no join is needed. Scoping by language is what
    // stops a Spanish decay from trimming Chinese stalls.
    const result = await this.dbManager.executeQuery(async (client) => {
      return await client.query(
        `DELETE FROM nightmarketunlocks
         WHERE id IN (
           SELECT id FROM nightmarketunlocks
           WHERE "userId" = $1 AND language = $2
           ORDER BY "createdAt" ASC, id ASC
           OFFSET $3
         )`,
        [userId, language, keepCount],
      );
    });

    return result.rowsAffected;
  }

  async updateActiveVersion(placementId: string, activeVersion: number): Promise<void> {
    if (!placementId) throw new ValidationError('Placement ID is required');

    // Keyed by the placement's own id, which is already unique across all markets — no
    // language predicate needed or wanted here.
    await this.dbManager.executeQuery(async (client) => {
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
    // never remove another user's template. Ids are globally unique so no language predicate is
    // needed; callers already sourced these ids from a single market's placement list.
    // Occupants (nightmarketunlocks) cascade automatically.
    const result = await this.dbManager.executeQuery(async (client) => {
      return await client.query(
        `DELETE FROM nightmarkettemplatelocations
         WHERE "userId" = $1 AND id = ANY($2::uuid[])`,
        [userId, placementIds],
      );
    });

    return result.rowsAffected;
  }
}
