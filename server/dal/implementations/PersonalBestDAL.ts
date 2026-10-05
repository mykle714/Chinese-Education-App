import type { IPersonalBestDAL } from '../interfaces/IPersonalBestDAL.js';
import type { PersonalBestRecord } from '../../contracts/personalBests.js';
import { dbManager as defaultDbManager, DatabaseManager } from '../base/DatabaseManager.js';
import { ValidationError } from '../../types/dal.js';

/**
 * game_personal_bests (migration 171) — see IPersonalBestDAL.
 * Docs: docs/WRITING_PRACTICE_REWORK.md § 2a.
 */
export class PersonalBestDAL implements IPersonalBestDAL {
  constructor(protected readonly dbManager: DatabaseManager = defaultDbManager) {}

  private static readonly COLS = `game, mode, "bestValue", "achievedAt"`;

  private static toRecord(row: any): PersonalBestRecord {
    return {
      game: row.game,
      mode: row.mode,
      bestValue: Number(row.bestValue),
      achievedAt: row.achievedAt instanceof Date ? row.achievedAt.toISOString() : String(row.achievedAt),
    };
  }

  async listForUser(userId: string, language: string, game?: string): Promise<PersonalBestRecord[]> {
    if (!userId) throw new ValidationError('userId is required');
    const result = await this.dbManager.executeQuery(async (client) =>
      client.query(
        `SELECT ${PersonalBestDAL.COLS}
           FROM game_personal_bests
          WHERE "userId" = $1 AND language = $2 AND ($3::text IS NULL OR game = $3)
          ORDER BY game, mode`,
        [userId, language, game ?? null]
      )
    );
    return result.recordset.map(PersonalBestDAL.toRecord);
  }

  async findOne(userId: string, language: string, game: string, mode: string): Promise<PersonalBestRecord | null> {
    if (!userId) throw new ValidationError('userId is required');
    const result = await this.dbManager.executeQuery(async (client) =>
      client.query(
        `SELECT ${PersonalBestDAL.COLS}
           FROM game_personal_bests
          WHERE "userId" = $1 AND language = $2 AND game = $3 AND mode = $4`,
        [userId, language, game, mode]
      )
    );
    const row = result.recordset[0];
    return row ? PersonalBestDAL.toRecord(row) : null;
  }

  async upsertIfBetter(
    userId: string,
    language: string,
    game: string,
    mode: string,
    value: number,
    direction: 'lower' | 'higher'
  ): Promise<PersonalBestRecord> {
    if (!userId) throw new ValidationError('userId is required');
    // `direction` is a two-value union from the contract, mapped to one of two fixed
    // operators — never interpolated from input.
    const better = direction === 'lower' ? '<' : '>';
    const result = await this.dbManager.executeQuery(async (client) => {
      await client.query(
        `INSERT INTO game_personal_bests ("userId", language, game, mode, "bestValue")
         VALUES ($1, $2, $3, $4, $5)
         ON CONFLICT ("userId", language, game, mode) DO UPDATE
           SET "bestValue" = EXCLUDED."bestValue", "achievedAt" = NOW()
           WHERE EXCLUDED."bestValue" ${better} game_personal_bests."bestValue"`,
        [userId, language, game, mode, value]
      );
      return client.query(
        `SELECT ${PersonalBestDAL.COLS}
           FROM game_personal_bests
          WHERE "userId" = $1 AND language = $2 AND game = $3 AND mode = $4`,
        [userId, language, game, mode]
      );
    });
    return PersonalBestDAL.toRecord(result.recordset[0]);
  }
}
