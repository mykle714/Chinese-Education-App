import { Readable } from 'stream';
import csv from 'csv-parser';
import { IVocabEntryDAL } from '../dal/interfaces/IVocabEntryDAL.js';
import { IUserDAL } from '../dal/interfaces/IUserDAL.js';
import { VocabEntry, VocabEntryCreateData, VocabEntryUpdateData, HskLevel } from '../types/index.js';
import { ValidationError, NotFoundError, BulkResult } from '../types/dal.js';

// CSV row interface for import processing
interface CSVRow {
  front: string;
  back: string;
  hint?: string;
  publishedAt?: string;
}

// Import result interface
interface ImportResult {
  success: boolean;
  results: BulkResult;
  message: string;
}

/**
 * VocabEntry Service - Contains all business logic for vocabulary operations
 * Handles validation, CSV processing, search, and vocabulary management
 */
export class VocabEntryService {
  constructor(
    private vocabEntryDAL: IVocabEntryDAL,
    private userDAL: IUserDAL
  ) {}

  /**
   * Create a new vocabulary entry with validation
   */
  async createEntry(userId: string, entryData: Omit<VocabEntryCreateData, 'userId'>): Promise<VocabEntry> {
    // Business validation
    this.validateEntryData(entryData);

    // Verify user exists
    const user = await this.userDAL.findById(userId);
    if (!user) {
      throw new NotFoundError('User not found');
    }
    
    // Check for duplicates (business rule)
    const existingEntry = await this.vocabEntryDAL.findByUserAndKey(userId, entryData.entryKey);
    if (existingEntry) {
      throw new ValidationError(`Entry with key "${entryData.entryKey}" already exists`);
    }
    
    // Create entry with default values (business logic)
    const newEntry = await this.vocabEntryDAL.create({
      userId,
      entryKey: entryData.entryKey.trim(),
      entryValue: entryData.entryValue.trim(),
      hskLevelTag: entryData.hskLevelTag || null
    });
    
    return newEntry;
  }

  /**
   * Update an existing vocabulary entry
   */
  async updateEntry(userId: string, entryId: number, updateData: VocabEntryUpdateData): Promise<VocabEntry> {
    // Business validation
    this.validateUpdateData(updateData);
    
    // Verify user owns the entry (business rule)
    const existingEntry = await this.vocabEntryDAL.findById(entryId);
    if (!existingEntry) {
      throw new NotFoundError('Vocabulary entry not found');
    }
    
    if (existingEntry.userId !== userId) {
      throw new ValidationError('You can only update your own vocabulary entries');
    }
    
    // Check for duplicate key if key is being changed (business rule)
    if (updateData.entryKey !== existingEntry.entryKey) {
      const duplicateEntry = await this.vocabEntryDAL.findByUserAndKey(userId, updateData.entryKey);
      if (duplicateEntry && duplicateEntry.id !== entryId) {
        throw new ValidationError(`Entry with key "${updateData.entryKey}" already exists`);
      }
    }
    
    // Update entry
    const updatedEntry = await this.vocabEntryDAL.update(entryId, {
      entryKey: updateData.entryKey.trim(),
      entryValue: updateData.entryValue.trim(),
      hskLevelTag: updateData.hskLevelTag
    });
    
    return updatedEntry;
  }

  /**
   * Delete a vocabulary entry
   */
  async deleteEntry(userId: string, entryId: number): Promise<boolean> {
    // Verify user owns the entry (business rule)
    const existingEntry = await this.vocabEntryDAL.findById(entryId);
    if (!existingEntry) {
      throw new NotFoundError('Vocabulary entry not found');
    }
    
    if (existingEntry.userId !== userId) {
      throw new ValidationError('You can only delete your own vocabulary entries');
    }
    
    return await this.vocabEntryDAL.delete(entryId);
  }

  /**
   * Get vocabulary entry by ID with ownership check
   */
  async getEntry(userId: string, entryId: number): Promise<VocabEntry> {
    const entry = await this.vocabEntryDAL.findById(entryId);
    if (!entry) {
      throw new NotFoundError('Vocabulary entry not found');
    }
    
    if (entry.userId !== userId) {
      console.log(entry.userId,userId)
      throw new ValidationError('You can only access your own vocabulary entries');
    }
    
    return entry;
  }

  /**
   * Get all vocabulary entries for a user with pagination
   */
  async getUserEntries(userId: string, limit: number = 100, offset: number = 0): Promise<{
    entries: VocabEntry[];
    total: number;
    hasMore: boolean;
  }> {
    // Verify user exists
    const user = await this.userDAL.findById(userId);
    if (!user) {
      throw new NotFoundError('User not found');
    }
    
    const [entries, total] = await Promise.all([
      this.vocabEntryDAL.findByUserId(userId, limit, offset),
      this.vocabEntryDAL.countByUserId(userId)
    ]);
    
    return {
      entries,
      total,
      hasMore: offset + entries.length < total
    };
  }

  /**
   * Search vocabulary entries
   */
  async searchEntries(userId: string, searchTerm: string, limit: number = 50): Promise<VocabEntry[]> {
    if (!searchTerm || searchTerm.trim().length === 0) {
      throw new ValidationError('Search term is required');
    }
    
    // Business rule: minimum search term length
    if (searchTerm.trim().length < 2) {
      throw new ValidationError('Search term must be at least 2 characters long');
    }
    
    return await this.vocabEntryDAL.searchEntries(userId, searchTerm.trim(), limit);
  }

  /**
   * Get entries by HSK level
   */
  async getEntriesByHskLevel(userId: string, hskLevel: HskLevel): Promise<VocabEntry[]> {
    return await this.vocabEntryDAL.findByHskLevel(userId, hskLevel);
  }


  /**
   * Get comprehensive vocabulary statistics
   */
  async getUserVocabStats(userId: string): Promise<{
    total: number;
    hskEntries: number;
    hskBreakdown: Record<HskLevel, number>;
    recentEntries: number;
  }> {
    return await this.vocabEntryDAL.getUserVocabStats(userId);
  }

  /**
   * Import vocabulary entries from CSV buffer
   */
  async importFromCSV(userId: string, csvBuffer: Buffer): Promise<ImportResult> {
    // Verify user exists
    const user = await this.userDAL.findById(userId);
    if (!user) {
      throw new NotFoundError('User not found');
    }
    
    // Parse CSV data
    const csvData = csvBuffer.toString('utf-8');
    const entries = await this.parseCSVData(csvData);
    
    if (entries.length === 0) {
      return {
        success: false,
        results: {
          total: 0,
          inserted: 0,
          updated: 0,
          skipped: 0,
          errors: []
        },
        message: 'No valid entries found in CSV file'
      };
    }
    
    // Convert CSV entries to VocabEntryCreateData
    const vocabEntries: VocabEntryCreateData[] = entries.map(entry => ({
      userId,
      entryKey: entry.front.trim(),
      entryValue: entry.back.trim(),
      hskLevelTag: null // Business rule: CSV imports don't have HSK levels by default
    }));
    
    // Perform bulk upsert with progress tracking
    const results = await this.vocabEntryDAL.bulkUpsertWithProgress(
      vocabEntries,
      (processed, total) => {
        console.log(`CSV Import Progress: ${processed}/${total} (${Math.round(processed/total*100)}%)`);
      }
    );
    
    const message = `Import completed. ${results.inserted} entries imported, ${results.updated} entries updated, ${results.errors.length} errors.`;
    
    return {
      success: results.errors.length < results.total / 2, // Success if less than 50% errors
      results,
      message
    };
  }

  /**
   * Import vocabulary entries from CSV stream (for large files)
   */
  async importFromCSVStream(userId: string, csvStream: Readable): Promise<ImportResult> {
    // Verify user exists
    const user = await this.userDAL.findById(userId);
    if (!user) {
      throw new NotFoundError('User not found');
    }
    
    return new Promise((resolve, reject) => {
      const entries: CSVRow[] = [];
      let rowCount = 0;
      
      csvStream
        .pipe(csv({
          mapHeaders: ({ header }) => header.trim().toLowerCase(),
          skipEmptyLines: true,
          skipLinesWithError: true
        }))
        .on('data', (row: any) => {
          rowCount++;
          
          try {
            const csvRow = this.validateCSVRow(row, rowCount);
            entries.push(csvRow);
          } catch (error: any) {
            console.warn(`Skipping row ${rowCount}: ${error.message}`);
          }
        })
        .on('end', async () => {
          try {
            if (entries.length === 0) {
              resolve({
                success: false,
                results: {
                  total: 0,
                  inserted: 0,
                  updated: 0,
                  skipped: 0,
                  errors: []
                },
                message: 'No valid entries found in CSV file'
              });
              return;
            }
            
            // Convert to VocabEntryCreateData
            const vocabEntries: VocabEntryCreateData[] = entries.map(entry => ({
              userId,
              entryKey: entry.front.trim(),
              entryValue: entry.back.trim(),
              hskLevelTag: null
            }));
            
            // Perform bulk upsert
            const results = await this.vocabEntryDAL.bulkUpsertWithProgress(vocabEntries);
            
            const message = `Stream import completed. ${results.inserted} entries imported, ${results.updated} entries updated, ${results.errors.length} errors.`;
            
            resolve({
              success: results.errors.length < results.total / 2,
              results,
              message
            });
          } catch (error) {
            reject(error);
          }
        })
        .on('error', (error) => {
          reject(new ValidationError(`CSV parsing error: ${error.message}`));
        });
    });
  }

  /**
   * Get recent entries for a user
   */
  async getRecentEntries(userId: string, days: number = 7): Promise<VocabEntry[]> {
    const date = new Date(Date.now() - days * 24 * 60 * 60 * 1000);
    return await this.vocabEntryDAL.findEntriesCreatedAfter(userId, date);
  }

  /**
   * Get vocabulary entries by tokens for reader feature
   */
  async getEntriesByTokens(userId: string, tokens: string[]): Promise<VocabEntry[]> {
    const serviceStart = performance.now();
    
    console.log(`[VOCAB-SERVICE] 🔄 Processing token lookup request:`, {
      userId: `${userId.substring(0, 8)}...`,
      tokensReceived: tokens?.length || 0,
      timestamp: new Date().toISOString()
    });

    // Verify user exists
    const userValidationStart = performance.now();
    const user = await this.userDAL.findById(userId);
    const userValidationTime = performance.now() - userValidationStart;
    
    if (!user) {
      console.error(`[VOCAB-SERVICE] ❌ User validation failed:`, {
        userId: `${userId.substring(0, 8)}...`,
        error: 'User not found',
        validationTime: `${userValidationTime.toFixed(2)}ms`
      });
      throw new NotFoundError('User not found');
    }

    console.log(`[VOCAB-SERVICE] ✅ User validation passed:`, {
      userId: `${userId.substring(0, 8)}...`,
      userName: user.name,
      validationTime: `${userValidationTime.toFixed(2)}ms`
    });

    // Business validation
    if (!tokens || tokens.length === 0) {
      console.log(`[VOCAB-SERVICE] 📝 Empty token array received:`, {
        userId: `${userId.substring(0, 8)}...`,
        response: 'returning empty array',
        serviceTime: `${(performance.now() - serviceStart).toFixed(2)}ms`
      });
      return [];
    }

    console.log(`[VOCAB-SERVICE] 🔍 Starting token validation and cleanup:`, {
      userId: `${userId.substring(0, 8)}...`,
      rawTokenCount: tokens.length,
      sampleRawTokens: tokens.slice(0, 10)
    });

    // Remove duplicates and filter out empty tokens
    const uniqueTokens = [...new Set(tokens.filter(token => token && token.trim().length > 0))];
    
    const duplicatesRemoved = tokens.length - uniqueTokens.length;
    const emptyTokensFiltered = tokens.filter(token => !token || token.trim().length === 0).length;

    console.log(`[VOCAB-SERVICE] 🧹 Token cleanup completed:`, {
      userId: `${userId.substring(0, 8)}...`,
      originalCount: tokens.length,
      uniqueCount: uniqueTokens.length,
      duplicatesRemoved: duplicatesRemoved,
      emptyTokensFiltered: emptyTokensFiltered,
      cleanupEfficiency: `${((uniqueTokens.length / tokens.length) * 100).toFixed(1)}%`,
      cleanedTokens: uniqueTokens.slice(0, 15) // Show first 15 cleaned tokens
    });
    
    if (uniqueTokens.length === 0) {
      console.log(`[VOCAB-SERVICE] 📝 No valid tokens after cleanup:`, {
        userId: `${userId.substring(0, 8)}...`,
        reason: 'All tokens were empty or invalid',
        serviceTime: `${(performance.now() - serviceStart).toFixed(2)}ms`
      });
      return [];
    }

    // Business rule: limit token count to prevent abuse
    if (uniqueTokens.length > 1000) {
      console.error(`[VOCAB-SERVICE] ❌ Token limit validation failed:`, {
        userId: `${userId.substring(0, 8)}...`,
        tokenCount: uniqueTokens.length,
        maxAllowed: 1000,
        serviceTime: `${(performance.now() - serviceStart).toFixed(2)}ms`
      });
      throw new ValidationError('Too many tokens requested (maximum 1000)');
    }

    // Business rule: validate token length
    const invalidTokens = uniqueTokens.filter(token => token.length > 100);
    if (invalidTokens.length > 0) {
      console.error(`[VOCAB-SERVICE] ❌ Token length validation failed:`, {
        userId: `${userId.substring(0, 8)}...`,
        invalidTokenCount: invalidTokens.length,
        maxLength: 100,
        invalidTokens: invalidTokens.slice(0, 5), // Show first 5 invalid tokens
        serviceTime: `${(performance.now() - serviceStart).toFixed(2)}ms`
      });
      throw new ValidationError('Some tokens are too long (maximum 100 characters per token)');
    }

    console.log(`[VOCAB-SERVICE] ✅ All validations passed, forwarding to DAL:`, {
      userId: `${userId.substring(0, 8)}...`,
      validatedTokens: uniqueTokens.length,
      tokenLengthStats: {
        minLength: Math.min(...uniqueTokens.map(t => t.length)),
        maxLength: Math.max(...uniqueTokens.map(t => t.length)),
        avgLength: (uniqueTokens.reduce((sum, t) => sum + t.length, 0) / uniqueTokens.length).toFixed(1)
      },
      validationTime: `${(performance.now() - serviceStart).toFixed(2)}ms`
    });

    // Get entries by tokens from DAL
    const dalStart = performance.now();
    const entries = await this.vocabEntryDAL.findByTokens(userId, uniqueTokens);
    const dalTime = performance.now() - dalStart;
    const totalServiceTime = performance.now() - serviceStart;

    console.log(`[VOCAB-SERVICE] 📊 Service processing completed:`, {
      userId: `${userId.substring(0, 8)}...`,
      tokensProcessed: uniqueTokens.length,
      entriesFound: entries.length,
      matchRate: `${(entries.length / uniqueTokens.length * 100).toFixed(1)}%`,
      dalTime: `${dalTime.toFixed(2)}ms`,
      totalServiceTime: `${totalServiceTime.toFixed(2)}ms`,
      performance: {
        tokensPerSecond: Math.round(uniqueTokens.length / (totalServiceTime / 1000)),
        entriesPerSecond: Math.round(entries.length / (dalTime / 1000))
      },
      foundEntries: entries.map(e => ({ id: e.id, key: e.entryKey })).slice(0, 10)
    });

    return entries;
  }

  // Private helper methods

  /**
   * Parse CSV data from string
   */
  private async parseCSVData(csvData: string): Promise<CSVRow[]> {
    return new Promise((resolve, reject) => {
      const entries: CSVRow[] = [];
      const stream = Readable.from([csvData]);
      let rowCount = 0;
      
      stream
        .pipe(csv({
          mapHeaders: ({ header }) => header.trim().toLowerCase(),
          skipEmptyLines: true,
          skipLinesWithError: true
        }))
        .on('data', (row: any) => {
          rowCount++;
          
          try {
            const csvRow = this.validateCSVRow(row, rowCount);
            entries.push(csvRow);
          } catch (error: any) {
            console.warn(`Skipping row ${rowCount}: ${error.message}`);
          }
        })
        .on('end', () => {
          resolve(entries);
        })
        .on('error', (error) => {
          reject(new ValidationError(`CSV parsing error: ${error.message}`));
        });
    });
  }

  /**
   * Validate and normalize CSV row data
   */
  private validateCSVRow(row: any, rowNumber: number): CSVRow {
    const front = row.front?.toString().trim();
    const back = row.back?.toString().trim();
    
    if (!front) {
      throw new ValidationError(`Row ${rowNumber}: 'front' field is required`);
    }
    
    if (!back) {
      throw new ValidationError(`Row ${rowNumber}: 'back' field is required`);
    }
    
    // Business rule: validate entry length
    if (front.length > 500) {
      throw new ValidationError(`Row ${rowNumber}: 'front' field is too long (max 500 characters)`);
    }
    
    if (back.length > 1000) {
      throw new ValidationError(`Row ${rowNumber}: 'back' field is too long (max 1000 characters)`);
    }
    
    return {
      front,
      back,
      hint: row.hint?.toString().trim() || '',
      publishedAt: row.publishedat?.toString().trim() || row.published_at?.toString().trim() || ''
    };
  }

  /**
   * Validate entry data for creation
   */
  private validateEntryData(data: Omit<VocabEntryCreateData, 'userId'>): void {
    if (!data.entryKey || data.entryKey.trim().length === 0) {
      throw new ValidationError('Entry key is required');
    }
    
    if (!data.entryValue || data.entryValue.trim().length === 0) {
      throw new ValidationError('Entry value is required');
    }
    
    // Business rules: length validation
    if (data.entryKey.trim().length > 500) {
      throw new ValidationError('Entry key is too long (maximum 500 characters)');
    }
    
    if (data.entryValue.trim().length > 1000) {
      throw new ValidationError('Entry value is too long (maximum 1000 characters)');
    }
    
    // Validate HSK level if provided
    if (data.hskLevelTag && !['HSK1', 'HSK2', 'HSK3', 'HSK4', 'HSK5', 'HSK6'].includes(data.hskLevelTag)) {
      throw new ValidationError('Invalid HSK level. Must be HSK1, HSK2, HSK3, HSK4, HSK5, or HSK6');
    }
  }

  /**
   * Validate entry data for updates
   */
  private validateUpdateData(data: VocabEntryUpdateData): void {
    if (!data.entryKey || data.entryKey.trim().length === 0) {
      throw new ValidationError('Entry key is required');
    }
    
    if (!data.entryValue || data.entryValue.trim().length === 0) {
      throw new ValidationError('Entry value is required');
    }
    
    // Business rules: length validation
    if (data.entryKey.trim().length > 500) {
      throw new ValidationError('Entry key is too long (maximum 500 characters)');
    }
    
    if (data.entryValue.trim().length > 1000) {
      throw new ValidationError('Entry value is too long (maximum 1000 characters)');
    }
    
    // Validate HSK level if provided
    if (data.hskLevelTag && !['HSK1', 'HSK2', 'HSK3', 'HSK4', 'HSK5', 'HSK6'].includes(data.hskLevelTag)) {
      throw new ValidationError('Invalid HSK level. Must be HSK1, HSK2, HSK3, HSK4, HSK5, or HSK6');
    }
  }
}
