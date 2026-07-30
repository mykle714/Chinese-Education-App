import { INightMarketPlacementDAL } from '../interfaces/INightMarketPlacementDAL.js';
import { dbManager as defaultDbManager, DatabaseManager } from '../base/DatabaseManager.js';
import { TemplatePlacementRow, PlacementOccupant } from '../../types/nightMarket.js';
import { ValidationError } from '../../types/dal.js';

/**
 * Night Market PLACEMENT DAL (migrations 112/113).
 *
 * Reads/writes `nightmarkettemplatelocations` (the layout) and occupants in
 * `nightmarketunlocks`. Pure persistence — version selection, seeding policy, and definition
 * loading live in NightMarketWorldService. See INightMarketPlacementDAL.
 *
 * SCOPED BY (userId, language) since migration 136. A user has one INDEPENDENT market per
 * language they study: separate placements, separate occupants, each with its own starter hub
 * at the origin. Every method here therefore takes a `language` — a query that filters on
 * userId alone would mix two markets' geometry into one coordinate space and render templates
 * on top of each other.
 */
export class NightMarketPlacementDAL implements INightMarketPlacementDAL {

  /**
   * The connection manager, injected so the DAL can be substituted in a test.
   * Defaults to the process-wide singleton, so `new NightMarketPlacementDAL()` at the composition
   * root (dal/setup.ts) keeps working unchanged.
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

    // Filter through the PLACEMENT's (userId, language) rather than the occupant's denormalized
    // copy: the placement is the authority for which market a slot belongs to, and joining keeps
    // this correct even if a denormalized occupant row were ever to drift.
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

    // userId and language are denormalized onto the occupant row (both NOT NULL);
    // unlockType/unlockOrder/createdAt keep their column defaults ('stall' / 0 / now). The
    // UNIQUE (placedTemplateId, placeholderAreaId) index guards against filling an
    // already-occupied slot — and because a placement belongs to exactly one market, that
    // slot uniqueness is already per-market. There is deliberately no (userId, assetId)
    // uniqueness: occupants share a generic assetId (see migration 114).
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

    // Keep the oldest `keepCount` occupants IN THIS MARKET (ORDER BY createdAt ASC ... OFFSET
    // keepCount selects everything AFTER them — i.e. the newest surplus — to delete). userId and
    // language are denormalized on the row, so no join is needed. Scoping by language matters:
    // without it, decaying the Spanish market would delete Chinese occupants.
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
    // never remove another user's template. Occupants (nightmarketunlocks) cascade automatically.
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
