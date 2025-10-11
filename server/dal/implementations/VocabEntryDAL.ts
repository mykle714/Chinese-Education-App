import { PoolClient } from 'pg';
import { BaseDAL } from '../base/BaseDAL.js';
import { IVocabEntryDAL } from '../interfaces/IVocabEntryDAL.js';
import { dbManager } from '../base/DatabaseManager.js';
import { VocabEntry, VocabEntryCreateData, VocabEntryUpdateData, HskLevel } from '../../types/index.js';
import { ValidationError, NotFoundError, BulkResult, ITransaction } from '../../types/dal.js';

/**
 * VocabEntry Data Access Layer implementation
 * Handles all database operations for VocabEntry entities including bulk operations
 */
export class VocabEntryDAL extends BaseDAL<VocabEntry, VocabEntryCreateData, VocabEntryUpdateData> implements IVocabEntryDAL {
  constructor() {
    super(dbManager, 'VocabEntries', 'id'); // Use proper table name with camelCase columns
  }

  /**
   * Find vocabulary entries by user ID with pagination
   */
  async findByUserId(userId: string, limit: number = 100, offset: number = 0): Promise<VocabEntry[]> {
    if (!userId) {
      throw new ValidationError('User ID is required');
    }

    const result = await this.dbManager.executeQuery<VocabEntry>(async (client) => {
      return await client.query(`
        SELECT * FROM VocabEntries 
        WHERE "userId" = $1 
        ORDER BY "createdAt" DESC 
        LIMIT $2 OFFSET $3
      `, [userId, limit, offset]);
    });

    return result.recordset;
  }

  /**
   * Find vocabulary entry by user and key
   */
  async findByUserAndKey(userId: string, entryKey: string): Promise<VocabEntry | null> {
    if (!userId) {
      throw new ValidationError('User ID is required');
    }
    if (!entryKey) {
      throw new ValidationError('Entry key is required');
    }

    const result = await this.dbManager.executeQuery<VocabEntry>(async (client) => {
      return await client.query('SELECT * FROM VocabEntries WHERE "userId" = $1 AND "entryKey" = $2', [userId, entryKey]);
    });

    return result.recordset[0] || null;
  }

  /**
   * Count vocabulary entries for a user
   */
  async countByUserId(userId: string): Promise<number> {
    if (!userId) {
      throw new ValidationError('User ID is required');
    }

    const result = await this.dbManager.executeQuery<{ count: string }>(async (client) => {
      return await client.query('SELECT COUNT(*) as count FROM VocabEntries WHERE "userId" = $1', [userId]);
    });

    return parseInt(result.recordset[0].count);
  }

  /**
   * Search vocabulary entries by term
   */
  async searchEntries(userId: string, searchTerm: string, limit: number = 50): Promise<VocabEntry[]> {
    if (!userId) {
      throw new ValidationError('User ID is required');
    }
    if (!searchTerm) {
      throw new ValidationError('Search term is required');
    }

    const result = await this.dbManager.executeQuery<VocabEntry>(async (client) => {
      return await client.query(`
        SELECT * FROM VocabEntries 
        WHERE "userId" = $1 
        AND ("entryKey" ILIKE $2 OR "entryValue" ILIKE $2)
        ORDER BY "createdAt" DESC
        LIMIT $3
      `, [userId, `%${searchTerm}%`, limit]);
    });

    return result.recordset;
  }

  /**
   * Find entries by HSK level
   */
  async findByHskLevel(userId: string, hskLevel: HskLevel): Promise<VocabEntry[]> {
    if (!userId) {
      throw new ValidationError('User ID is required');
    }

    const result = await this.dbManager.executeQuery<VocabEntry>(async (client) => {
      return await client.query('SELECT * FROM VocabEntries WHERE "userId" = $1 AND "hskLevelTag" = $2 ORDER BY "createdAt" DESC', [userId, hskLevel]);
    });

    return result.recordset;
  }


  /**
   * Find vocabulary entries by tokens for reader feature
   */
  async findByTokens(userId: string, tokens: string[]): Promise<VocabEntry[]> {
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
      SELECT * FROM VocabEntries 
      WHERE "userId" = $1 
      AND "entryKey" = ANY($2)
      ORDER BY LENGTH("entryKey") DESC, "entryKey" ASC
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

        const queryResult = await client.query(sqlQuery, [userId, uniqueTokens]);
        
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
          valuePreview: entry.entryValue?.substring(0, 30) + '...',
          hskLevel: entry.hskLevelTag
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
        
        try {
          // Check if entry exists
          const existingResult = await client.query(
            'SELECT id FROM VocabEntries WHERE "userId" = $1 AND "entryKey" = $2',
            [entry.userId, entry.entryKey]
          );

          if (existingResult.rows.length > 0) {
            // Update existing entry
            await client.query(`
              UPDATE VocabEntries 
              SET "entryValue" = $1, "hskLevelTag" = $2
              WHERE "userId" = $3 AND "entryKey" = $4
            `, [
              entry.entryValue,
              entry.hskLevelTag || null,
              entry.userId,
              entry.entryKey
            ]);
            result.updated++;
          } else {
            // Insert new entry
            await client.query(`
              INSERT INTO VocabEntries ("userId", "entryKey", "entryValue", "hskLevelTag")
              VALUES ($1, $2, $3, $4)
            `, [
              entry.userId,
              entry.entryKey,
              entry.entryValue,
              entry.hskLevelTag || null
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
   * Bulk create with transaction (for external transaction management)
   */
  async bulkCreateWithTransaction(entries: VocabEntryCreateData[], transaction: ITransaction): Promise<VocabEntry[]> {
    const results: VocabEntry[] = [];
    
    for (const entry of entries) {
      const result = await this.createWithTransaction(entry, transaction);
      results.push(result);
    }
    
    return results;
  }

  /**
   * Find duplicate keys for bulk operations
   */
  async findDuplicateKeys(userId: string, entryKeys: string[]): Promise<VocabEntry[]> {
    if (!userId) {
      throw new ValidationError('User ID is required');
    }
    if (!entryKeys || entryKeys.length === 0) {
      return [];
    }

    const placeholders = entryKeys.map((_, index) => `$${index + 2}`).join(',');
    
    const result = await this.dbManager.executeQuery<VocabEntry>(async (client) => {
      return await client.query(`
        SELECT * FROM VocabEntries 
        WHERE "userId" = $1 AND "entryKey" IN (${placeholders})
      `, [userId, ...entryKeys]);
    });

    return result.recordset;
  }

  /**
   * Find entries created after a specific date
   */
  async findEntriesCreatedAfter(userId: string, date: Date): Promise<VocabEntry[]> {
    if (!userId) {
      throw new ValidationError('User ID is required');
    }

    const result = await this.dbManager.executeQuery<VocabEntry>(async (client) => {
      return await client.query('SELECT * FROM VocabEntries WHERE "userId" = $1 AND "createdAt" > $2 ORDER BY "createdAt" DESC', [userId, date]);
    });

    return result.recordset;
  }

  /**
   * Get comprehensive vocabulary statistics for a user
   */
  async getUserVocabStats(userId: string): Promise<{
    total: number;
    hskEntries: number;
    hskBreakdown: Record<HskLevel, number>;
    recentEntries: number;
  }> {
    if (!userId) {
      throw new ValidationError('User ID is required');
    }

    const weekAgo = new Date(Date.now() - 7 * 24 * 60 * 60 * 1000);

    const result = await this.dbManager.executeQuery<{
      total: string;
      hskentries: string;
      hsk1: string;
      hsk2: string;
      hsk3: string;
      hsk4: string;
      hsk5: string;
      hsk6: string;
      recententries: string;
    }>(async (client) => {
      return await client.query(`
        SELECT 
          COUNT(*) as total,
          SUM(CASE WHEN "hskLevelTag" IS NOT NULL THEN 1 ELSE 0 END) as hskentries,
          SUM(CASE WHEN "hskLevelTag" = 'HSK1' THEN 1 ELSE 0 END) as hsk1,
          SUM(CASE WHEN "hskLevelTag" = 'HSK2' THEN 1 ELSE 0 END) as hsk2,
          SUM(CASE WHEN "hskLevelTag" = 'HSK3' THEN 1 ELSE 0 END) as hsk3,
          SUM(CASE WHEN "hskLevelTag" = 'HSK4' THEN 1 ELSE 0 END) as hsk4,
          SUM(CASE WHEN "hskLevelTag" = 'HSK5' THEN 1 ELSE 0 END) as hsk5,
          SUM(CASE WHEN "hskLevelTag" = 'HSK6' THEN 1 ELSE 0 END) as hsk6,
          SUM(CASE WHEN "createdAt" > $2 THEN 1 ELSE 0 END) as recententries
        FROM VocabEntries 
        WHERE "userId" = $1
      `, [userId, weekAgo]);
    });

    const stats = result.recordset[0];
    
    return {
      total: parseInt(stats.total),
      hskEntries: parseInt(stats.hskentries),
      hskBreakdown: {
        HSK1: parseInt(stats.hsk1),
        HSK2: parseInt(stats.hsk2),
        HSK3: parseInt(stats.hsk3),
        HSK4: parseInt(stats.hsk4),
        HSK5: parseInt(stats.hsk5),
        HSK6: parseInt(stats.hsk6)
      },
      recentEntries: parseInt(stats.recententries)
    };
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
    if (!data.entryValue) {
      throw new ValidationError('Entry value is required');
    }
    
    // Validate HSK level if provided
    if (data.hskLevelTag && !['HSK1', 'HSK2', 'HSK3', 'HSK4', 'HSK5', 'HSK6'].includes(data.hskLevelTag)) {
      throw new ValidationError('Invalid HSK level. Must be HSK1, HSK2, HSK3, HSK4, HSK5, or HSK6');
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
    if (!data.entryValue) {
      throw new ValidationError('Entry value is required');
    }
    
    // Validate HSK level if provided
    if (data.hskLevelTag && !['HSK1', 'HSK2', 'HSK3', 'HSK4', 'HSK5', 'HSK6'].includes(data.hskLevelTag)) {
      throw new ValidationError('Invalid HSK level. Must be HSK1, HSK2, HSK3, HSK4, HSK5, or HSK6');
    }
  }
}
