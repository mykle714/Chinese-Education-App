import db from '../db.js';
import { OnDeckVocabSet, OnDeckVocabSetCreateData, OnDeckVocabSetUpdateData, CustomError } from '../types/index.js';

/**
 * Get all on-deck vocab sets for a specific user
 */
export async function getAllOnDeckSetsForUser(userId: string): Promise<OnDeckVocabSet[]> {
  try {
    const pool = await db.poolPromise;
    const result = await pool
      .request()
      .input('userId', db.sql.UniqueIdentifier, userId)
      .query(`
        SELECT userId, featureName, vocabEntryIds, updatedAt
        FROM OnDeckVocabSets
        WHERE userId = @userId
        ORDER BY featureName
      `);

    return result.recordset.map(row => ({
      userId: row.userId,
      featureName: row.featureName,
      vocabEntryIds: JSON.parse(row.vocabEntryIds),
      updatedAt: row.updatedAt
    }));
  } catch (error: any) {
    console.error('Error getting all on-deck sets for user:', error);
    const customError: CustomError = new Error('Failed to retrieve on-deck vocab sets');
    customError.code = 'ERR_GET_ONDECK_SETS_FAILED';
    customError.statusCode = 500;
    throw customError;
  }
}

/**
 * Get a specific on-deck vocab set by user ID and feature name
 */
export async function getOnDeckSet(userId: string, featureName: string): Promise<OnDeckVocabSet | null> {
  try {
    const pool = await db.poolPromise;
    const result = await pool
      .request()
      .input('userId', db.sql.UniqueIdentifier, userId)
      .input('featureName', db.sql.VarChar(100), featureName)
      .query(`
        SELECT userId, featureName, vocabEntryIds, updatedAt
        FROM OnDeckVocabSets
        WHERE userId = @userId AND featureName = @featureName
      `);

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
  } catch (error: any) {
    console.error('Error getting on-deck set:', error);
    const customError: CustomError = new Error('Failed to retrieve on-deck vocab set');
    customError.code = 'ERR_GET_ONDECK_SET_FAILED';
    customError.statusCode = 500;
    throw customError;
  }
}

/**
 * Validate that all vocab entry IDs exist and belong to the specified user
 */
export async function validateVocabEntryIds(userId: string, entryIds: number[]): Promise<void> {
  if (entryIds.length === 0) {
    return; // Empty array is valid
  }

  try {
    const pool = await db.poolPromise;
    
    // For simplicity, we'll validate each ID individually instead of using table-valued parameters
    // This is less efficient but more straightforward for the validation logic
    const placeholders = entryIds.map((_, index) => `@id${index}`).join(',');
    const request = pool.request().input('userId', db.sql.UniqueIdentifier, userId);
    
    entryIds.forEach((id, index) => {
      request.input(`id${index}`, db.sql.Int, id);
    });

    const result = await request.query(`
      SELECT COUNT(*) as validCount
      FROM VocabEntries
      WHERE userId = @userId AND id IN (${placeholders})
    `);

    const validCount = result.recordset[0].validCount;
    if (validCount !== entryIds.length) {
      const customError: CustomError = new Error('One or more vocab entry IDs are invalid or do not belong to this user');
      customError.code = 'ERR_INVALID_VOCAB_ENTRY_IDS';
      customError.statusCode = 403;
      throw customError;
    }
  } catch (error: any) {
    if (error.code === 'ERR_INVALID_VOCAB_ENTRY_IDS') {
      throw error; // Re-throw our custom error
    }
    console.error('Error validating vocab entry IDs:', error);
    const customError: CustomError = new Error('Failed to validate vocab entry IDs');
    customError.code = 'ERR_VALIDATE_IDS_FAILED';
    customError.statusCode = 500;
    throw customError;
  }
}

/**
 * Create or update an on-deck vocab set (upsert operation)
 */
export async function createOrUpdateOnDeckSet(userId: string, data: OnDeckVocabSetCreateData): Promise<OnDeckVocabSet> {
  // Validate input
  if (!data.featureName || data.featureName.trim() === '') {
    const customError: CustomError = new Error('Feature name is required');
    customError.code = 'ERR_MISSING_FEATURE_NAME';
    customError.statusCode = 400;
    throw customError;
  }

  if (!Array.isArray(data.vocabEntryIds)) {
    const customError: CustomError = new Error('vocabEntryIds must be an array');
    customError.code = 'ERR_INVALID_VOCAB_ENTRY_IDS_FORMAT';
    customError.statusCode = 400;
    throw customError;
  }

  if (data.vocabEntryIds.length > 30) {
    const customError: CustomError = new Error('Maximum of 30 vocab entries allowed per set');
    customError.code = 'ERR_TOO_MANY_ENTRIES';
    customError.statusCode = 400;
    throw customError;
  }

  // Validate that all vocab entry IDs exist and belong to the user
  await validateVocabEntryIds(userId, data.vocabEntryIds);

  try {
    const pool = await db.poolPromise;
    const result = await pool
      .request()
      .input('userId', db.sql.UniqueIdentifier, userId)
      .input('featureName', db.sql.VarChar(100), data.featureName.trim())
      .input('vocabEntryIds', db.sql.NVarChar(db.sql.MAX), JSON.stringify(data.vocabEntryIds))
      .query(`
        MERGE OnDeckVocabSets AS target
        USING (VALUES (@userId, @featureName, @vocabEntryIds)) AS source (userId, featureName, vocabEntryIds)
        ON target.userId = source.userId AND target.featureName = source.featureName
        WHEN MATCHED THEN 
          UPDATE SET vocabEntryIds = source.vocabEntryIds, updatedAt = getdate()
        WHEN NOT MATCHED THEN
          INSERT (userId, featureName, vocabEntryIds) 
          VALUES (source.userId, source.featureName, source.vocabEntryIds)
        OUTPUT INSERTED.userId, INSERTED.featureName, INSERTED.vocabEntryIds, INSERTED.updatedAt;
      `);

    if (result.recordset.length === 0) {
      const customError: CustomError = new Error('Failed to create or update on-deck vocab set');
      customError.code = 'ERR_UPSERT_FAILED';
      customError.statusCode = 500;
      throw customError;
    }

    const row = result.recordset[0];
    return {
      userId: row.userId,
      featureName: row.featureName,
      vocabEntryIds: JSON.parse(row.vocabEntryIds),
      updatedAt: row.updatedAt
    };
  } catch (error: any) {
    if (error.code && error.code.startsWith('ERR_')) {
      throw error; // Re-throw our custom errors
    }
    console.error('Error creating or updating on-deck set:', error);
    const customError: CustomError = new Error('Failed to create or update on-deck vocab set');
    customError.code = 'ERR_UPSERT_ONDECK_SET_FAILED';
    customError.statusCode = 500;
    throw customError;
  }
}

/**
 * Delete an on-deck vocab set
 */
export async function deleteOnDeckSet(userId: string, featureName: string): Promise<boolean> {
  try {
    const pool = await db.poolPromise;
    const result = await pool
      .request()
      .input('userId', db.sql.UniqueIdentifier, userId)
      .input('featureName', db.sql.VarChar(100), featureName)
      .query(`
        DELETE FROM OnDeckVocabSets
        WHERE userId = @userId AND featureName = @featureName
      `);

    return result.rowsAffected[0] > 0;
  } catch (error: any) {
    console.error('Error deleting on-deck set:', error);
    const customError: CustomError = new Error('Failed to delete on-deck vocab set');
    customError.code = 'ERR_DELETE_ONDECK_SET_FAILED';
    customError.statusCode = 500;
    throw customError;
  }
}
