import { GameAsset } from '../../types/games.js';

/**
 * Game Asset DAL contract.
 * Reads from the shared gameassets table partitioned by gameId.
 */
export interface IGameAssetDAL {
  /** List all assets for a single game, ordered by assetId. */
  listByGameId(gameId: string): Promise<GameAsset[]>;

  /** Upsert a single asset (used by the seed script). */
  upsert(asset: {
    gameId: string;
    assetId: string;
    displayName?: string | null;
    imagePath: string;
    metadata?: Record<string, unknown> | null;
  }): Promise<GameAsset>;
}
