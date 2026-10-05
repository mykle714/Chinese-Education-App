import type { IWritingGridDAL, WritingGridCharacterRow } from '../interfaces/IWritingGridDAL.js';
import { dbManager as defaultDbManager, DatabaseManager } from '../base/DatabaseManager.js';
import { ValidationError } from '../../types/dal.js';
import { vetSortedClause } from '../shared/vetTable.js';

/**
 * WritingGridDAL — the Writing Grid's two reads/writes over vocabentries_zh.
 * See IWritingGridDAL; docs/WRITING_PRACTICE_REWORK.md § 2.
 */
export class WritingGridDAL implements IWritingGridDAL {
  constructor(protected readonly dbManager: DatabaseManager = defaultDbManager) {}

  async findCandidateCharacters(userId: string, extraIds: number[]): Promise<WritingGridCharacterRow[]> {
    if (!userId) throw new ValidationError('userId is required');
    const result = await this.dbManager.executeQuery(async (client) =>
      client.query(
        `
        WITH chars AS (
          SELECT DISTINCT ch
            FROM vocabentries_zh ve, regexp_split_to_table(ve."entryKey", '') AS ch
           WHERE ve."userId" = $1
             AND ve.language = 'zh'
             -- The learner's own words, plus anything lent to this board by id.
             AND (${vetSortedClause('ve')} OR ve.id = ANY($2::int[]))
             AND ch ~ '^[\\u3400-\\u9fff]$'
        )
        -- The character's most frequent det row supplies BOTH its pinyin and its dd
        -- inputs, so the service resolves them against the same sense.
        SELECT c.ch AS char, r.id AS "cardId", r."typedMarkHistory", r."selectedSense",
               d.pronunciation AS pinyin, d.definitions->>0 AS definition, d."definitionClusters"
          FROM chars c
          CROSS JOIN LATERAL (
            SELECT pronunciation, definitions, "definitionClusters"
              FROM dictionaryentries_zh
             WHERE word1 = c.ch
             ORDER BY "frequencyScore" DESC NULLS LAST
             LIMIT 1
          ) d
          LEFT JOIN vocabentries_zh r
            ON r."userId" = $1 AND r.language = 'zh' AND r."entryKey" = c.ch
        `,
        [userId, extraIds]
      )
    );
    return result.recordset.map((row: any) => ({
      char: row.char,
      pinyin: row.pinyin ?? null,
      definition: row.definition ?? null,
      definitionClusters: row.definitionClusters ?? null,
      selectedSense: row.selectedSense ?? null,
      cardId: row.cardId ?? null,
      typedMarkHistory: row.typedMarkHistory ?? null,
    }));
  }

  async ensureCharacterRows(userId: string, chars: string[]): Promise<Map<string, number>> {
    if (!userId) throw new ValidationError('userId is required');
    const unique = [...new Set(chars)];
    if (unique.length === 0) return new Map();
    const result = await this.dbManager.executeQuery(async (client) => {
      // Same shape as VocabEntryDAL.ensureCharacterMarkStates' insert: a hidden lent row,
      // kept as-is if the learner already has one.
      await client.query(
        `INSERT INTO vocabentries_zh ("userId", "entryKey", language, "starterPackBucket")
         SELECT $1, ch, 'zh', 'provisional' FROM unnest($2::text[]) AS ch
         ON CONFLICT ("userId", "entryKey", language) DO NOTHING`,
        [userId, unique]
      );
      return client.query(
        `SELECT id, "entryKey" FROM vocabentries_zh
          WHERE "userId" = $1 AND language = 'zh' AND "entryKey" = ANY($2::text[])`,
        [userId, unique]
      );
    });
    return new Map(result.recordset.map((row: any) => [row.entryKey as string, row.id as number]));
  }
}
