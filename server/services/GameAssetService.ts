import { IGameAssetDAL } from '../dal/interfaces/IGameAssetDAL.js';
import { GameAsset } from '../types/games.js';

/**
 * Thin pass-through over GameAssetDAL.
 * Lives as its own service so we can add caching / asset-pack hydration later
 * without touching the controller.
 */
export class GameAssetService {
  constructor(private gameAssetDAL: IGameAssetDAL) {}

  async listForGame(gameId: string): Promise<GameAsset[]> {
    return this.gameAssetDAL.listByGameId(gameId);
  }
}
