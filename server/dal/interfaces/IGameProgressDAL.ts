import { GameProgress } from '../../types/games.js';

/**
 * Game Progress DAL contract.
 * One row per (userId, gameId); state is a game-defined JSON blob.
 */
export interface IGameProgressDAL {
  /** Fetch a user's save for a game, or null if not yet saved. */
  getByUserAndGame(userId: string, gameId: string): Promise<GameProgress | null>;

  /** Insert or overwrite the user's save for a game. */
  upsert(userId: string, gameId: string, state: Record<string, unknown>): Promise<GameProgress>;
}
