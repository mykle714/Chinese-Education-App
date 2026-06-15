import { PoolClient, QueryResult } from 'pg';
import { BaseDAL } from '../base/BaseDAL.js';
import { IVocabEntryDAL } from '../interfaces/IVocabEntryDAL.js';
import { dbManager } from '../base/DatabaseManager.js';
import { VocabEntry, VocabEntryCreateData, VocabEntryUpdateData, DifficultyLevel, UsedInItem } from '../../types/index.js';
import { ValidationError, NotFoundError, BulkResult, ITransaction, DALError } from '../../types/dal.js';
import db from '../../db.js';
import { DICT_COLS, DICT_JOIN } from '../shared/dictJoin.js';
import { vetTableForLanguage, vetReadFrom, VET_PHYSICAL_TABLES } from '../shared/vetTable.js';

/**
 * VocabEntry Data Access Layer implementation
 * Handles all database operations for VocabEntry entities including bulk operations
 */
export class VocabEntryDAL extends BaseDAL<VocabEntry, VocabEntryCreateData, VocabEntryUpdateData> implements IVocabEntryDAL {
  constructor() {
    // NOTE: `vocabentries` is split per language (migration 66) into
    // vocabentries_zh / vocabentries_es. There is no single physical vet table, so
    // every read/write below routes explicitly via shared/vetTable.js. The base
    // `tableName` is left as the (now-orphaned) legacy table name only to satisfy
    // BaseDAL's constructor; all write methods that would use it are overridden.
    super(dbManager, 'vocabentries_zh', 'id');
  }

  // ── Per-language write routing (vet split, migration 66) ───────────────────
  // Inserts go to the table for the row's language (es carries `pos`). Id-based
  // update/delete run against BOTH physical tables — ids are globally unique
  // (shared sequence), so exactly one row matches.

  async create(data: VocabEntryCreateData): Promise<VocabEntry> {
    this.validateCreateData(data);
    const table = vetTableForLanguage((data as any).language ?? 'zh');
    const { columns, placeholders, values } = this.buildInsertQuery(data);
    const result = await this.dbManager.executeQuery<VocabEntry>(async (client) => {
      return await client.query(
        `INSERT INTO ${table} (${columns}) VALUES (${placeholders}) RETURNING *`,
        values
      );
    });
    if (result.recordset.length === 0) {
      throw new DALError('Failed to create record', 'ERR_CREATE_FAILED');
    }
    return result.recordset[0];
  }

  async createWithTransaction(data: VocabEntryCreateData, transaction: ITransaction): Promise<VocabEntry> {
    this.validateCreateData(data);
    const table = vetTableForLanguage((data as any).language ?? 'zh');
    const { columns, placeholders, values } = this.buildInsertQuery(data);
    const client = transaction.getClient();
    const result = await client.query(
      `INSERT INTO ${table} (${columns}) VALUES (${placeholders}) RETURNING *`,
      values
    );
    if (result.rows.length === 0) {
      throw new DALError('Failed to create record', 'ERR_CREATE_FAILED');
    }
    return result.rows[0];
  }

  async update(id: string | number, data: VocabEntryUpdateData): Promise<VocabEntry> {
    if (!id) throw new ValidationError('id is required');
    this.validateUpdateData(data);
    const { setClause, values } = this.buildUpdateQuery(data);
    const client = await db.getClient();
    try {
      let updated: VocabEntry | null = null;
      for (const table of VET_PHYSICAL_TABLES) {
        const r = await client.query(
          `UPDATE ${table} SET ${setClause} WHERE id = $${values.length + 1} RETURNING *`,
          [...values, id]
        );
        if (r.rows.length > 0) updated = r.rows[0];
      }
      if (!updated) throw new NotFoundError(`Record with id ${id} not found`);
      return updated;
    } finally {
      client.release();
    }
  }

  async delete(id: string | number): Promise<boolean> {
    if (!id) throw new ValidationError('id is required');
    const client = await db.getClient();
    try {
      let affected = 0;
      for (const table of VET_PHYSICAL_TABLES) {
        const r = await client.query(`DELETE FROM ${table} WHERE id = $1`, [id]);
        affected += r.rowCount ?? 0;
      }
      return affected > 0;
    } finally {
      client.release();
    }
  }

  // Look up a single vet row by id, scoped to a language so it routes to that
  // language's physical table (vet is split per language — migration 66). Callers
  // resolve the language from the request / the user's active language.
  async findByIdAndLanguage(id: string | number, language: string): Promise<VocabEntry | null> {
    if (!language) {
      throw new ValidationError('Language is required');
    }
    const result = await this.dbManager.executeQuery<VocabEntry>(async (client) => {
      return await client.query(`
        SELECT ve.*, ${DICT_COLS}
        FROM ${vetReadFrom(language)} ${DICT_JOIN}
        WHERE ve.id = $1
      `, [id]);
    });
    return result.recordset[0] || null;
  }

  /**
   * Find vocabulary entries by user ID and language with pagination
   */
  async findByUserIdAndLanguage(userId: string, language: string, limit: number = 100, offset: number = 0): Promise<VocabEntry[]> {
    if (!userId) {
      throw new ValidationError('User ID is required');
    }
    if (!language) {
      throw new ValidationError('Language is required');
    }

    const result = await this.dbManager.executeQuery<VocabEntry>(async (client) => {
      return await client.query(`
        SELECT ve.*, ${DICT_COLS}
        FROM ${vetReadFrom(language)} ${DICT_JOIN}
        WHERE ve."userId" = $1 AND ve."language" = $2
        ORDER BY ve."createdAt" DESC
        LIMIT $3 OFFSET $4
      `, [userId, language, limit, offset]);
    });

    return result.recordset;
  }

  /**
   * Find vocabulary entry by user and key
   */
  async findByUserAndKey(userId: string, entryKey: string, language: string, pos?: string): Promise<VocabEntry | null> {
    if (!userId) {
      throw new ValidationError('User ID is required');
    }
    if (!entryKey) {
      throw new ValidationError('Entry key is required');
    }
    if (!language) {
      throw new ValidationError('Language is required');
    }

    // (userId, entryKey, language) is the base identity — the same spelling can exist
    // independently per study language. Spanish adds `pos` (verb vs noun of the same
    // spelling are distinct saved cards): when a pos is supplied, match it too.
    const params: any[] = [userId, entryKey, language];
    let posPredicate = '';
    if (pos !== undefined) {
      params.push(pos);
      posPredicate = ` AND ve.pos IS NOT DISTINCT FROM $${params.length}`;
    }
    const result = await this.dbManager.executeQuery<VocabEntry>(async (client) => {
      return await client.query(`
        SELECT ve.*, ${DICT_COLS}
        FROM ${vetReadFrom(language)} ${DICT_JOIN}
        WHERE ve."userId" = $1 AND ve."entryKey" = $2 AND ve."language" = $3${posPredicate}
      `, params);
    });

    return result.recordset[0] || null;
  }

  /**
   * Count vocabulary entries for a user by language
   */
  async countByUserIdAndLanguage(userId: string, language: string): Promise<number> {
    if (!userId) {
      throw new ValidationError('User ID is required');
    }
    if (!language) {
      throw new ValidationError('Language is required');
    }

    const result = await this.dbManager.executeQuery<{ count: string }>(async (client) => {
      return await client.query(`SELECT COUNT(*) as count FROM ${vetTableForLanguage(language)} WHERE "userId" = $1 AND "language" = $2`, [userId, language]);
    });

    return parseInt(result.recordset[0].count);
  }

  /**
   * Search vocabulary entries by term
   */
  async searchEntries(userId: string, searchTerm: string, language: string, limit: number = 50): Promise<VocabEntry[]> {
    if (!userId) {
      throw new ValidationError('User ID is required');
    }
    if (!searchTerm) {
      throw new ValidationError('Search term is required');
    }
    if (!language) {
      throw new ValidationError('Language is required');
    }

    // Search matches on entryKey OR any individual definition phrase from det.
    // det.definitions is a JSONB array already pre-split into one phrase per
    // element (see scripts/backfill-split-semicolon-definitions.js), so
    // unnesting it via jsonb_array_elements_text gives per-phrase matching.
    // Scoped to the user's active language so results don't mix languages.
    const result = await this.dbManager.executeQuery<VocabEntry>(async (client) => {
      return await client.query(`
        SELECT ve.*, ${DICT_COLS}
        FROM ${vetReadFrom(language)} ${DICT_JOIN}
        WHERE ve."userId" = $1 AND ve."language" = $4
        AND (
          ve."entryKey" ILIKE $2
          OR EXISTS (
            SELECT 1 FROM jsonb_array_elements_text(de.definitions) AS d(def)
            WHERE d.def ILIKE $2
          )
        )
        ORDER BY ve."createdAt" DESC
        LIMIT $3
      `, [userId, `%${searchTerm}%`, limit, language]);
    });

    return result.recordset;
  }

  /**
   * Find entries by HSK level
   */
  async findByDifficultyLevel(userId: string, difficulty: DifficultyLevel): Promise<VocabEntry[]> {
    if (!userId) {
      throw new ValidationError('User ID is required');
    }

    // HSK levels are a Chinese-only concept, so this query is hard-pinned to zh.
    const result = await this.dbManager.executeQuery<VocabEntry>(async (client) => {
      return await client.query(`
        SELECT ve.*, ${DICT_COLS}
        FROM ${vetReadFrom('zh')} ${DICT_JOIN}
        WHERE ve."userId" = $1 AND ve."language" = 'zh' AND de."difficulty" = $2
        ORDER BY ve."createdAt" DESC
      `, [userId, difficulty]);
    });

    return result.recordset;
  }

  /**
   * Find vocabulary entries by a list of entry keys
   */
  async bulkFindByKeys(userId: string, entryKeys: string[], language: string): Promise<VocabEntry[]> {
    if (!userId) {
      throw new ValidationError('User ID is required');
    }
    if (!language) {
      throw new ValidationError('Language is required');
    }

    if (!entryKeys || entryKeys.length === 0) {
      return [];
    }

    // entryKeys start at $3 — $1 is userId, $2 is the language filter.
    const placeholders = entryKeys.map((_, index) => `$${index + 3}`).join(',');

    const result = await this.dbManager.executeQuery<VocabEntry>(async (client) => {
      return await client.query(`
        SELECT ve.*, ${DICT_COLS}
        FROM ${vetReadFrom(language)} ${DICT_JOIN}
        WHERE ve."userId" = $1 AND ve."language" = $2 AND ve."entryKey" IN (${placeholders})
      `, [userId, language, ...entryKeys]);
    });

    return result.recordset;
  }

  /**
   * Find vocabulary entries by tokens for reader feature
   */
  async findByTokens(userId: string, tokens: string[], language: string): Promise<VocabEntry[]> {
    const dalStart = performance.now();
    
    console.log(`[VOCAB-DB] 🗄️ Starting database lookup:`, {
      userId: `${userId.substring(0, 8)}...`,
      tokensReceived: tokens?.length || 0,
      timestamp: new Date().toISOString()
    });

    if (!userId) {
      console.error(`[VOCAB-DB] ❌ Validation failed:`, {
        error: 'User ID is required',
        dalTime: `${(performance.now() - dalStart).toFixed(2)}ms`
      });
      throw new ValidationError('User ID is required');
    }

    if (!language) {
      throw new ValidationError('Language is required');
    }
    
    if (!tokens || tokens.length === 0) {
      console.log(`[VOCAB-DB] 📝 Empty token array:`, {
        userId: `${userId.substring(0, 8)}...`,
        response: 'returning empty array',
        dalTime: `${(performance.now() - dalStart).toFixed(2)}ms`
      });
      return [];
    }

    console.log(`[VOCAB-DB] 🔍 Processing tokens for database query:`, {
      userId: `${userId.substring(0, 8)}...`,
      rawTokenCount: tokens.length,
      sampleTokens: tokens.slice(0, 10)
    });

    // Remove duplicates and filter out empty tokens
    const uniqueTokens = [...new Set(tokens.filter(token => token && token.trim().length > 0))];
    
    const duplicatesRemoved = tokens.length - uniqueTokens.length;
    
    console.log(`[VOCAB-DB] 🧹 Token preprocessing completed:`, {
      userId: `${userId.substring(0, 8)}...`,
      originalTokens: tokens.length,
      uniqueTokens: uniqueTokens.length,
      duplicatesRemoved: duplicatesRemoved,
      preprocessingEfficiency: `${((uniqueTokens.length / tokens.length) * 100).toFixed(1)}%`,
      finalTokens: uniqueTokens.slice(0, 15) // Show first 15 final tokens
    });
    
    if (uniqueTokens.length === 0) {
      console.log(`[VOCAB-DB] 📝 No valid tokens after preprocessing:`, {
        userId: `${userId.substring(0, 8)}...`,
        reason: 'All tokens were duplicates or empty',
        dalTime: `${(performance.now() - dalStart).toFixed(2)}ms`
      });
      return [];
    }

    // Prepare SQL query with detailed logging
    const sqlQuery = `
      SELECT ve.*, ${DICT_COLS}
      FROM ${vetReadFrom(language)} ${DICT_JOIN}
      WHERE ve."userId" = $1
      AND ve."language" = $3
      AND ve."entryKey" = ANY($2)
      ORDER BY LENGTH(ve."entryKey") DESC, ve."entryKey" ASC
    `;

    console.log(`[VOCAB-DB] 🔧 Preparing SQL query:`, {
      userId: `${userId.substring(0, 8)}...`,
      query: sqlQuery.replace(/\s+/g, ' ').trim(),
      parameters: {
        userId: `${userId.substring(0, 8)}...`,
        tokenArray: `[${uniqueTokens.length} tokens]`,
        tokenArraySize: `${JSON.stringify(uniqueTokens).length} bytes`
      },
      queryPreparationTime: `${(performance.now() - dalStart).toFixed(2)}ms`
    });

    try {
      const queryStart = performance.now();
      
      const result = await this.dbManager.executeQuery<VocabEntry>(async (client) => {
        console.log(`[VOCAB-DB] 🚀 Executing database query:`, {
          userId: `${userId.substring(0, 8)}...`,
          connectionStatus: 'active',
          queryExecutionStart: new Date().toISOString()
        });

        const queryResult = await client.query(sqlQuery, [userId, uniqueTokens, language]);
        
        console.log(`[VOCAB-DB] 📊 Raw query result:`, {
          userId: `${userId.substring(0, 8)}...`,
          rowsReturned: queryResult.rows?.length || 0,
          queryFields: queryResult.fields?.map(f => f.name) || [],
          queryExecutionTime: `${(performance.now() - queryStart).toFixed(2)}ms`
        });

        return queryResult;
      });

      const queryTime = performance.now() - queryStart;
      const totalDalTime = performance.now() - dalStart;

      console.log(`[VOCAB-DB] ✅ Database lookup completed:`, {
        userId: `${userId.substring(0, 8)}...`,
        tokensQueried: uniqueTokens.length,
        entriesFound: result.recordset.length,
        matchRate: `${(result.recordset.length / uniqueTokens.length * 100).toFixed(1)}%`,
        queryExecutionTime: `${queryTime.toFixed(2)}ms`,
        totalDalTime: `${totalDalTime.toFixed(2)}ms`,
        performance: {
          tokensPerSecond: Math.round(uniqueTokens.length / (queryTime / 1000)),
          entriesPerSecond: Math.round(result.recordset.length / (queryTime / 1000)),
          avgTimePerToken: `${(queryTime / uniqueTokens.length).toFixed(2)}ms`
        },
        foundEntries: result.recordset.map(entry => ({
          id: entry.id,
          key: entry.entryKey,
          difficulty: entry.difficulty
        })).slice(0, 10), // Show first 10 entries
        tokenMatchAnalysis: {
          matchedTokens: result.recordset.map(e => e.entryKey),
          unmatchedTokens: uniqueTokens.filter(token => 
            !result.recordset.some(entry => entry.entryKey === token)
          ).slice(0, 10) // Show first 10 unmatched tokens
        }
      });

      return result.recordset;
    } catch (error) {
      const errorTime = performance.now() - dalStart;
      
      console.error(`[VOCAB-DB] ❌ Database query failed:`, {
        userId: `${userId.substring(0, 8)}...`,
        error: error instanceof Error ? error.message : 'Unknown database error',
        errorCode: (error as any)?.code,
        errorSeverity: (error as any)?.severity,
        tokensAttempted: uniqueTokens.length,
        failureTime: `${errorTime.toFixed(2)}ms`,
        queryParameters: {
          userIdLength: userId.length,
          tokenArrayLength: uniqueTokens.length,
          sampleTokens: uniqueTokens.slice(0, 5)
        },
        stack: error instanceof Error ? error.stack : undefined
      });

      throw error;
    }
  }

  /**
   * Bulk create vocabulary entries
   */
  async bulkCreate(entries: VocabEntryCreateData[]): Promise<VocabEntry[]> {
    if (!entries || entries.length === 0) {
      return [];
    }

    return await this.dbManager.executeInTransaction(async (transaction) => {
      const results: VocabEntry[] = [];
      
      for (const entry of entries) {
        const result = await this.createWithTransaction(entry, transaction);
        results.push(result);
      }
      
      return results;
    });
  }

  /**
   * Bulk upsert vocabulary entries (insert or update)
   */
  async bulkUpsert(entries: VocabEntryCreateData[]): Promise<BulkResult> {
    if (!entries || entries.length === 0) {
      return {
        total: 0,
        inserted: 0,
        updated: 0,
        skipped: 0,
        errors: []
      };
    }

    return await this.dbManager.executeInTransaction(async (transaction) => {
      const result: BulkResult = {
        total: entries.length,
        inserted: 0,
        updated: 0,
        skipped: 0,
        errors: []
      };

      const client = transaction.getClient();

      for (let i = 0; i < entries.length; i++) {
        const entry = entries[i];
        
        // Identity is (userId, entryKey, language) — default to 'zh' if the
        // import didn't tag a language so legacy single-language data still works.
        const entryLanguage = entry.language || 'zh';
        // Route to the per-language vet table (vocabentries_zh / _es). Bulk import
        // doesn't carry a pos, so es rows insert with pos NULL (the sort flow,
        // not this path, captures the specific POS).
        const vetTable = vetTableForLanguage(entryLanguage);

        try {
          // Check if entry exists for this user + key + language
          const existingResult = await client.query(
            `SELECT id FROM ${vetTable} WHERE "userId" = $1 AND "entryKey" = $2 AND "language" = $3`,
            [entry.userId, entry.entryKey, entryLanguage]
          );

          if (existingResult.rows.length > 0) {
            // Row already present — nothing on vet to update now that the
            // definition lives on det. Count as skipped.
            result.skipped++;
          } else {
            await client.query(`
              INSERT INTO ${vetTable} ("userId", "entryKey", "language")
              VALUES ($1, $2, $3)
            `, [
              entry.userId,
              entry.entryKey,
              entryLanguage
            ]);
            result.inserted++;
          }
        } catch (error: any) {
          result.errors.push({
            row: i + 1,
            data: entry,
            error: error.message
          });
        }
      }

      return result;
    });
  }

  /**
   * Find entries created after a specific date
   */
  async findEntriesCreatedAfter(userId: string, date: Date, language: string): Promise<VocabEntry[]> {
    if (!userId) {
      throw new ValidationError('User ID is required');
    }
    if (!language) {
      throw new ValidationError('Language is required');
    }

    const result = await this.dbManager.executeQuery<VocabEntry>(async (client) => {
      return await client.query(`
        SELECT ve.*, ${DICT_COLS}
        FROM ${vetReadFrom(language)} ${DICT_JOIN}
        WHERE ve."userId" = $1 AND ve."language" = $3 AND ve."createdAt" > $2
        ORDER BY ve."createdAt" DESC
      `, [userId, date, language]);
    });

    return result.recordset;
  }

  /**
   * Find related library words that share characters with the given word
   * Returns words sorted by success rate
   */
  async findRelatedBySharedCharacters(
    userId: string,
    word: string,
    language: string,
    limit: number = 4
  ): Promise<Array<{ id: number; entryKey: string; pronunciation: string | null; definition: string | null }>> {
    if (!word || word.trim().length === 0) {
      return [];
    }

    // Only works for Chinese
    if (language !== 'zh') {
      return [];
    }

    // Split word into characters
    const characters: string[] = [...word.trim()];
    
    if (characters.length === 0) {
      return [];
    }

    // Build regex pattern to match any word containing any of these characters
    // SIMILAR TO ANY will match if entrykey contains any of the characters
    const pattern: string = `[${characters.join('')}]`;

    const query: string = `
      SELECT
        ve.id,
        ve."entryKey" as entrykey,
        de.pronunciation,
        de.definition
      FROM vocabentries_zh ve
      LEFT JOIN LATERAL (
        SELECT pronunciation, definitions->>0 as definition
        FROM dictionaryentries_zh
        WHERE word1 = ve."entryKey" AND language = ve.language LIMIT 1
      ) de ON true
      WHERE ve."userId" = $1
        AND ve.language = $2
        AND ve."entryKey" != $3
        AND ve."entryKey" ~ $4
        AND ve."starterPackBucket" != 'skip'
      ORDER BY ve.id ASC
      LIMIT $5
    `;

    const result = await this.dbManager.executeQuery<{
      id: number;
      entrykey: string;
      pronunciation: string | null;
      definition: string | null;
    }>(async (client) => {
      return await client.query(query, [userId, language, word, pattern, limit]);
    });

    return result.recordset.map((row) => ({
      id: row.id,
      entryKey: row.entrykey,
      pronunciation: row.pronunciation ?? null,
      definition: row.definition ?? null,
    }));
  }

  /**
   * For a single Chinese character, find up to `limit` multi-char words that contain it.
   *
   * Pass 1: user's own vocabentries (vet). Joined to dictionaryentries_zh (det) so we can sort
   *   by det."vernacularScore" DESC NULLS LAST (then entryKey ASC for determinism).
   * Pass 2: if pass 1 returns fewer than `limit`, top up from det (global), skipping any
   *   entryKeys already returned by pass 1. Same ordering. Pass-2 items have vocabEntryId=null.
   *
   * Chinese-only; returns [] for non-single-character input or non-zh language.
   */
  async findUsedInForCharacter(
    userId: string,
    character: string,
    language: string,
    limit: number = 4
  ): Promise<UsedInItem[]> {
    if (language !== 'zh') return [];
    if (!character) return [];
    const chars: string[] = [...character];
    if (chars.length !== 1) return [];

    const ch: string = chars[0];

    // Pass 1: user's vet entries containing the char (excluding the single-char itself).
    // position(...) > 0 is a plain substring check — no regex meta to escape.
    const vetQuery: string = `
      SELECT
        ve.id AS "vocabEntryId",
        ve."entryKey",
        de.pronunciation,
        de.definition,
        de."vernacularScore"
      FROM vocabentries_zh ve
      LEFT JOIN LATERAL (
        SELECT pronunciation, definitions->>0 AS definition, "vernacularScore"
        FROM dictionaryentries_zh
        WHERE word1 = ve."entryKey" AND language = ve.language
        LIMIT 1
      ) de ON true
      WHERE ve."userId" = $1
        AND ve.language = $2
        AND ve."entryKey" <> $3
        AND position($3 IN ve."entryKey") > 0
        AND char_length(ve."entryKey") <= 4
      ORDER BY de."vernacularScore" DESC NULLS LAST, ve."entryKey" ASC
      LIMIT $4
    `;

    const vetResult = await this.dbManager.executeQuery<{
      vocabEntryId: number;
      entryKey: string;
      pronunciation: string | null;
      definition: string | null;
      vernacularScore: number | null;
    }>(async (client) => {
      return await client.query(vetQuery, [userId, language, ch, limit]);
    });

    const vetItems: UsedInItem[] = vetResult.recordset.map((row) => ({
      vocabEntryId: row.vocabEntryId,
      entryKey: row.entryKey,
      pronunciation: row.pronunciation ?? null,
      definition: row.definition ?? null,
      vernacularScore: row.vernacularScore ?? null,
    }));

    if (vetItems.length >= limit) return vetItems;

    // Pass 2: top up from det, skipping pass-1 entryKeys.
    const remaining: number = limit - vetItems.length;
    const excluded: string[] = vetItems.map((i) => i.entryKey);

    const detQuery: string = `
      SELECT
        word1 AS "entryKey",
        pronunciation,
        definitions->>0 AS definition,
        "vernacularScore"
      FROM dictionaryentries_zh
      WHERE language = $1
        AND char_length(word1) > 1
        AND char_length(word1) <= 4
        AND word1 <> $2
        AND position($2 IN word1) > 0
        AND ($3::text[] IS NULL OR word1 <> ALL($3::text[]))
      ORDER BY "vernacularScore" DESC NULLS LAST, word1 ASC
      LIMIT $4
    `;

    const detResult = await this.dbManager.executeQuery<{
      entryKey: string;
      pronunciation: string | null;
      definition: string | null;
      vernacularScore: number | null;
    }>(async (client) => {
      return await client.query(detQuery, [
        language,
        ch,
        excluded.length > 0 ? excluded : null,
        remaining,
      ]);
    });

    const detItems: UsedInItem[] = detResult.recordset.map((row) => ({
      vocabEntryId: null,
      entryKey: row.entryKey,
      pronunciation: row.pronunciation ?? null,
      definition: row.definition ?? null,
      vernacularScore: row.vernacularScore ?? null,
    }));

    return [...vetItems, ...detItems];
  }

  /**
   * Bulk upsert with progress tracking for large imports
   */
  async bulkUpsertWithProgress(
    entries: VocabEntryCreateData[],
    progressCallback?: (processed: number, total: number) => void
  ): Promise<BulkResult> {
    if (!entries || entries.length === 0) {
      return {
        total: 0,
        inserted: 0,
        updated: 0,
        skipped: 0,
        errors: []
      };
    }

    const batchSize = 100; // Process in batches for better performance
    const result: BulkResult = {
      total: entries.length,
      inserted: 0,
      updated: 0,
      skipped: 0,
      errors: []
    };

    for (let i = 0; i < entries.length; i += batchSize) {
      const batch = entries.slice(i, i + batchSize);
      const batchResult = await this.bulkUpsert(batch);
      
      // Aggregate results
      result.inserted += batchResult.inserted;
      result.updated += batchResult.updated;
      result.skipped += batchResult.skipped;
      result.errors.push(...batchResult.errors);
      
      // Report progress
      if (progressCallback) {
        progressCallback(Math.min(i + batchSize, entries.length), entries.length);
      }
    }

    return result;
  }

  /**
   * Override create to handle vocabulary-specific validation
   */
  protected validateCreateData(data: VocabEntryCreateData): void {
    super.validateCreateData(data);

    if (!data.userId) {
      throw new ValidationError('User ID is required');
    }
    if (!data.entryKey) {
      throw new ValidationError('Entry key is required');
    }
  }

  /**
   * Override update to handle vocabulary-specific validation
   */
  protected validateUpdateData(data: VocabEntryUpdateData): void {
    super.validateUpdateData(data);

    if (!data.entryKey) {
      throw new ValidationError('Entry key is required');
    }
  }

  // updateCategory was removed in migration 67: `category` is now a GENERATED STORED
  // column derived from markHistory, so it cannot (and need not) be written directly.
  // Callers that previously forced a category now write the corresponding markHistory.

  /**
   * Update a vocab entry's mark history and related statistics
   * Used when marking cards as "already learned" to populate with perfect history
   */
  async updateMarkHistory(
    id: number, 
    markHistory: any[], 
    totalMarkCount: number,
    totalCorrectCount: number,
    totalSuccessRate: number,
    last8SuccessRate: number,
    last16SuccessRate: number
  ): Promise<void> {
    if (!id) {
      throw new ValidationError('Entry ID is required');
    }

    const client = await db.getClient();

    try {
      // id is globally unique across the per-language vet tables (shared sequence),
      // so update both; exactly one row matches.
      for (const table of VET_PHYSICAL_TABLES) {
        await client.query(`
          UPDATE ${table}
          SET "markHistory" = $1,
              "totalMarkCount" = $2,
              "totalCorrectCount" = $3,
              "totalSuccessRate" = $4,
              "last8SuccessRate" = $5,
              "last16SuccessRate" = $6
          WHERE id = $7
        `, [
          JSON.stringify(markHistory),
          totalMarkCount,
          totalCorrectCount,
          totalSuccessRate,
          last8SuccessRate,
          last16SuccessRate,
          id
        ]);
      }
    } catch (error: any) {
      console.error('Error updating mark history:', error);
      throw new DALError('Failed to update vocab entry mark history', 'ERR_UPDATE_MARK_HISTORY_FAILED', error);
    } finally {
      client.release();
    }
  }

  /**
   * Find duplicate keys for a user (helper for data cleanup)
   */
  async findDuplicateKeys(userId: string, entryKeys: string[], language: string): Promise<VocabEntry[]> {
    if (!userId) {
      throw new ValidationError('User ID is required');
    }

    if (!entryKeys || entryKeys.length === 0) {
      return [];
    }

    // Use bulkFindByKeys to get actual entries
    return await this.bulkFindByKeys(userId, entryKeys, language);
  }

  /**
   * Bulk create with transaction support
   */
  async bulkCreateWithTransaction(entries: VocabEntryCreateData[], transaction: ITransaction): Promise<VocabEntry[]> {
    const results: VocabEntry[] = [];
    
    for (const entry of entries) {
      const result = await this.createWithTransaction(entry, transaction);
      results.push(result);
    }
    
    return results;
  }
}
