import db from '../db.js';
import { VocabEntry, VocabEntryCreateData, VocabEntryUpdateData, CustomError } from '../types/index.js';
import { Readable } from 'stream';
import csv from 'csv-parser';

// Industry-standard import interfaces
export interface ImportProgress {
  processed: number;
  imported: number;
  updated: number;
  skipped: number;
  errors: ImportError[];
  status: 'processing' | 'completed' | 'failed';
  totalRows?: number;
}

export interface ImportError {
  row: number;
  data: any;
  error: string;
}

export interface ImportOptions {
  batchSize?: number;
  skipDuplicates?: boolean;
  updateExisting?: boolean;
  validateOnly?: boolean;
}

export interface CSVRow {
  front: string;
  back: string;
  hint?: string;
  publishedAt?: string;
}

export async function getPaginatedVocabEntries(limit: number, offset: number): Promise<VocabEntry[]> {
  try {
    const pool = await db.createConnection();
    const result = await pool
      .request()
      .input('limit', db.sql.Int, limit)
      .input('offset', db.sql.Int, offset)
      .query('SELECT * FROM VocabEntries ORDER BY createdAt DESC OFFSET @offset ROWS FETCH NEXT @limit ROWS ONLY');
    return result.recordset;
  } catch (error: any) {
    console.error('Error getting paginated vocab entries:', error);
    const customError: CustomError = new Error('Failed to retrieve vocabulary entries');
    customError.code = 'ERR_FETCH_ENTRIES_FAILED';
    customError.statusCode = 500;
    throw customError;
  }
}

export async function getVocabEntriesCount(): Promise<number> {
  try {
    const pool = await db.createConnection();
    const result = await pool
      .request()
      .query('SELECT COUNT(*) as count FROM VocabEntries');
    return result.recordset[0].count;
  } catch (error: any) {
    console.error('Error getting vocab entries count:', error);
    const customError: CustomError = new Error('Failed to retrieve vocabulary entries count');
    customError.code = 'ERR_FETCH_COUNT_FAILED';
    customError.statusCode = 500;
    throw customError;
  }
}

export async function getAllVocabEntries(): Promise<VocabEntry[]> {
  try {
    const pool = await db.createConnection();
    const result = await pool.request().query('SELECT id, userId, entryKey, entryValue, isCustomTag, hskLevelTag, createdAt FROM VocabEntries');
    return result.recordset;
  } catch (error: any) {
    console.error('Error getting all vocab entries:', error);
    const customError: CustomError = new Error('Failed to retrieve vocabulary entries');
    customError.code = 'ERR_FETCH_ENTRIES_FAILED';
    customError.statusCode = 500;
    throw customError;
  }
}

export async function getVocabEntryById(id: number): Promise<VocabEntry> {
  try {
    if (!id) {
      const error: CustomError = new Error('Entry ID is required');
      error.code = 'ERR_MISSING_ENTRY_ID';
      error.statusCode = 400;
      throw error;
    }
    
    const pool = await db.createConnection();
    const result = await pool
      .request()
      .input('id', db.sql.Int, id)
      .query('SELECT * FROM VocabEntries WHERE id = @id');
    
    if (result.recordset.length === 0) {
      const error: CustomError = new Error('Vocabulary entry not found');
      error.code = 'ERR_ENTRY_NOT_FOUND';
      error.statusCode = 404;
      throw error;
    }
    
    return result.recordset[0];
  } catch (error: any) {
    console.error('Error getting vocab entry by id:', error);
    // If it's already a custom error with a code, just rethrow it
    if (error.code && error.statusCode) {
      throw error;
    }
    // Otherwise, create a new error with a code
    const customError: CustomError = new Error('Failed to retrieve vocabulary entry');
    customError.code = 'ERR_FETCH_ENTRY_FAILED';
    customError.statusCode = 500;
    throw customError;
  }
}

export async function createVocabEntry(data: VocabEntryCreateData): Promise<VocabEntry> {
  try {
    console.log('🔍 DEBUG createVocabEntry - Input data:', JSON.stringify(data, null, 2));
    
    // Validate that userId is provided
    if (!data.userId) {
      const error: CustomError = new Error('userId is required');
      error.code = 'ERR_MISSING_USERID';
      error.statusCode = 400;
      throw error;
    }
    
    if (!data.entryKey) {
      const error: CustomError = new Error('Entry key is required');
      error.code = 'ERR_MISSING_ENTRY_KEY';
      error.statusCode = 400;
      throw error;
    }
    
    if (!data.entryValue) {
      const error: CustomError = new Error('Entry value is required');
      error.code = 'ERR_MISSING_ENTRY_VALUE';
      error.statusCode = 400;
      throw error;
    }

    // Validate HSK level if provided
    if (data.hskLevelTag && !['HSK1', 'HSK2', 'HSK3', 'HSK4', 'HSK5', 'HSK6'].includes(data.hskLevelTag)) {
      const error: CustomError = new Error('Invalid HSK level. Must be HSK1, HSK2, HSK3, HSK4, HSK5, or HSK6');
      error.code = 'ERR_INVALID_HSK_LEVEL';
      error.statusCode = 400;
      throw error;
    }

    console.log('🔍 DEBUG - Getting database pool...');
    // First check if the user exists
    const pool = await db.createConnection();
    console.log('🔍 DEBUG - Pool obtained, checking if user exists...');
    
    const userCheck = await pool
      .request()
      .input('userId', db.sql.UniqueIdentifier, data.userId)
      .query('SELECT id FROM Users WHERE id = @userId');
    
    console.log('🔍 DEBUG - User check result:', userCheck.recordset.length, 'users found');
    
    if (userCheck.recordset.length === 0) {
      const error: CustomError = new Error('User does not exist');
      error.code = 'ERR_USER_NOT_FOUND';
      error.statusCode = 404;
      throw error;
    }

    // Set isCustomTag to true by default for UI-created entries
    const isCustomTag = data.isCustomTag !== undefined ? data.isCustomTag : true;
    console.log('🔍 DEBUG - About to insert with isCustomTag:', isCustomTag);

    // Insert the vocab entry with tag fields
    console.log('🔍 DEBUG - Executing INSERT query...');
    const result = await pool
      .request()
      .input('userId', db.sql.UniqueIdentifier, data.userId)
      .input('entryKey', db.sql.NVarChar, data.entryKey)
      .input('entryValue', db.sql.NVarChar, data.entryValue)
      .input('isCustomTag', db.sql.Bit, isCustomTag)
      .input('hskLevelTag', db.sql.VarChar(10), data.hskLevelTag || null)
      .query('INSERT INTO VocabEntries (userId, entryKey, entryValue, isCustomTag, hskLevelTag) OUTPUT INSERTED.* VALUES (@userId, @entryKey, @entryValue, @isCustomTag, @hskLevelTag)');
    
    console.log('🔍 DEBUG - INSERT successful, result:', result.recordset[0]);
    return result.recordset[0];
  } catch (error: any) {
    console.error('❌ ERROR in createVocabEntry:', error);
    console.error('❌ ERROR details:', {
      message: error.message,
      code: error.code,
      number: error.number,
      state: error.state,
      class: error.class,
      serverName: error.serverName,
      procName: error.procName,
      lineNumber: error.lineNumber,
      stack: error.stack
    });
    
    // If it's already a custom error with a code, just rethrow it
    if (error.code && error.statusCode) {
      throw error;
    }
    // Otherwise, create a new error with a code
    const customError: CustomError = new Error('Failed to create vocabulary entry');
    customError.code = 'ERR_CREATE_ENTRY_FAILED';
    customError.statusCode = 500;
    throw customError;
  }
}

export async function updateVocabEntry(id: number, data: VocabEntryUpdateData): Promise<VocabEntry> {
  try {
    if (!id) {
      const error: CustomError = new Error('Entry ID is required');
      error.code = 'ERR_MISSING_ENTRY_ID';
      error.statusCode = 400;
      throw error;
    }
    
    if (!data.entryKey) {
      const error: CustomError = new Error('Entry key is required');
      error.code = 'ERR_MISSING_ENTRY_KEY';
      error.statusCode = 400;
      throw error;
    }
    
    if (!data.entryValue) {
      const error: CustomError = new Error('Entry value is required');
      error.code = 'ERR_MISSING_ENTRY_VALUE';
      error.statusCode = 400;
      throw error;
    }

    // Validate HSK level if provided
    if (data.hskLevelTag && !['HSK1', 'HSK2', 'HSK3', 'HSK4', 'HSK5', 'HSK6'].includes(data.hskLevelTag)) {
      const error: CustomError = new Error('Invalid HSK level. Must be HSK1, HSK2, HSK3, HSK4, HSK5, or HSK6');
      error.code = 'ERR_INVALID_HSK_LEVEL';
      error.statusCode = 400;
      throw error;
    }
    
    const pool = await db.createConnection();
    
    // Build dynamic query based on provided fields
    let updateFields = ['entryKey = @entryKey', 'entryValue = @entryValue'];
    const request = pool.request()
      .input('id', db.sql.Int, id)
      .input('entryKey', db.sql.NVarChar, data.entryKey)
      .input('entryValue', db.sql.NVarChar, data.entryValue);

    // Add tag fields if provided
    if (data.isCustomTag !== undefined) {
      updateFields.push('isCustomTag = @isCustomTag');
      request.input('isCustomTag', db.sql.Bit, data.isCustomTag);
    }
    
    if (data.hskLevelTag !== undefined) {
      updateFields.push('hskLevelTag = @hskLevelTag');
      request.input('hskLevelTag', db.sql.VarChar(10), data.hskLevelTag);
    }

    const result = await request
      .query(`UPDATE VocabEntries SET ${updateFields.join(', ')} OUTPUT INSERTED.* WHERE id = @id`);
    
    if (result.recordset.length === 0) {
      const error: CustomError = new Error('Vocabulary entry not found');
      error.code = 'ERR_ENTRY_NOT_FOUND';
      error.statusCode = 404;
      throw error;
    }
    
    return result.recordset[0];
  } catch (error: any) {
    console.error('Error updating vocab entry:', error);
    // If it's already a custom error with a code, just rethrow it
    if (error.code && error.statusCode) {
      throw error;
    }
    // Otherwise, create a new error with a code
    const customError: CustomError = new Error('Failed to update vocabulary entry');
    customError.code = 'ERR_UPDATE_ENTRY_FAILED';
    customError.statusCode = 500;
    throw customError;
  }
}

export async function deleteVocabEntry(id: number): Promise<{ id: number }> {
  try {
    if (!id) {
      const error: CustomError = new Error('Entry ID is required');
      error.code = 'ERR_MISSING_ENTRY_ID';
      error.statusCode = 400;
      throw error;
    }
    
    const pool = await db.createConnection();
    const checkResult = await pool
      .request()
      .input('id', db.sql.Int, id)
      .query('SELECT id FROM VocabEntries WHERE id = @id');
    
    if (checkResult.recordset.length === 0) {
      const error: CustomError = new Error('Vocabulary entry not found');
      error.code = 'ERR_ENTRY_NOT_FOUND';
      error.statusCode = 404;
      throw error;
    }
    
    await pool
      .request()
      .input('id', db.sql.Int, id)
      .query('DELETE FROM VocabEntries WHERE id = @id');
    return { id };
  } catch (error: any) {
    console.error('Error deleting vocab entry:', error);
    // If it's already a custom error with a code, just rethrow it
    if (error.code && error.statusCode) {
      throw error;
    }
    // Otherwise, create a new error with a code
    const customError: CustomError = new Error('Failed to delete vocabulary entry');
    customError.code = 'ERR_DELETE_ENTRY_FAILED';
    customError.statusCode = 500;
    throw customError;
  }
}

// Industry-standard streaming CSV import with batch processing
export async function importVocabEntriesFromStream(
  userId: string,
  fileStream: Readable,
  options: ImportOptions = {},
  progressCallback?: (progress: ImportProgress) => void
): Promise<ImportProgress> {
  const {
    batchSize = 100,
    skipDuplicates = false,
    updateExisting = true,
    validateOnly = false
  } = options;

  const progress: ImportProgress = {
    processed: 0,
    imported: 0,
    updated: 0,
    skipped: 0,
    errors: [],
    status: 'processing'
  };

  try {
    // Validate user exists
    const pool = await db.createConnection();
    const userCheck = await pool
      .request()
      .input('userId', db.sql.UniqueIdentifier, userId)
      .query('SELECT id FROM Users WHERE id = @userId');
    
    if (userCheck.recordset.length === 0) {
      const error: CustomError = new Error('User does not exist');
      error.code = 'ERR_USER_NOT_FOUND';
      error.statusCode = 404;
      throw error;
    }

    let batch: CSVRow[] = [];
    let rowNumber = 0;

    return new Promise((resolve, reject) => {
      fileStream
        .pipe(csv({
          mapHeaders: ({ header }) => header.trim().toLowerCase(),
          skipEmptyLines: true,
          skipLinesWithError: true
        }))
        .on('data', async (row: any) => {
          rowNumber++;
          
          try {
            // Validate row data
            const csvRow = validateCSVRow(row, rowNumber);
            batch.push(csvRow);

            // Process batch when it reaches the batch size
            if (batch.length >= batchSize) {
              await processBatch(userId, batch, progress, validateOnly, updateExisting, skipDuplicates);
              batch = [];
              
              // Report progress
              if (progressCallback) {
                progressCallback({ ...progress });
              }
            }
          } catch (error: any) {
            progress.errors.push({
              row: rowNumber,
              data: row,
              error: error.message
            });
          }
          
          progress.processed = rowNumber;
        })
        .on('end', async () => {
          try {
            // Process remaining batch
            if (batch.length > 0) {
              await processBatch(userId, batch, progress, validateOnly, updateExisting, skipDuplicates);
            }

            progress.status = 'completed';
            if (progressCallback) {
              progressCallback({ ...progress });
            }
            resolve(progress);
          } catch (error) {
            progress.status = 'failed';
            reject(error);
          }
        })
        .on('error', (error) => {
          progress.status = 'failed';
          progress.errors.push({
            row: rowNumber,
            data: null,
            error: `Stream error: ${error.message}`
          });
          reject(error);
        });
    });

  } catch (error: any) {
    progress.status = 'failed';
    console.error('Error importing vocab entries:', error);
    
    if (error.code && error.statusCode) {
      throw error;
    }
    
    const customError: CustomError = new Error('Failed to import vocabulary entries');
    customError.code = 'ERR_IMPORT_FAILED';
    customError.statusCode = 500;
    throw customError;
  }
}

// Validate and normalize CSV row data
function validateCSVRow(row: any, rowNumber: number): CSVRow {
  const front = row.front?.toString().trim();
  const back = row.back?.toString().trim();
  
  if (!front) {
    throw new Error(`Row ${rowNumber}: 'front' field is required`);
  }
  
  if (!back) {
    throw new Error(`Row ${rowNumber}: 'back' field is required`);
  }

  return {
    front,
    back,
    hint: row.hint?.toString().trim() || '',
    publishedAt: row.publishedat?.toString().trim() || row.published_at?.toString().trim() || ''
  };
}

// Process a batch of entries with transaction support
async function processBatch(
  userId: string,
  batch: CSVRow[],
  progress: ImportProgress,
  validateOnly: boolean,
  updateExisting: boolean,
  skipDuplicates: boolean
): Promise<void> {
  if (validateOnly) {
    // Just validate without inserting
    progress.imported += batch.length;
    return;
  }

  const pool = await db.createConnection();
  const transaction = pool.transaction();

  try {
    await transaction.begin();

    for (const row of batch) {
      try {
        // Check if entry already exists
        const existingCheck = await transaction
          .request()
          .input('userId', db.sql.UniqueIdentifier, userId)
          .input('entryKey', db.sql.NVarChar, row.front)
          .query('SELECT id FROM VocabEntries WHERE userId = @userId AND entryKey = @entryKey');

        if (existingCheck.recordset.length > 0) {
          if (updateExisting) {
            // Update existing entry
            await transaction
              .request()
              .input('userId', db.sql.UniqueIdentifier, userId)
              .input('entryKey', db.sql.NVarChar, row.front)
              .input('entryValue', db.sql.NVarChar, row.back)
              .query('UPDATE VocabEntries SET entryValue = @entryValue WHERE userId = @userId AND entryKey = @entryKey');
            progress.updated++;
          } else if (skipDuplicates) {
            progress.skipped++;
          } else {
            // Throw error for duplicate
            throw new Error(`Duplicate entry found: ${row.front}`);
          }
        } else {
          // Insert new entry with isCustomTag set to true for CSV imports
          await transaction
            .request()
            .input('userId', db.sql.UniqueIdentifier, userId)
            .input('entryKey', db.sql.NVarChar, row.front)
            .input('entryValue', db.sql.NVarChar, row.back)
            .input('isCustomTag', db.sql.Bit, true)
            .query('INSERT INTO VocabEntries (userId, entryKey, entryValue, isCustomTag) VALUES (@userId, @entryKey, @entryValue, @isCustomTag)');
          progress.imported++;
        }
      } catch (error: any) {
        progress.errors.push({
          row: progress.processed,
          data: row,
          error: error.message
        });
      }
    }

    await transaction.commit();
  } catch (error: any) {
    await transaction.rollback();
    throw error;
  }
}

// Legacy bulk upsert function for backward compatibility
export async function bulkUpsertVocabEntries(userId: string, entries: { entryKey: string; entryValue: string }[]): Promise<{ upserted: number }> {
  try {
    if (!userId) {
      const error: CustomError = new Error('userId is required');
      error.code = 'ERR_MISSING_USERID';
      error.statusCode = 400;
      throw error;
    }

    if (!entries || entries.length === 0) {
      return { upserted: 0 };
    }

    // Validate entries
    for (const entry of entries) {
      if (!entry.entryKey || !entry.entryValue) {
        const error: CustomError = new Error('All entries must have entryKey and entryValue');
        error.code = 'ERR_INVALID_ENTRY_DATA';
        error.statusCode = 400;
        throw error;
      }
    }

    const pool = await db.createConnection();
    
    // First check if the user exists
    const userCheck = await pool
      .request()
      .input('userId', db.sql.UniqueIdentifier, userId)
      .query('SELECT id FROM Users WHERE id = @userId');
    
    if (userCheck.recordset.length === 0) {
      const error: CustomError = new Error('User does not exist');
      error.code = 'ERR_USER_NOT_FOUND';
      error.statusCode = 404;
      throw error;
    }

    let upsertedCount = 0;

    // Process each entry with upsert logic
    for (const entry of entries) {
      try {
        const result = await pool
          .request()
          .input('userId', db.sql.UniqueIdentifier, userId)
          .input('entryKey', db.sql.NVarChar, entry.entryKey)
          .input('entryValue', db.sql.NVarChar, entry.entryValue)
          .query(`
            MERGE VocabEntries AS target
            USING (SELECT @userId AS userId, @entryKey AS entryKey, @entryValue AS entryValue, 1 AS isCustomTag) AS source
            ON target.userId = source.userId AND target.entryKey = source.entryKey
            WHEN MATCHED THEN
              UPDATE SET entryValue = source.entryValue
            WHEN NOT MATCHED THEN
              INSERT (userId, entryKey, entryValue, isCustomTag)
              VALUES (source.userId, source.entryKey, source.entryValue, source.isCustomTag);
          `);
        upsertedCount++;
      } catch (entryError: any) {
        console.error('Error upserting individual entry:', entryError, 'Entry:', entry);
        // Continue with other entries even if one fails
      }
    }

    return { upserted: upsertedCount };
  } catch (error: any) {
    console.error('Error bulk upserting vocab entries:', error);
    // If it's already a custom error with a code, just rethrow it
    if (error.code && error.statusCode) {
      throw error;
    }
    // Otherwise, create a new error with a code
    const customError: CustomError = new Error('Failed to import vocabulary entries');
    customError.code = 'ERR_BULK_UPSERT_FAILED';
    customError.statusCode = 500;
    throw customError;
  }
}
