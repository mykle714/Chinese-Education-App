import { BaseDAL } from '../base/BaseDAL.js';
import { IDictionaryDAL } from '../interfaces/IDictionaryDAL.js';
import { dbManager } from '../base/DatabaseManager.js';
import { DictionaryEntry, DictionaryEntryCreateData } from '../../types/index.js';
import { ValidationError } from '../../types/dal.js';

/**
 * Dictionary Data Access Layer implementation
 * Handles all database operations for CC-CEDICT dictionary entries
 */
export class DictionaryDAL extends BaseDAL<DictionaryEntry, DictionaryEntryCreateData, Partial<DictionaryEntryCreateData>> implements IDictionaryDAL {
  constructor() {
    super(dbManager, 'dictionaryentries', 'id');
  }

  /**
   * Map database row to DictionaryEntry with parsed definitions
   */
  protected mapRowToEntity(row: any): DictionaryEntry {
    // PostgreSQL's pg library automatically parses JSONB to JavaScript objects
    // So row.definitions is already an array, no need to parse
    return {
      id: row.id,
      language: row.language,
      word1: row.word1,
      word2: row.word2,
      pronunciation: row.pronunciation,
      definitions: Array.isArray(row.definitions) ? row.definitions : (typeof row.definitions === 'string' ? JSON.parse(row.definitions) : [row.definitions]),
      createdAt: row.createdat
    };
  }

  /**
   * Find dictionary entry by word1 (primary word form)
   * @param word1 The primary word to search for
   * @param language Optional language filter
   */
  async findByWord1(word1: string, language?: string): Promise<DictionaryEntry | null> {
    const result = await this.dbManager.executeQuery<any>(async (client) => {
      if (language) {
        return await client.query(`
          SELECT id, language, word1, word2, pronunciation, definitions, createdat
          FROM ${this.tableName}
          WHERE word1 = $1 AND language = $2
          LIMIT 1
        `, [word1, language]);
      } else {
        return await client.query(`
          SELECT id, language, word1, word2, pronunciation, definitions, createdat
          FROM ${this.tableName}
          WHERE word1 = $1
          LIMIT 1
        `, [word1]);
      }
    });

    if (result.recordset.length === 0) {
      return null;
    }

    return this.mapRowToEntity(result.recordset[0]);
  }

  /**
   * Find dictionary entry by simplified Chinese characters (backward compatibility)
   */
  async findBySimplified(simplified: string): Promise<DictionaryEntry | null> {
    return this.findByWord1(simplified, 'zh');
  }

  /**
   * Find multiple dictionary entries by word1 (primary word form)
   * Optimized for batch lookups in reader feature
   * @param words Array of words to search for
   * @param language Optional language filter
   */
  async findMultipleByWord1(words: string[], language?: string): Promise<DictionaryEntry[]> {
    if (words.length === 0) {
      return [];
    }

    console.log(`[DICTIONARY-DAL] 🔍 Looking up ${words.length} terms${language ? ` (${language})` : ''}`);
    const startTime = performance.now();

    const result = await this.dbManager.executeQuery<any>(async (client) => {
      if (language) {
        return await client.query(`
          SELECT id, language, word1, word2, pronunciation, definitions, createdat
          FROM ${this.tableName}
          WHERE word1 = ANY($1) AND language = $2
        `, [words, language]);
      } else {
        return await client.query(`
          SELECT id, language, word1, word2, pronunciation, definitions, createdat
          FROM ${this.tableName}
          WHERE word1 = ANY($1)
        `, [words]);
      }
    });
    
    const queryTime = performance.now() - startTime;

    console.log(`[DICTIONARY-DAL] ✅ Found ${result.recordset.length} matches in ${queryTime.toFixed(2)}ms`);

    return result.recordset.map(row => this.mapRowToEntity(row));
  }

  /**
   * Find multiple dictionary entries by simplified Chinese characters (backward compatibility)
   */
  async findMultipleBySimplified(simplifiedTerms: string[]): Promise<DictionaryEntry[]> {
    return this.findMultipleByWord1(simplifiedTerms, 'zh');
  }

  /**
   * Get total count of dictionary entries
   */
  async getTotalCount(): Promise<number> {
    const result = await this.dbManager.executeQuery<{ count: string }>(async (client) => {
      return await client.query(`SELECT COUNT(*) as count FROM ${this.tableName}`);
    });
    
    return parseInt(result.recordset[0].count, 10);
  }

  /**
   * Override create to handle JSON stringification of definitions
   */
  async create(data: DictionaryEntryCreateData): Promise<DictionaryEntry> {
    const result = await this.dbManager.executeQuery<any>(async (client) => {
      return await client.query(`
        INSERT INTO ${this.tableName} (language, word1, word2, pronunciation, definitions)
        VALUES ($1, $2, $3, $4, $5)
        RETURNING id, language, word1, word2, pronunciation, definitions, createdat
      `, [
        data.language,
        data.word1,
        data.word2 || null,
        data.pronunciation || null,
        data.definitions // Already a JSON string from import script
      ]);
    });

    return this.mapRowToEntity(result.recordset[0]);
  }
}
