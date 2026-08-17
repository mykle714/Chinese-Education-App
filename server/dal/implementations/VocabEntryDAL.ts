import { PoolClient, QueryResult } from 'pg';
import { BaseDAL } from '../base/BaseDAL.js';
import { IVocabEntryDAL } from '../interfaces/IVocabEntryDAL.js';
import { dbManager as defaultDbManager, DatabaseManager } from '../base/DatabaseManager.js';
import { VocabEntry, VocabEntryCreateData, VocabEntryUpdateData, DifficultyLevel, UsedInItem, IconLayoutItem, SnapConfig, TextColors, TextLayout, TypedMarkHistory, DefinitionCluster } from '../../types/index.js';
import { resolveDisplayDefinition, resolveDisplayPronunciation } from '../../utils/definitions.js';
import { ValidationError, NotFoundError, BulkResult, ITransaction, DALError } from '../../types/dal.js';
import db from '../../db.js';
import { DICT_COLS, DICT_JOIN } from '../shared/dictJoin.js';
import { vetTableForLanguage, vetReadFrom, VET_PHYSICAL_TABLES, vetSortedClause } from '../shared/vetTable.js';

/**
 * VocabEntry Data Access Layer implementation
 * Handles all database operations for VocabEntry entities including bulk operations
 */
export class VocabEntryDAL extends BaseDAL<VocabEntry, VocabEntryCreateData, VocabEntryUpdateData> implements IVocabEntryDAL {
  constructor(dbManager: DatabaseManager = defaultDbManager) {
    // NOTE: `vocabentries` is split per language (migration 66) into
    // vocabentries_zh / vocabentries_es. There is no single physical vet table, so
    // every read/write below routes explicitly via shared/vetTable.js. The base
    // `tableName` is left as the (now-orphaned) legacy table name only to satisfy
    // BaseDAL's constructor; all write methods that would use it are overridden.
    super(dbManager, 'vocabentries_zh', 'id');
  }

  // ── Per-language write routing (vet split, migration 66) ───────────────────
  // Inserts go to the table for the row's language. Id-based
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

  /**
   * Delete a vet row by id, from whichever physical table holds it.
   *
   * ⚠️ ALSO CLEARS THE CARD'S DECK MEMBERSHIPS. `deck_cards."vocabEntryId"` cannot
   * carry a foreign key — the vet is two physical tables sharing one id sequence,
   * so there is no single table to reference (migration 141). This delete is
   * therefore the hand-rolled ON DELETE CASCADE: without it, deleting a card would
   * leave membership rows pointing at nothing, and every deck holding that card
   * would report an inflated `cardCount` forever (the count is over membership
   * rows, which no longer join to a card).
   *
   * The two statements run in ONE TRANSACTION so the pair cannot half-apply. The
   * membership delete goes FIRST: if the vet delete then fails and rolls back,
   * nothing is lost, whereas the reverse order could commit a card deletion whose
   * cleanup never ran.
   *
   * Not user-scoped, matching the vet delete it accompanies — the vet id is
   * globally unique, and the caller has already established ownership.
   */
  async delete(id: string | number): Promise<boolean> {
    if (!id) throw new ValidationError('id is required');
    const client = await db.getClient();
    try {
      await client.query('BEGIN');
      await client.query(`DELETE FROM deck_cards WHERE "vocabEntryId" = $1`, [id]);
      let affected = 0;
      for (const table of VET_PHYSICAL_TABLES) {
        const r = await client.query(`DELETE FROM ${table} WHERE id = $1`, [id]);
        affected += r.rowCount ?? 0;
      }
      await client.query('COMMIT');
      return affected > 0;
    } catch (error) {
      // Roll back best-effort: if the ROLLBACK itself fails the connection is
      // already broken, and the original error is the one worth propagating.
      await client.query('ROLLBACK').catch(() => {});
      throw error;
    } finally {
      client.release();
    }
  }

  async updateIconLayout(
    userId: string,
    id: string | number,
    language: string,
    layout: IconLayoutItem[] | null,
    snapConfig?: SnapConfig | null,
    textColors?: TextColors | null,
    textLayout?: TextLayout | null,
    cardColor?: string | null,
    author?: string | null
  ): Promise<VocabEntry | null> {
    if (!userId) throw new ValidationError('userId is required');
    if (!id) throw new ValidationError('id is required');
    if (!language) throw new ValidationError('language is required');

    // Ownership is enforced in the WHERE (id + userId), so this is safe even though
    // it doesn't pre-read the row. Routes to the language's physical vet table.
    const table = vetTableForLanguage(language);
    // null clears the layout; an array is stored as jsonb.
    const layoutValue = layout === null ? null : JSON.stringify(layout);

    // snapConfig / textColors === undefined means "leave the column untouched" (community
    // copy path); null clears it, an object sets it. Build the SET list accordingly so the
    // editor's Save writes layout + snap + colors atomically while the copy path touches
    // only the layout column.
    const sets = [`"iconLayout" = $1::jsonb`];
    const params: (string | number | null)[] = [layoutValue];
    if (snapConfig !== undefined) {
      const snapValue = snapConfig === null ? null : JSON.stringify(snapConfig);
      params.push(snapValue);
      sets.push(`"snapConfig" = $${params.length}::jsonb`);
    }
    if (textColors !== undefined) {
      const colorsValue = textColors === null ? null : JSON.stringify(textColors);
      params.push(colorsValue);
      sets.push(`"textColors" = $${params.length}::jsonb`);
    }
    if (textLayout !== undefined) {
      const textLayoutValue = textLayout === null ? null : JSON.stringify(textLayout);
      params.push(textLayoutValue);
      sets.push(`"textLayout" = $${params.length}::jsonb`);
    }
    // cardColor is a plain hex TEXT column (migration 94), not jsonb: null clears it, a
    // validated hex string sets it. Same tri-state (undefined = leave untouched) as above.
    if (cardColor !== undefined) {
      params.push(cardColor);
      sets.push(`"cardColor" = $${params.length}::text`);
    }
    // author (migration 119) — who designed the layout being written:
    //   * a string  → force that author (the community copy path carries the ORIGINAL designer
    //                 through, so a copy never re-credits the copier),
    //   * null      → clear the attribution (the layout is no longer a design),
    //   * undefined → self-attribution, but ONLY if the layout actually changed. The CASE reads
    //                 the pre-UPDATE "iconLayout", so re-saving an untouched copied design keeps
    //                 crediting its original author. jsonb IS DISTINCT FROM is key-order-
    //                 independent, so a cosmetic re-serialization does not count as a change.
    if (author !== undefined) {
      params.push(author);
      sets.push(`author = $${params.length}::uuid`);
    } else {
      params.push(userId);
      sets.push(
        `author = CASE WHEN "iconLayout" IS DISTINCT FROM $1::jsonb THEN $${params.length}::uuid ELSE author END`,
      );
    }
    params.push(id, userId);

    const result = await this.dbManager.executeQuery<VocabEntry>(async (client) => {
      return await client.query(
        `UPDATE ${table}
            SET ${sets.join(', ')}
          WHERE id = $${params.length - 1} AND "userId" = $${params.length}
          RETURNING *`,
        params
      );
    });

    return result.recordset[0] ?? null;
  }

  // Persist (or clear) the chosen definition-cluster sense for one vet row (migration 99).
  // `selectedSense` is the cluster's `sense` label (stable identity across re-sort/re-score);
  // null clears it back to the default/starred sense. Ownership enforced in the WHERE
  // (id + userId), routed to the language's physical vet table. See docs/DEFINITION_CLUSTERS.md.
  async updateSelectedSense(
    userId: string,
    id: string | number,
    language: string,
    selectedSense: string | null
  ): Promise<VocabEntry | null> {
    if (!userId) throw new ValidationError('userId is required');
    if (!id) throw new ValidationError('id is required');
    if (!language) throw new ValidationError('language is required');

    const table = vetTableForLanguage(language);
    const result = await this.dbManager.executeQuery<VocabEntry>(async (client) => {
      return await client.query(
        `UPDATE ${table}
            SET "selectedSense" = $1::text
          WHERE id = $2 AND "userId" = $3
          RETURNING *`,
        [selectedSense, id, userId]
      );
    });

    return result.recordset[0] ?? null;
  }

  // Look up a single vet row by id, scoped to a language so it routes to that
  // language's physical table (vet is split per language — migration 66). Callers
  // resolve the language from the request / the user's active language.
  //
  // DELIBERATELY NOT bucket-filtered: this is the by-id path a mark write and a card
  // detail view come through, and a provisional card must be markable and viewable
  // while it is in play. Bucket visibility is a property of LIST reads, not of "give
  // me the row the caller already holds the id for". See docs/PROVISIONAL_CARDS.md.
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
   * Find vocabulary entries by user ID and language with pagination.
   * Sorted cards only — provisional cards are not part of the user's deck.
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
        AND ${vetSortedClause()}
        ORDER BY ve."createdAt" DESC
        LIMIT $3 OFFSET $4
      `, [userId, language, limit, offset]);
    });

    return result.recordset;
  }

  /**
   * Find vocabulary entry by user and key
   */
  async findByUserAndKey(userId: string, entryKey: string, language: string): Promise<VocabEntry | null> {
    if (!userId) {
      throw new ValidationError('User ID is required');
    }
    if (!entryKey) {
      throw new ValidationError('Entry key is required');
    }
    if (!language) {
      throw new ValidationError('Language is required');
    }

    // (userId, entryKey, language) is THE identity for both languages — the same spelling
    // can exist independently per study language, and nothing finer. Spanish used to add
    // `pos` here, so a learner held `vivir`(v) and `vivir`(n) as two separate cards; since
    // migration 123 a Spanish word is one card carrying every sense, and which sense the
    // card shows is a per-card `selectedSense` pick rather than part of its identity.
    const result = await this.dbManager.executeQuery<VocabEntry>(async (client) => {
      return await client.query(`
        SELECT ve.*, ${DICT_COLS}
        FROM ${vetReadFrom(language)} ${DICT_JOIN}
        WHERE ve."userId" = $1 AND ve."entryKey" = $2 AND ve."language" = $3
      `, [userId, entryKey, language]);
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
      // Deck size as shown to the user, so sorted cards only.
      return await client.query(`
        SELECT COUNT(*) as count FROM ${vetTableForLanguage(language)} ve
        WHERE ve."userId" = $1 AND ve."language" = $2 AND ${vetSortedClause()}
      `, [userId, language]);
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
        AND ${vetSortedClause()}
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
        AND ${vetSortedClause()}
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
        AND ${vetSortedClause()}
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
      -- Reader highlighting means "you own this word". A provisional card was handed
      -- out by a game, not chosen by the user, so it must not light up in their text.
      AND ${vetSortedClause()}
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
        // Route to the per-language vet table (vocabentries_zh / _es).
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
        AND ${vetSortedClause()}
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
        ve."selectedSense",
        de.pronunciation,
        de.definition,
        de."definitionClusters"
      FROM vocabentries_zh ve
      LEFT JOIN LATERAL (
        SELECT pronunciation, definitions->>0 as definition, "definitionClusters"
        FROM dictionaryentries_zh
        WHERE word1 = ve."entryKey" AND language = ve.language LIMIT 1
      ) de ON true
      WHERE ve."userId" = $1
        AND ve.language = $2
        AND ve."entryKey" != $3
        AND ve."entryKey" ~ $4
        -- Sorted rows only. Previously written as != 'skip', which (given the old
        -- 'library'|'skip'|NULL domain) already resolved to library-only since
        -- NULL != 'skip' is unknown. Skips now live in discover_skips (migration 80).
        -- Provisional cards (migration 140) are excluded: "related words you already
        -- know" must mean the user's own deck.
        AND ${vetSortedClause()}
      ORDER BY ve.id ASC
      LIMIT $5
    `;

    const result = await this.dbManager.executeQuery<{
      id: number;
      entrykey: string;
      selectedSense: string | null;
      pronunciation: string | null;
      definition: string | null;
      definitionClusters: DefinitionCluster[] | null;
    }>(async (client) => {
      return await client.query(query, [userId, language, word, pattern, limit]);
    });

    return result.recordset.map((row) => ({
      id: row.id,
      entryKey: row.entrykey,
      // Sense-resolved for the same reason the definition below is: a heteronym reads
      // differently per sense, so the pinyin must follow the pick the gloss follows.
      pronunciation: resolveDisplayPronunciation(row),
      // These rows are the user's OWN cards, so the related-words list is a dd surface:
      // flatten through the shared resolver (chosen sense -> definitions[0] fallback) rather
      // than shipping det's definitions[0]. The clusters themselves stay server-side.
      // See docs/DEFINITION_CLUSTERS.md.
      definition: resolveDisplayDefinition(row) || null,
    }));
  }

  /**
   * For a single Chinese character, find the multi-char words that contain it —
   * a single `LIMIT`/`OFFSET` window over one stable global ordering, so callers
   * can page through the full list (used-in infinite scroll) as well as take just
   * the leading preview (the ≤4-item list embedded on cards).
   *
   * The universe is the union of two sources, ordered vet-first then by commonality:
   *   - Pass 1 rows (`is_user = 1`): the user's own vocabentries (vet) containing the
   *     char, LEFT-JOINed to dictionaryentries_zh (det) for pronunciation/definition/
   *     "frequencyScore". These carry a real `vocabEntryId`.
   *   - Pass 2 rows (`is_user = 0`): global det words containing the char that are NOT
   *     already in the user's vet (deduped via NOT EXISTS). `vocabEntryId` is null.
   * Only words with frequencyScore 3–5 are surfaced (common enough to be useful);
   * this filter also excludes null-score rows, including in-library words whose det
   * row has no score. ORDER BY is_user DESC, "frequencyScore" DESC NULLS LAST,
   * char_length ASC, "entryKey" ASC — the user's saved (in-library) words come
   * first, then by commonality, then shortest-word-first, with entryKey as a final
   * deterministic tiebreak so pagination windows never overlap or skip.
   *
   * `position(...) > 0` is a plain substring check — no regex meta to escape.
   * Chinese-only; returns [] for non-single-character input or non-zh language.
   *
   * Referenced by: DictionaryController.usedIn (paginated endpoint) and
   * .lookupTerm / OnDeckVocabService.enrichWithUsedIn (offset-0 preview).
   */
  async findUsedInForCharacter(
    userId: string,
    character: string,
    language: string,
    limit: number = 4,
    offset: number = 0
  ): Promise<UsedInItem[]> {
    if (language !== 'zh') return [];
    if (!character) return [];
    const chars: string[] = [...character];
    if (chars.length !== 1) return [];

    const ch: string = chars[0];

    const query: string = `
      SELECT
        m."vocabEntryId",
        m."entryKey",
        m.pronunciation,
        m.definition,
        m."definitionClusters",
        m."selectedSense",
        m."frequencyScore"
      FROM (
        -- Pass 1: the user's saved words (vet) containing the char.
        SELECT
          ve.id AS "vocabEntryId",
          ve."entryKey",
          de.pronunciation,
          de.definition,
          de."definitionClusters",
          ve."selectedSense",
          de."frequencyScore",
          1 AS is_user
        FROM vocabentries_zh ve
        LEFT JOIN LATERAL (
          SELECT pronunciation, definitions->>0 AS definition, "definitionClusters", "frequencyScore"
          FROM dictionaryentries_zh
          WHERE word1 = ve."entryKey" AND language = ve.language
          LIMIT 1
        ) de ON true
        WHERE ve."userId" = $1
          AND ve.language = $2
          AND ve."entryKey" <> $3
          AND position($3 IN ve."entryKey") > 0
          AND char_length(ve."entryKey") <= 4
          -- Pass 1 is "words YOU have", so sorted only. A provisional card falls
          -- through to pass 2 and is offered as a plain dictionary word instead.
          AND ${vetSortedClause()}

        UNION ALL

        -- Pass 2: global det words containing the char, excluding the user's vet words.
        SELECT
          NULL::int AS "vocabEntryId",
          d.word1 AS "entryKey",
          d.pronunciation,
          d.definitions->>0 AS definition,
          -- Pass-2 words are NOT in the user's library, so there is no sense pick to honor:
          -- these rows deliberately keep the plain definitions[0] dd (typed NULLs keep the
          -- UNION ALL column lists aligned).
          NULL::jsonb AS "definitionClusters",
          NULL::text AS "selectedSense",
          d."frequencyScore",
          0 AS is_user
        FROM dictionaryentries_zh d
        WHERE d.language = $2
          AND char_length(d.word1) > 1
          AND char_length(d.word1) <= 4
          AND d.word1 <> $3
          AND position($3 IN d.word1) > 0
          AND NOT EXISTS (
            SELECT 1 FROM vocabentries_zh ve
            WHERE ve."userId" = $1 AND ve.language = $2 AND ve."entryKey" = d.word1
              AND ${vetSortedClause()}
          )
      ) m
      -- Only surface reasonably common words (frequencyScore 3–5); this also drops
      -- null-score rows, so an in-library word with no det score is filtered out too.
      WHERE m."frequencyScore" BETWEEN 3 AND 5
      ORDER BY m.is_user DESC, m."frequencyScore" DESC NULLS LAST, char_length(m."entryKey") ASC, m."entryKey" ASC
      LIMIT $4 OFFSET $5
    `;

    const result = await this.dbManager.executeQuery<{
      vocabEntryId: number | null;
      entryKey: string;
      pronunciation: string | null;
      definition: string | null;
      definitionClusters: DefinitionCluster[] | null;
      selectedSense: string | null;
      frequencyScore: number | null;
    }>(async (client) => {
      return await client.query(query, [userId, language, ch, limit, offset]);
    });

    return result.recordset.map((row) => ({
      vocabEntryId: row.vocabEntryId ?? null,
      entryKey: row.entryKey,
      // Pass-1 (saved) rows read out their chosen sense's pinyin; pass-2 rows carry NULL
      // clusters, so this is their plain `pronunciation` column unchanged.
      pronunciation: resolveDisplayPronunciation(row),
      // Pass-1 (saved) rows resolve to the learner's chosen sense; pass-2 rows carry NULL
      // clusters, so the resolver returns their plain definitions[0] dd unchanged.
      definition: resolveDisplayDefinition(row) || null,
      frequencyScore: row.frequencyScore ?? null,
    }));
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
   * Overwrite a vocab entry's typed mark history.
   * Used when marking cards "already learned" to seed a full (Mastered) history.
   * `category` is no longer stored — it's derived on read from typedMarkHistory
   * (migration 101), so the history IS the whole write. The lifetime counters that
   * used to be written alongside it were dropped by migration 149 (write-only).
   */
  async updateTypedMarkHistory(
    id: number,
    typedMarkHistory: TypedMarkHistory
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
          SET "typedMarkHistory" = $1
          WHERE id = $2
        `, [
          JSON.stringify(typedMarkHistory),
          id
        ]);
      }
    } catch (error: any) {
      console.error('Error updating typed mark history:', error);
      throw new DALError('Failed to update vocab entry typed mark history', 'ERR_UPDATE_MARK_HISTORY_FAILED', error);
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
