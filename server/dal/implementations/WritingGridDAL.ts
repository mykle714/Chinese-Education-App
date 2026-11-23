import type { IWritingGridDAL, WritingCandidateWordRow, WritingGridCharacterRow } from '../interfaces/IWritingGridDAL.js';
import { dbManager as defaultDbManager, DatabaseManager } from '../base/DatabaseManager.js';
import { ValidationError } from '../../types/dal.js';
import { vetSortedClause } from '../shared/vetTable.js';
import { ensureCharacterRows } from '../shared/writingDeck.js';

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
          -- "inDeck": the character comes from at least one SORTED word, so it is in
          -- the writing deck (dal/shared/writingDeck.ts, same membership; the det-row
          -- condition is the inner LATERAL below). A character reached only through a
          -- lent word is not.
          SELECT ch, bool_or(${vetSortedClause('ve')}) AS "inDeck"
            FROM vocabentries_zh ve, regexp_split_to_table(ve."entryKey", '') AS ch
           WHERE ve."userId" = $1
             AND ve.language = 'zh'
             -- The learner's own words, plus anything lent to this board by id.
             AND (${vetSortedClause('ve')} OR ve.id = ANY($2::int[]))
             AND ch ~ '^[\\u3400-\\u9fff]$'
           GROUP BY ch
        )
        -- The character's most frequent det row supplies BOTH its pinyin and its dd
        -- inputs, so the service resolves them against the same sense.
        SELECT c.ch AS char, r.id AS "cardId", r."typedMarkHistory", r."selectedSense",
               -- In the writing deck, so on the writing tower — NOT "the row is sorted":
               -- most deck characters are hidden rows (IWritingGridDAL → ownCard).
               COALESCE(c."inDeck", FALSE) AS "ownCard",
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
      ownCard: row.ownCard === true,
      typedMarkHistory: row.typedMarkHistory ?? null,
    }));
  }

  async findCandidateWords(userId: string, extraIds: number[]): Promise<WritingCandidateWordRow[]> {
    if (!userId) throw new ValidationError('userId is required');
    const result = await this.dbManager.executeQuery(async (client) =>
      client.query(
        `
        SELECT ve.id, ve."entryKey", ve."selectedSense",
               d.pronunciation AS pinyin, d.definitions->>0 AS definition, d."definitionClusters"
          FROM vocabentries_zh ve
          CROSS JOIN LATERAL (
            SELECT pronunciation, definitions, "definitionClusters"
              FROM dictionaryentries_zh
             WHERE word1 = ve."entryKey"
             ORDER BY "frequencyScore" DESC NULLS LAST
             LIMIT 1
          ) d
         WHERE ve."userId" = $1
           AND ve.language = 'zh'
           AND (${vetSortedClause('ve')} OR ve.id = ANY($2::int[]))
           AND ve."entryKey" ~ '^[\\u3400-\\u9fff]{1,4}$'
        `,
        [userId, extraIds]
      )
    );
    return result.recordset.map((row: any) => ({
      id: row.id,
      entryKey: row.entryKey,
      pinyin: row.pinyin ?? null,
      definition: row.definition ?? null,
      definitionClusters: row.definitionClusters ?? null,
      selectedSense: row.selectedSense ?? null,
    }));
  }

  async findSuperpositionGroups(chars: string[]): Promise<Map<string, number[][]>> {
    if (chars.length === 0) return new Map();
    // Single-character rows only: a word's tiles are its characters' tiles.
    const result = await this.dbManager.executeQuery(async (client) =>
      client.query(
        `SELECT word1, "superpositionGroups"
           FROM dictionaryentries_zh
          WHERE language = 'zh' AND word1 = ANY($1::text[]) AND "superpositionGroups" IS NOT NULL`,
        [chars]
      )
    );
    return new Map(result.recordset.map((row: any) => [row.word1 as string, row.superpositionGroups as number[][]]));
  }

  async findEntryKeys(userId: string, ids: number[]): Promise<string[]> {
    if (!userId) throw new ValidationError('userId is required');
    if (ids.length === 0) return [];
    const result = await this.dbManager.executeQuery(async (client) =>
      client.query(
        `SELECT "entryKey" FROM vocabentries_zh WHERE "userId" = $1 AND id = ANY($2::int[])`,
        [userId, ids]
      )
    );
    return result.recordset.map((row: any) => row.entryKey as string);
  }

  async ensureCharacterRows(userId: string, chars: string[]): Promise<Map<string, number>> {
    if (!userId) throw new ValidationError('userId is required');
    if (chars.length === 0) return new Map();
    // The shared insert (dal/shared/writingDeck.ts) — also how the writing flp turns a
    // virtual deck character into a real hidden row.
    // executeQuery wants a pg-shaped result, so the map travels as its entries.
    const result = await this.dbManager.executeQuery<[string, number]>(async (client) =>
      ({ rows: [...(await ensureCharacterRows(client, userId, chars))] }));
    return new Map(result.recordset);
  }
}
