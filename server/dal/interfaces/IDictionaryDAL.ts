import { DictionaryEntry, DictionaryEntryCreateData, AiDictionaryCacheRow } from '../../types/index.js';
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
   * Read a cached AI-synthesized dictionary entry by exact query key (migration 97).
   * Returns the row (word1 NULL ⇒ cached empty result) or null on a miss.
   * See docs/DICTIONARY_AI_FALLBACK_SEARCH.md.
   */
  getAiCacheEntry(queryKey: string, language: string): Promise<AiDictionaryCacheRow | null>;

  /**
   * Insert or refresh a cached AI result for (queryKey, language). A null `entry` records a
   * cached empty result; `queriedAt` is reset to now() on every (re-)prompt.
   */
  upsertAiCacheEntry(
    queryKey: string,
    language: string,
    entry: { word1: string; pinyin: string; definition: string } | null
  ): Promise<void>;

  /**
   * Read a user's completed AI-fallback model-call count for a local streak-day
   * (migration 99). Returns 0 when no row exists yet. Drives the daily abuse limit
   * (DICTIONARY_AI_DAILY_LIMIT). See docs/DICTIONARY_AI_FALLBACK_SEARCH.md.
   */
  getAiUsageCount(userId: string, usageDate: string): Promise<number>;

  /**
   * Atomically bump (and return) a user's completed AI-fallback call count for a
   * local streak-day. Called once per COMPLETED model call (not on cache hits).
   */
  incrementAiUsage(userId: string, usageDate: string): Promise<number>;

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
    exampleSentences?: Array<{ foreignText: string; english: string; [key: string]: any }> | null;
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

  /**
   * Enrich entries with `longDefinitionParts` — the long definition split into ordered
   * English-prose parts and embedded-Chinese parts (each carrying segmentation metadata
   * so the client renders them as cpcd with the example-sentence popup).
   *
   * @param entries - Array of objects with optional `longDefinition` field
   * @param language - Language filter for dictionary lookups (Chinese-only; non-zh is a no-op)
   */
  enrichLongDefinitionMetadataBatch<T extends {
    longDefinition?: string | null;
  }>(entries: T[], language?: string): Promise<T[]>;
}
