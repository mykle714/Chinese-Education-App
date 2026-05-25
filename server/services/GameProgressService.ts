import { IGameProgressDAL } from '../dal/interfaces/IGameProgressDAL.js';
import { GameProgress } from '../types/games.js';

/**
 * Wraps GameProgressDAL. The state schema is owned by each game's frontend code;
 * the server intentionally treats it as opaque JSON.
 */
export class GameProgressService {
  constructor(private gameProgressDAL: IGameProgressDAL) {}

  async get(userId: string, gameId: string): Promise<GameProgress | null> {
    return this.gameProgressDAL.getByUserAndGame(userId, gameId);
  }

  async save(userId: string, gameId: string, state: Record<string, unknown>): Promise<GameProgress> {
    return this.gameProgressDAL.upsert(userId, gameId, state);
  }
}
