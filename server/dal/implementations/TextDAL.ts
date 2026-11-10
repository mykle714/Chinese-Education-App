import type { ITextDAL, TextFieldUpdate } from '../interfaces/ITextDAL.js';
import { dbManager as defaultDbManager, DatabaseManager } from '../base/DatabaseManager.js';
import { ValidationError } from '../../types/dal.js';
import type { Text } from '../../types/index.js';

/**
 * Data access for `texts` — see ITextDAL.
 *
 * LAYER: DAL. Moved here verbatim from `TextService` (2026-11-09).
 */
export class TextDAL implements ITextDAL {
  constructor(protected readonly dbManager: DatabaseManager = defaultDbManager) {}

  private async run<T>(sql: string, params: unknown[]): Promise<{ rows: T[]; affected: number }> {
    const result = await this.dbManager.executeQuery<T>((client) => client.query(sql, params));
    return { rows: result.recordset, affected: result.rowsAffected };
  }

  async insertUserText(data: {
    userId: string; title: string; content: string; language: string; characterCount: number;
  }): Promise<Text> {
    const { rows } = await this.run<Text>(
      `INSERT INTO texts ("userId", title, content, language, "characterCount", "isUserCreated")
       VALUES ($1, $2, $3, $4, $5, true)
       RETURNING *`,
      [data.userId, data.title, data.content, data.language, data.characterCount]
    );
    if (rows.length === 0) throw new Error('Failed to create text');
    return rows[0];
  }

  async updateFields(id: string, fields: TextFieldUpdate): Promise<Text | null> {
    // Column names come from this fixed map, never from the caller.
    const columns: Array<[keyof TextFieldUpdate, string]> = [
      ['title', 'title'],
      ['content', 'content'],
      ['characterCount', '"characterCount"'],
    ];
    const sets: string[] = [];
    const values: unknown[] = [];
    for (const [key, column] of columns) {
      if (fields[key] === undefined) continue;
      values.push(fields[key]);
      sets.push(`${column} = $${values.length}`);
    }
    if (sets.length === 0) throw new ValidationError('No fields to update');
    values.push(id);

    const { rows } = await this.run<Text>(
      `UPDATE texts SET ${sets.join(', ')} WHERE id = $${values.length} RETURNING *`,
      values
    );
    return rows[0] ?? null;
  }

  async deleteById(id: string): Promise<boolean> {
    const { affected } = await this.run('DELETE FROM texts WHERE id = $1', [id]);
    return affected > 0;
  }

  async findById(id: string): Promise<Text | null> {
    const { rows } = await this.run<Text>('SELECT * FROM texts WHERE id = $1', [id]);
    return rows[0] ?? null;
  }

  async findByUserAndLanguage(userId: string, language: string): Promise<Text[]> {
    const { rows } = await this.run<Text>(
      `SELECT * FROM texts
       WHERE language = $1 AND "userId" = $2
       ORDER BY "createdAt" DESC`,
      [language, userId]
    );
    return rows;
  }

  async findUserCreated(userId: string): Promise<Text[]> {
    const { rows } = await this.run<Text>(
      `SELECT * FROM texts
       WHERE "userId" = $1 AND "isUserCreated" = true
       ORDER BY "createdAt" DESC`,
      [userId]
    );
    return rows;
  }

  async countUserCreated(userId: string): Promise<number> {
    const { rows } = await this.run<{ count: string }>(
      'SELECT COUNT(*)::text AS count FROM texts WHERE "userId" = $1 AND "isUserCreated" = true',
      [userId]
    );
    return parseInt(rows[0]?.count ?? '0', 10);
  }
}
