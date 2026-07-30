import { DictionaryEntry, DictionaryEntryCreateData, AiDictionaryCacheRow, WordComparisonRow, DefinitionCluster, LongDefinitionCitation, EntryApprovalFlags } from '../../types/index.js';
import type { LongDefinitionValue } from '../../utils/definitions.js';
import type { Language } from '../../types/index.js';

/**
 * Dictionary Data Access Layer Interface.
 *
 * Deliberately does NOT extend `IBaseDAL`. Dictionary data lives in per-language
 * tables (`dictionaryentries_zh` / `dictionaryentries_es`, see CLAUDE.md), so the
 * generic "one table, one primary key" CRUD surface is not meaningful here: every
 * operation must be told which language it is acting on. The implementation used to
 * inherit that surface bound permanently to the Chinese table.
 * See docs/ARCHITECTURE_REVIEW.md finding 1.
 *
 * Note: dictionary entries are read-only after import, so update/delete are not part
 * of this interface at all — only the import path creates rows.
 */
export interface IDictionaryDAL {
  /**
   * Create a dictionary entry. Used only by the import scripts.
   */
  create(data: DictionaryEntryCreateData): Promise<DictionaryEntry>;

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
   * Total number of entries in ONE language's dictionary table. The language is
   * explicit because there is no single "the dictionary" to count.
   */
  getTotalCount(language: Language): Promise<number>;

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
   * Read a cached word-comparison paragraph for a canonically-ordered pair (migration 105).
   * Caller must pass wordA/wordB already sorted — this method does not sort. Returns null on a
   * miss. See docs/WORD_COMPARE_FEATURE.md.
   */
  getComparison(wordA: string, wordB: string, language: string): Promise<WordComparisonRow | null>;

  /**
   * Insert or refresh a cached comparison for a canonically-ordered pair. Caller must pass
   * wordA/wordB already sorted.
   */
  upsertComparison(
    wordA: string,
    wordB: string,
    language: string,
    comparison: string,
    model: string,
    citations?: LongDefinitionCitation[] | null
  ): Promise<void>;

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
   * Enrich entries with `longDefinitionParts` — the long definition split into ordered
   * English-prose parts and embedded-Chinese parts (each carrying segmentation metadata
   * so the client renders them as cpcd with the example-sentence popup).
   *
   * Also narrows a per-sense (zh) `longDefinition` to the sense the card is on, using the
   * entry's `definitionClusters` + `selectedSense` — see resolveLongDefinition.
   *
   * @param entries - Array of objects with optional `longDefinition` (raw JSONB or hydrated
   *                  string) and the optional sense-narrowing fields
   * @param language - Language filter for dictionary lookups (Chinese-only; non-zh is a no-op)
   */
  enrichLongDefinitionMetadataBatch<T extends {
    longDefinition?: string | null;
    longDefinitionRaw?: LongDefinitionValue | null;
    longDefinitionCitations?: LongDefinitionCitation[] | null;
    definitionClusters?: DefinitionCluster[] | null;
    selectedSense?: string | null;
  }>(entries: T[], language?: string): Promise<T[]>;

  /**
   * Attach the four entry-level approval flags (`EntryApprovalFlags`) to each entry —
   * each TRUE iff a validator approved that field and the approval still matches the
   * entry's current raw det data. `definitions` is the definitions[] + longDefinition
   * bundle; `partsOfSpeech` / `difficulty` / `frequencyScore` are one column each.
   * See docs/DATA_VALIDATION_SYSTEM.md.
   *
   * @param entries - Array of objects carrying word1 and/or entryKey (the headword)
   * @param language - Language filter for dictionary lookups
   */
  enrichFieldApprovalsBatch<T extends {
    word1?: string;
    entryKey?: string;
  }>(entries: T[], language?: string): Promise<Array<T & EntryApprovalFlags>>;
}
