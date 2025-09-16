import { PoolClient } from 'pg';
import { OnDeckVocabSet, OnDeckVocabSetCreateData } from '../../types/index.js';
import { IOnDeckVocabDAL } from '../interfaces/IOnDeckVocabDAL.js';
import { BaseDAL } from '../base/BaseDAL.js';
import { dbManager } from '../base/DatabaseManager.js';
import { DALError, ValidationError, NotFoundError } from '../../types/dal.js';

/**
 * OnDeck Vocabulary Set Data Access Layer implementation
 * Handles all database operations for OnDeck vocabulary sets
 */
export class OnDeckVocabDAL extends BaseDAL<OnDeckVocabSet, OnDeckVocabSetCreateData, OnDeckVocabSetCreateData> implements IOnDeckVocabDAL {
  constructor() {
    super(dbManager, 'OnDeckVocabSets'); // Use proper table name with camelCase columns
  }

  /**
   * Get all on-deck vocab sets for a specific user
   */
  async getAllSetsForUser(userId: string): Promise<OnDeckVocabSet[]> {
    const result = await this.dbManager.executeQuery<{
      userId: string;
      featureName: string;
      vocabEntryIds: string;
      updatedAt: Date;
    }>(async (client) => {
      return await client.query(`
        SELECT "userId", "featureName", "vocabEntryIds", "updatedAt"
        FROM OnDeckVocabSets
        WHERE "userId" = $1
        ORDER BY "featureName"
      `, [userId]);
    });

    return result.recordset.map(row => ({
      userId: row.userId,
      featureName: row.featureName,
      vocabEntryIds: JSON.parse(row.vocabEntryIds),
      updatedAt: row.updatedAt
    }));
  }

  /**
   * Get a specific on-deck vocab set by user ID and feature name
   */
  async getSetByUserAndFeature(userId: string, featureName: string): Promise<OnDeckVocabSet | null> {
    const result = await this.dbManager.executeQuery<{
      userId: string;
      featureName: string;
      vocabEntryIds: string;
      updatedAt: Date;
    }>(async (client) => {
      return await client.query(`
        SELECT "userId", "featureName", "vocabEntryIds", "updatedAt"
        FROM OnDeckVocabSets
        WHERE "userId" = $1 AND "featureName" = $2
      `, [userId, featureName]);
    });

    if (result.recordset.length === 0) {
      return null;
    }

    const row = result.recordset[0];
    return {
      userId: row.userId,
      featureName: row.featureName,
      vocabEntryIds: JSON.parse(row.vocabEntryIds),
      updatedAt: row.updatedAt
    };
  }

  /**
   * Create or update an on-deck vocab set (upsert operation)
   */
  async upsertSet(userId: string, data: OnDeckVocabSetCreateData): Promise<OnDeckVocabSet> {
    // Validate input
    if (!data.featureName || data.featureName.trim() === '') {
      throw new ValidationError('Feature name is required', 'ERR_MISSING_FEATURE_NAME');
    }

    if (!Array.isArray(data.vocabEntryIds)) {
      throw new ValidationError('vocabEntryIds must be an array', 'ERR_INVALID_VOCAB_ENTRY_IDS_FORMAT');
    }

    if (data.vocabEntryIds.length > 30) {
      throw new ValidationError('Maximum of 30 vocab entries allowed per set', 'ERR_TOO_MANY_ENTRIES');
    }

    // Validate that all vocab entry IDs exist and belong to the user
    await this.validateVocabEntryIds(userId, data.vocabEntryIds);

    const result = await this.dbManager.executeQuery<{
      userId: string;
      featureName: string;
      vocabEntryIds: string;
      updatedAt: Date;
    }>(async (client) => {
      return await client.query(`
        INSERT INTO OnDeckVocabSets ("userId", "featureName", "vocabEntryIds", "updatedAt")
        VALUES ($1, $2, $3, NOW())
        ON CONFLICT ("userId", "featureName")
        DO UPDATE SET 
          "vocabEntryIds" = EXCLUDED."vocabEntryIds",
          "updatedAt" = NOW()
        RETURNING "userId", "featureName", "vocabEntryIds", "updatedAt"
      `, [userId, data.featureName.trim(), JSON.stringify(data.vocabEntryIds)]);
    });

    if (result.recordset.length === 0) {
      throw new DALError('Failed to create or update on-deck vocab set', 'ERR_UPSERT_FAILED');
    }

    const row = result.recordset[0];
    return {
      userId: row.userId,
      featureName: row.featureName,
      vocabEntryIds: JSON.parse(row.vocabEntryIds),
      updatedAt: row.updatedAt
    };
  }

  /**
   * Delete an on-deck vocab set by user ID and feature name
   */
  async deleteSetByUserAndFeature(userId: string, featureName: string): Promise<boolean> {
    const result = await this.dbManager.executeQuery(async (client) => {
      return await client.query(`
        DELETE FROM OnDeckVocabSets
        WHERE "userId" = $1 AND "featureName" = $2
      `, [userId, featureName]);
    });

    return result.rowsAffected > 0;
  }

  /**
   * Validate that all vocab entry IDs exist and belong to the specified user
   */
  async validateVocabEntryIds(userId: string, entryIds: number[]): Promise<void> {
    if (entryIds.length === 0) {
      return; // Empty array is valid
    }

    // Create placeholders for parameterized query
    const placeholders = entryIds.map((_, index) => `$${index + 2}`).join(',');
    
    const result = await this.dbManager.executeQuery<{ validcount: string }>(async (client) => {
      return await client.query(`
        SELECT COUNT(*) as validcount
        FROM VocabEntries
        WHERE "userId" = $1 AND id IN (${placeholders})
      `, [userId, ...entryIds]);
    });

    const validCount = parseInt(result.recordset[0].validcount);
    if (validCount !== entryIds.length) {
      throw new ValidationError(
        'One or more vocab entry IDs are invalid or do not belong to this user',
        'ERR_INVALID_VOCAB_ENTRY_IDS'
      );
    }
  }

  /**
   * Get statistics for a user's on-deck sets
   */
  async getUserSetStats(userId: string): Promise<{
    totalSets: number;
    totalEntries: number;
    averageEntriesPerSet: number;
    lastUpdated: Date | null;
  }> {
    const result = await this.dbManager.executeQuery<{
      totalsets: string;
      totalentries: string;
      lastupdated: Date | null;
    }>(async (client) => {
      return await client.query(`
        SELECT 
          COUNT(*) as totalsets,
          COALESCE(SUM(jsonb_array_length("vocabEntryIds"::jsonb)), 0) as totalentries,
          MAX("updatedAt") as lastupdated
        FROM OnDeckVocabSets
        WHERE "userId" = $1
      `, [userId]);
    });

    const row = result.recordset[0];
    const totalSets = parseInt(row.totalsets) || 0;
    const totalEntries = parseInt(row.totalentries) || 0;
    
    return {
      totalSets,
      totalEntries,
      averageEntriesPerSet: totalSets > 0 ? Math.round((totalEntries / totalSets) * 100) / 100 : 0,
      lastUpdated: row.lastupdated || null
    };
  }

  // Base CRUD operations (inherited from BaseDAL but customized for OnDeck composite key)
  
  /**
   * Find by ID - Not applicable for OnDeck sets (use getSetByUserAndFeature instead)
   */
  async findById(id: any): Promise<OnDeckVocabSet | null> {
    throw new DALError('findById not supported for OnDeck sets. Use getSetByUserAndFeature instead.', 'ERR_OPERATION_NOT_SUPPORTED');
  }

  /**
   * Create - Use upsertSet instead for OnDeck sets
   */
  async create(data: OnDeckVocabSetCreateData): Promise<OnDeckVocabSet> {
    throw new DALError('create not supported for OnDeck sets. Use upsertSet instead.', 'ERR_OPERATION_NOT_SUPPORTED');
  }

  /**
   * Update - Use upsertSet instead for OnDeck sets
   */
  async update(id: any, data: OnDeckVocabSetCreateData): Promise<OnDeckVocabSet | null> {
    throw new DALError('update not supported for OnDeck sets. Use upsertSet instead.', 'ERR_OPERATION_NOT_SUPPORTED');
  }

  /**
   * Delete - Use deleteSetByUserAndFeature instead for OnDeck sets
   */
  async delete(id: any): Promise<boolean> {
    throw new DALError('delete not supported for OnDeck sets. Use deleteSetByUserAndFeature instead.', 'ERR_OPERATION_NOT_SUPPORTED');
  }
}
