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
   * Get total count of dictionary entries
   */
  getTotalCount(): Promise<number>;
}
