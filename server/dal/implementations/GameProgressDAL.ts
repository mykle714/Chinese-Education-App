import { IGameProgressDAL } from '../interfaces/IGameProgressDAL.js';
import { dbManager as defaultDbManager, DatabaseManager } from '../base/DatabaseManager.js';
import { GameProgress } from '../../types/games.js';
import { ValidationError } from '../../types/dal.js';

/**
 * Persists per-user save state for each game.
 * The state column is a JSONB blob whose shape is defined by each game.
 */
export class GameProgressDAL implements IGameProgressDAL {

  /**
   * The connection manager, injected so the DAL can be substituted in a test.
   * Defaults to the process-wide singleton, so `new GameProgressDAL()` at the composition
   * root (dal/setup.ts) keeps working unchanged.
   * See docs/CORRECTNESS_AND_PERFORMANCE_REVIEW.md finding 2.
   */
  constructor(protected readonly dbManager: DatabaseManager = defaultDbManager) {}

  async getByUserAndGame(userId: string, gameId: string): Promise<GameProgress | null> {
    if (!userId) throw new ValidationError('userId is required');
    if (!gameId) throw new ValidationError('gameId is required');

    const result = await this.dbManager.executeQuery<GameProgress>(async (client) => {
      return await client.query(`
        SELECT id, "userId", "gameId", "state", "updatedAt"
        FROM gameprogress
        WHERE "userId" = $1 AND "gameId" = $2
      `, [userId, gameId]);
    });

    return result.recordset[0] ?? null;
  }

  async upsert(userId: string, gameId: string, state: Record<string, unknown>): Promise<GameProgress> {
    if (!userId) throw new ValidationError('userId is required');
    if (!gameId) throw new ValidationError('gameId is required');
    if (state === null || typeof state !== 'object') {
      throw new ValidationError('state must be a JSON object');
    }

    const result = await this.dbManager.executeQuery<GameProgress>(async (client) => {
      return await client.query(`
        INSERT INTO gameprogress ("userId", "gameId", "state", "updatedAt")
        VALUES ($1, $2, $3::jsonb, CURRENT_TIMESTAMP)
        ON CONFLICT ("userId", "gameId") DO UPDATE SET
          "state" = EXCLUDED."state",
          "updatedAt" = CURRENT_TIMESTAMP
        RETURNING id, "userId", "gameId", "state", "updatedAt"
      `, [userId, gameId, JSON.stringify(state)]);
    });

    return result.recordset[0];
  }
}
