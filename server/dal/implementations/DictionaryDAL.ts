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
      tone: row.tone ?? null,
      definitions: Array.isArray(row.definitions) ? row.definitions : (typeof row.definitions === 'string' ? JSON.parse(row.definitions) : [row.definitions]),
      discoverable: row.discoverable ?? false,
      script: row.script ?? null,
      hskLevelTag: row.hskLevelTag ?? null,
      breakdown: row.breakdown ?? null,
      synonyms: row.synonyms ?? null,
      exampleSentences: row.exampleSentences ?? null,
      partsOfSpeech: row.partsOfSpeech ?? null,
      expansion: row.expansion ?? null,
      expansionMetadata: row.expansionMetadata ?? null,
      shortDefinition: row.shortDefinition ?? null,
      longDefinition: row.longDefinition ?? null,
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
          SELECT id, language, word1, word2, pronunciation, tone, definitions,
                 discoverable, script, "hskLevelTag", breakdown, synonyms,
                 "exampleSentences", "partsOfSpeech", expansion, "expansionMetadata",
                 "shortDefinition", "longDefinition", createdat
          FROM ${this.tableName}
          WHERE word1 = $1 AND language = $2
          LIMIT 1
        `, [word1, language]);
      } else {
        return await client.query(`
          SELECT id, language, word1, word2, pronunciation, tone, definitions,
                 discoverable, script, "hskLevelTag", breakdown, synonyms,
                 "exampleSentences", "partsOfSpeech", expansion, "expansionMetadata",
                 "shortDefinition", "longDefinition", createdat
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
          SELECT id, language, word1, word2, pronunciation, tone, definitions,
                 discoverable, script, "hskLevelTag", breakdown, synonyms,
                 "exampleSentences", "partsOfSpeech", expansion, "expansionMetadata",
                 "shortDefinition", "longDefinition", createdat
          FROM ${this.tableName}
          WHERE word1 = ANY($1) AND language = $2
        `, [words, language]);
      } else {
        return await client.query(`
          SELECT id, language, word1, word2, pronunciation, tone, definitions,
                 discoverable, script, "hskLevelTag", breakdown, synonyms,
                 "exampleSentences", "partsOfSpeech", expansion, "expansionMetadata",
                 "shortDefinition", "longDefinition", createdat
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
   * Search dictionary entries by word1 with pagination
   * @param searchTerm The search term (supports partial matching)
   * @param language Language filter
   * @param limit Number of results per page
   * @param offset Offset for pagination
   * @returns Object containing entries array and total count
   */
  async searchByWord1(
    searchTerm: string,
    language: string,
    limit: number = 50,
    offset: number = 0
  ): Promise<{ entries: DictionaryEntry[], total: number }> {
    console.log(`[DICTIONARY-DAL] 🔍 Searching for "${searchTerm}" in ${language} (limit: ${limit}, offset: ${offset})`);
    const startTime = performance.now();

    // Expand plain vowels to include all tone variations for accent-agnostic matching
    const expandVowels = (term: string): string => {
      return term
        .replace(/a/g, '[aāáǎà]')
        .replace(/e/g, '[eēéěè]')
        .replace(/i/g, '[iīíǐì]')
        .replace(/o/g, '[oōóǒò]')
        .replace(/u/g, '[uūúǔù]')
        .replace(/v/g, '[üǖǘǚǜ]')  // v can represent ü in pinyin
        .replace(/ü/g, '[üǖǘǚǜ]');
    };

    // Handle multi-word searches by splitting on spaces and applying vowel expansion to each word
    const words = searchTerm.trim().split(/\s+/);
    const expandedWords = words.map(word => expandVowels(word));
    
    // Create regex pattern that matches only at the start of the pronunciation field
    // Words are joined with flexible space matching (\s+)
    const regexPattern = `^${expandedWords.join('\\s+')}`;
    
    // For LIKE pattern (simple prefix match as fallback for word1)
    const searchPattern = `${searchTerm}%`;

    // Create a pattern to exclude results where 'g' immediately follows the search term (without space)
    // This regex matches: start of string + search pattern + 'g' (no space between)
    const excludePattern = `^${expandedWords.join('\\s+')}g`;

    // Get total count for pagination
    // Search with regex for pronunciation (accent-agnostic + word boundaries), LIKE for word1/definitions
    // Exclude results where pronunciation ends in 'g' immediately after the search term
    const countResult = await this.dbManager.executeQuery<any>(async (client) => {
      return await client.query(`
        SELECT COUNT(*) as count
        FROM ${this.tableName}
        WHERE language = $1 AND (
          word1 ILIKE $2 
          OR pronunciation ~ $3
          OR definitions::text ILIKE $2
        )
        AND NOT (pronunciation ~ $4)
      `, [language, searchPattern, regexPattern, excludePattern]);
    });

    // Get paginated results
    // Search with regex for pronunciation (accent-agnostic + word boundaries), LIKE for word1/definitions
    // Exclude results where pronunciation ends in 'g' immediately after the search term
    const entriesResult = await this.dbManager.executeQuery<any>(async (client) => {
      return await client.query(`
        SELECT id, language, word1, word2, pronunciation, tone, definitions,
               discoverable, script, "hskLevelTag", breakdown, synonyms,
               "exampleSentences", "partsOfSpeech", expansion, "expansionMetadata", createdat
        FROM ${this.tableName}
        WHERE language = $1 AND (
          word1 ILIKE $2 
          OR pronunciation ~ $3
          OR definitions::text ILIKE $2
        )
        AND NOT (pronunciation ~ $4)
        ORDER BY LENGTH(word1), word1
        LIMIT $5 OFFSET $6
      `, [language, searchPattern, regexPattern, excludePattern, limit, offset]);
    });

    const queryTime = performance.now() - startTime;
    const total = parseInt(countResult.recordset[0].count, 10);

    console.log(`[DICTIONARY-DAL] ✅ Found ${entriesResult.recordset.length}/${total} matches in ${queryTime.toFixed(2)}ms`);

    return {
      entries: entriesResult.recordset.map(row => this.mapRowToEntity(row)),
      total: total
    };
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
        RETURNING id, language, word1, word2, pronunciation, tone, definitions,
                  discoverable, script, "hskLevelTag", breakdown, synonyms,
                  "exampleSentences", "partsOfSpeech", expansion, "expansionMetadata", createdat
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
