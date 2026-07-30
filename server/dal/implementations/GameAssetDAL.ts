import { IGameAssetDAL } from '../interfaces/IGameAssetDAL.js';
import { dbManager as defaultDbManager, DatabaseManager } from '../base/DatabaseManager.js';
import { GameAsset } from '../../types/games.js';
import { ValidationError } from '../../types/dal.js';

/**
 * Persists per-game asset metadata in the shared gameassets table.
 * Asset binaries themselves live on disk under server/public/games/<gameId>/.
 */
export class GameAssetDAL implements IGameAssetDAL {

  /**
   * The connection manager, injected so the DAL can be substituted in a test.
   * Defaults to the process-wide singleton, so `new GameAssetDAL()` at the composition
   * root (dal/setup.ts) keeps working unchanged.
   * See docs/CORRECTNESS_AND_PERFORMANCE_REVIEW.md finding 2.
   */
  constructor(protected readonly dbManager: DatabaseManager = defaultDbManager) {}

  async listByGameId(gameId: string): Promise<GameAsset[]> {
    if (!gameId) throw new ValidationError('gameId is required');

    const result = await this.dbManager.executeQuery<GameAsset>(async (client) => {
      return await client.query(`
        SELECT id, "gameId", "assetId", "displayName", "imagePath", "metadata", "createdAt"
        FROM gameassets
        WHERE "gameId" = $1
        ORDER BY "assetId" ASC
      `, [gameId]);
    });

    return result.recordset;
  }

  async upsert(asset: {
    gameId: string;
    assetId: string;
    displayName?: string | null;
    imagePath: string;
    metadata?: Record<string, unknown> | null;
  }): Promise<GameAsset> {
    if (!asset.gameId) throw new ValidationError('gameId is required');
    if (!asset.assetId) throw new ValidationError('assetId is required');
    if (!asset.imagePath) throw new ValidationError('imagePath is required');

    const result = await this.dbManager.executeQuery<GameAsset>(async (client) => {
      return await client.query(`
        INSERT INTO gameassets ("gameId", "assetId", "displayName", "imagePath", "metadata")
        VALUES ($1, $2, $3, $4, $5)
        ON CONFLICT ("gameId", "assetId") DO UPDATE SET
          "displayName" = EXCLUDED."displayName",
          "imagePath" = EXCLUDED."imagePath",
          "metadata" = EXCLUDED."metadata"
        RETURNING id, "gameId", "assetId", "displayName", "imagePath", "metadata", "createdAt"
      `, [
        asset.gameId,
        asset.assetId,
        asset.displayName ?? null,
        asset.imagePath,
        asset.metadata ?? null,
      ]);
    });

    return result.recordset[0];
  }
}
