import type { IWritingNotebookDAL, NotebookCreditRow } from '../interfaces/IWritingNotebookDAL.js';
import type { NotebookCell } from '../../contracts/writingNotebook.js';
import { dbManager as defaultDbManager, DatabaseManager } from '../base/DatabaseManager.js';
import { ValidationError } from '../../types/dal.js';

/**
 * notebook_sheets + notebook_cells (migration 174) — see IWritingNotebookDAL.
 * Docs: docs/WRITING_NOTEBOOK.md § "Storage".
 */
export class WritingNotebookDAL implements IWritingNotebookDAL {
  constructor(protected readonly dbManager: DatabaseManager = defaultDbManager) {}

  async touchSheet(userId: string, language: string, word: string): Promise<void> {
    if (!userId) throw new ValidationError('userId is required');
    await this.dbManager.executeQuery(async (client) =>
      client.query(
        `INSERT INTO notebook_sheets ("userId", language, word)
         VALUES ($1, $2, $3)
         ON CONFLICT ("userId", language, word) DO UPDATE SET "lastOpenedAt" = NOW()`,
        [userId, language, word]
      )
    );
  }

  async findLastWord(userId: string, language: string): Promise<string | null> {
    if (!userId) throw new ValidationError('userId is required');
    const result = await this.dbManager.executeQuery(async (client) =>
      client.query(
        `SELECT word FROM notebook_sheets
          WHERE "userId" = $1 AND language = $2
          ORDER BY "lastOpenedAt" DESC
          LIMIT 1`,
        [userId, language]
      )
    );
    return result.recordset[0]?.word ?? null;
  }

  async listCells(userId: string, language: string, word: string, from: number, to: number): Promise<NotebookCell[]> {
    if (!userId) throw new ValidationError('userId is required');
    const result = await this.dbManager.executeQuery(async (client) =>
      client.query(
        `SELECT "cellIndex", ink FROM notebook_cells
          WHERE "userId" = $1 AND language = $2 AND word = $3
            AND "cellIndex" >= $4 AND "cellIndex" < $5
          ORDER BY "cellIndex"`,
        [userId, language, word, from, to]
      )
    );
    return result.recordset.map((row: any) => ({ cellIndex: Number(row.cellIndex), ink: String(row.ink) }));
  }

  async upsertCell(
    userId: string,
    language: string,
    word: string,
    cellIndex: number,
    ink: string,
    matchedChar: string | null
  ): Promise<void> {
    if (!userId) throw new ValidationError('userId is required');
    // One round trip, two statements on the same client: the sheet row must exist before
    // the cell's FK can reference it. DO NOTHING keeps lastOpenedAt untouched — writing a
    // cell is not "opening" the sheet.
    await this.dbManager.executeQuery(async (client) => {
      await client.query(
        `INSERT INTO notebook_sheets ("userId", language, word)
         VALUES ($1, $2, $3)
         ON CONFLICT ("userId", language, word) DO NOTHING`,
        [userId, language, word]
      );
      return client.query(
        `INSERT INTO notebook_cells ("userId", language, word, "cellIndex", ink, "matchedChar")
         VALUES ($1, $2, $3, $4, $5, $6)
         ON CONFLICT ("userId", language, word, "cellIndex") DO UPDATE
           SET ink = EXCLUDED.ink, "matchedChar" = EXCLUDED."matchedChar", "updatedAt" = NOW()`,
        [userId, language, word, cellIndex, ink, matchedChar]
      );
    });
  }

  async deleteCell(userId: string, language: string, word: string, cellIndex: number): Promise<void> {
    if (!userId) throw new ValidationError('userId is required');
    await this.dbManager.executeQuery(async (client) =>
      client.query(
        `DELETE FROM notebook_cells
          WHERE "userId" = $1 AND language = $2 AND word = $3 AND "cellIndex" = $4`,
        [userId, language, word, cellIndex]
      )
    );
  }

  async listCredits(userId: string, language: string, word?: string): Promise<NotebookCreditRow[]> {
    if (!userId) throw new ValidationError('userId is required');
    const result = await this.dbManager.executeQuery(async (client) =>
      client.query(
        `SELECT word, "matchedChar", COUNT(*)::int AS credited
           FROM notebook_cells
          WHERE "userId" = $1 AND language = $2 AND ($3::text IS NULL OR word = $3)
            AND "matchedChar" IS NOT NULL
          GROUP BY word, "matchedChar"`,
        [userId, language, word ?? null]
      )
    );
    return result.recordset.map((row: any) => ({
      word: String(row.word),
      matchedChar: String(row.matchedChar),
      credited: Number(row.credited),
    }));
  }

  async findNextEmpty(userId: string, language: string, word: string, after: number): Promise<number> {
    if (!userId) throw new ValidationError('userId is required');
    // Gap search on the primary key. If `after` itself is empty, it is the answer;
    // otherwise it is the first filled cell c >= after whose successor c + 1 is missing
    // (cells past the last filled one are empty, so such a c always exists).
    const result = await this.dbManager.executeQuery(async (client) =>
      client.query(
        `SELECT CASE
                  WHEN NOT EXISTS (
                    SELECT 1 FROM notebook_cells
                     WHERE "userId" = $1 AND language = $2 AND word = $3 AND "cellIndex" = $4
                  ) THEN $4
                  ELSE (
                    SELECT MIN(c."cellIndex") + 1
                      FROM notebook_cells c
                     WHERE c."userId" = $1 AND c.language = $2 AND c.word = $3 AND c."cellIndex" >= $4
                       AND NOT EXISTS (
                         SELECT 1 FROM notebook_cells d
                          WHERE d."userId" = $1 AND d.language = $2 AND d.word = $3
                            AND d."cellIndex" = c."cellIndex" + 1
                       )
                  )
                END AS "nextEmpty"`,
        [userId, language, word, after]
      )
    );
    return Number(result.recordset[0]?.nextEmpty ?? after);
  }
}
