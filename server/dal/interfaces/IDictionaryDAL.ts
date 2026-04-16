import { DictionaryEntry, DictionaryEntryCreateData } from '../../types/index.js';
import { IBaseDAL } from './IBaseDAL.js';

/**
 * Dictionary Data Access Layer Interface
 * Extends base DAL with dictionary-specific operations
 * Note: Dictionary entries are read-only after import, so update operations are not used
 */
export interface IDictionaryDAL extends IBaseDAL<DictionaryEntry, DictionaryEntryCreateData, Partial<DictionaryEntryCreateData>> {
  /**
   * Find dictionary entry by word1 (primary word form)
   */
  findByWord1(word1: string, language?: string): Promise<DictionaryEntry | null>;

  /**
   * Find dictionary entry by simplified Chinese characters (backward compatibility)
   */
  findBySimplified(simplified: string): Promise<DictionaryEntry | null>;

  /**
   * Find multiple dictionary entries by word1 (primary word form)
   */
  findMultipleByWord1(words: string[], language?: string): Promise<DictionaryEntry[]>;

  /**
   * Find multiple dictionary entries by simplified Chinese characters (backward compatibility)
   */
  findMultipleBySimplified(simplifiedTerms: string[]): Promise<DictionaryEntry[]>;

  /**
   * Search dictionary entries by word1 with pagination
   */
  searchByWord1(
    searchTerm: string,
    language: string,
    limit?: number,
    offset?: number
  ): Promise<{ entries: DictionaryEntry[], total: number }>;

  /**
   * Get total count of dictionary entries
   */
  getTotalCount(): Promise<number>;

  /**
   * Enrich each example sentence in a batch of entries with:
   * - `_segments` (segment list)
   * - `segmentMetadata` (per-segment pronunciation + definition)
   * Merges all substring lookups across all entries and sentences into one DB query.
   *
   * @param entries - Array of objects with optional `exampleSentences` field
   * @param language - Language filter for dictionary lookups
   */
  enrichExampleSentencesMetadataBatch<T extends {
    exampleSentences?: Array<{ chinese: string; english: string; [key: string]: any }> | null;
  }>(entries: T[], language?: string): Promise<T[]>;

  /**
   * Enrich entries with GSA-segmented expansion data derived from dictionary lookups.
   * Each entry gains:
   * - `expansionSegments: string[]` — GSA word tokens for the expansion string
   * - `expansionMetadata: Record<segment, { pronunciation?, definition? }>` — keyed by segment
   *
   * @param entries - Array of objects with optional `expansion` field
   * @param language - Language filter for dictionary lookups
   */
  enrichExpansionMetadataBatch<T extends {
    expansion?: string | null;
    expansionLiteralTranslation?: string | null;
  }>(entries: T[], language?: string): Promise<T[]>;
}
