import { BaseDAL } from '../base/BaseDAL.js';
import { IDictionaryDAL } from '../interfaces/IDictionaryDAL.js';
import { dbManager } from '../base/DatabaseManager.js';
import { DictionaryEntry, DictionaryEntryCreateData, ParticleClassifierEntry } from '../../types/index.js';
import { ValidationError } from '../../types/dal.js';
import { resolveShortDefinition } from '../../utils/definitions.js';
import { ShortDefinitionPronunciationOverride, ExampleSentenceDefinitionPronunciationOverride } from '../../types/index.js';
import { getAllSubstrings, buildDictMap, buildExcludeSet, pickDefinitionForTranslatedSentence, segmentWithDict } from '../shared/segmentString.js';

// Standard column list for all dictionary SELECT queries
const DICTIONARY_COLUMNS = `
  id, language, script, discoverable, "createdAt",
  word1, word2, pronunciation, "numberedPinyin", tone,
  "partsOfSpeech", "hskLevel",
  definitions, "longDefinition",
  breakdown, synonyms,
  "exampleSentences",
  expansion, "expansionLiteralTranslation",
  "matchException",
  "shortDefinitionPronunciationOverride",
  "exampleSentenceDefinitionPronunciationOverride"
`.trim();

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
    const definitions = Array.isArray(row.definitions) ? row.definitions : (typeof row.definitions === 'string' ? JSON.parse(row.definitions) : [row.definitions]);

    return {
      id: row.id,
      language: row.language,
      script: row.script ?? null,
      discoverable: row.discoverable ?? false,
      createdAt: row.createdAt,
      word1: row.word1,
      word2: row.word2,
      pronunciation: (row.shortDefinitionPronunciationOverride as ShortDefinitionPronunciationOverride | null)?.pronunciation ?? row.pronunciation,
      numberedPinyin: row.numberedPinyin ?? null,
      tone: row.tone ?? null,
      partsOfSpeech: row.partsOfSpeech ?? null,
      hskLevel: row.hskLevel ?? null,
      definitions,
      shortDefinitionPronunciationOverride: (row.shortDefinitionPronunciationOverride as ShortDefinitionPronunciationOverride | null) ?? null,
      shortDefinition: resolveShortDefinition(definitions, row.shortDefinitionPronunciationOverride),
      exampleSentenceDefinitionPronunciationOverride: (row.exampleSentenceDefinitionPronunciationOverride as ExampleSentenceDefinitionPronunciationOverride | null) ?? null,
      longDefinition: row.longDefinition ?? null,
      breakdown: row.breakdown ?? null,
      synonyms: row.synonyms ?? null,
      exampleSentences: row.exampleSentences ?? null, // Enriched on-the-fly via enrichExampleSentencesMetadataBatch
      expansion: row.expansion ?? null,
      expansionLiteralTranslation: row.expansionLiteralTranslation ?? null,
      matchException: row.matchException ?? [],
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
          SELECT ${DICTIONARY_COLUMNS}
          FROM ${this.tableName}
          WHERE word1 = $1 AND language = $2
          LIMIT 1
        `, [word1, language]);
      } else {
        return await client.query(`
          SELECT ${DICTIONARY_COLUMNS}
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
          SELECT ${DICTIONARY_COLUMNS}
          FROM ${this.tableName}
          WHERE word1 = ANY($1) AND language = $2
        `, [words, language]);
      } else {
        return await client.query(`
          SELECT ${DICTIONARY_COLUMNS}
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

    // For LIKE pattern (simple prefix match for word1, definitions, and numberedPinyin)
    const searchPattern = `${searchTerm}%`;

    // Create a pattern to exclude results where 'g' immediately follows the search term (without space)
    // This regex matches: start of string + search pattern + 'g' (no space between)
    const excludePattern = `^${expandedWords.join('\\s+')}g`;

    // Detect numbered pinyin input (e.g. "ni3 hao3", "gan1", "lv3") — any letter immediately
    // followed by a tone digit 1–4. When detected, also search the numberedPinyin column.
    const isNumberedPinyin = /[a-zA-ZüvÜV][1-4]/.test(searchTerm);
    const numberedPinyinClause = isNumberedPinyin ? '\n          OR "numberedPinyin" ILIKE $2' : '';

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
          OR definitions::text ILIKE $2${numberedPinyinClause}
        )
        AND NOT (pronunciation ~ $4)
      `, [language, searchPattern, regexPattern, excludePattern]);
    });

    // Get paginated results
    // Search with regex for pronunciation (accent-agnostic + word boundaries), LIKE for word1/definitions
    // Exclude results where pronunciation ends in 'g' immediately after the search term
    const entriesResult = await this.dbManager.executeQuery<any>(async (client) => {
      return await client.query(`
        SELECT ${DICTIONARY_COLUMNS}
        FROM ${this.tableName}
        WHERE language = $1 AND (
          word1 ILIKE $2
          OR pronunciation ~ $3
          OR definitions::text ILIKE $2${numberedPinyinClause}
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
   * Enrich each example sentence in a batch of entries with greedy segmentation data.
   *
   * Each sentence object gains:
   *   - `_segments: string[]`  — greedy-matched word tokens (parallel to the characters)
   *   - `segmentMetadata: Record<segment, { pronunciation?, definition? }>` — dictionary metadata by segment
   *
   * All substring lookups across all entries and sentences are merged into one DB query.
   *
   * @param entries - Objects with optional `exampleSentences` array
   * @param language - Language filter for dictionary lookups (default: 'zh')
   */
  async enrichExampleSentencesMetadataBatch<T extends {
    exampleSentences?: Array<{ chinese: string; english: string; partOfSpeechDict?: Record<string, string>; [key: string]: any }> | null;
  }>(entries: T[], language: string = 'zh'): Promise<T[]> {
    const withSentences = entries.filter(e => e.exampleSentences?.length);
    if (withSentences.length === 0) return entries;

    // 1. Collect all candidate substrings across all sentences — one combined set
    const allCandidates = new Set<string>();
    for (const entry of withSentences) {
      for (const sentence of entry.exampleSentences!) {
        for (const candidate of getAllSubstrings(sentence.chinese)) {
          allCandidates.add(candidate);
        }
      }
    }

    // 2. Single batch DB query for all dictionary candidates
    const dictEntries = await this.findMultipleByWord1([...allCandidates], language);
    const dictMap = buildDictMap(dictEntries);
    // Collect all matchException tokens across loaded entries into one exclusion set
    const excludeTokens = buildExcludeSet(dictEntries);

    // 3. Single batch query for particle/classifier annotations.
    //    Only single characters can be particles or classifiers, so filter down to length-1 candidates.
    const singleCharCandidates = new Set<string>(
      [...allCandidates].filter(s => [...s].length === 1)
    );
    const pacMap = await this.fetchParticlesAndClassifiers(singleCharCandidates, language);

    // 4. Enrich each sentence object with _segments and segmentMetadata
    return entries.map(entry => {
      if (!entry.exampleSentences?.length) return entry;

      return {
        ...entry,
        exampleSentences: entry.exampleSentences.map(sentence => {
          const segments = segmentWithDict(sentence.chinese, dictMap, excludeTokens);
          const segmentMetadata: Record<string, {
            pronunciation?: string;
            definition?: string;
            particleOrClassifier?: { type: 'particle' | 'classifier'; definition: string };
          }> = {};

          for (const seg of segments) {
            const segMeta = dictMap.get(seg);
            const pacEntries = pacMap.get(seg);

            // Only create a metadata entry if the segment has at least one data source
            if (segMeta || pacEntries?.length) {
              segmentMetadata[seg] = {};

              if (segMeta) {
                // exampleSentenceDefinitionPronunciationOverride takes precedence over everything;
                // fall back to the stored pronunciation / context-matched definition otherwise.
                const pronunciation = segMeta.overridePronunciation ?? segMeta.pronunciation;
                if (pronunciation) {
                  segmentMetadata[seg].pronunciation = pronunciation;
                }
                const bestDefinition = segMeta.overrideDefinition
                  ?? pickDefinitionForTranslatedSentence(segMeta, sentence.english);
                if (bestDefinition) {
                  segmentMetadata[seg].definition = bestDefinition;
                }
              }

              // Attach particle/classifier annotation only when the sentence's AI-generated
              // partOfSpeechDict confirms this token is being used as a particle or classifier
              // in this specific sentence. This prevents words like 把 from always showing their
              // grammatical label even when used as a verb in the sentence.
              if (pacEntries?.length) {
                const posTag = sentence.partOfSpeechDict?.[seg];
                if (posTag === 'particle' || posTag === 'classifier') {
                  // Particle is preferred over classifier when a character qualifies as both,
                  // since the grammatical role is more salient for learner display.
                  const particle = pacEntries.find(e => e.type === 'particle');
                  const classifier = pacEntries.find(e => e.type === 'classifier');
                  const preferred = particle ?? classifier;
                  if (preferred) {
                    segmentMetadata[seg].particleOrClassifier = {
                      type: preferred.type,
                      definition: preferred.definition,
                    };
                  }
                }
              }
            }
          }

          return { ...sentence, _segments: segments, segmentMetadata };
        }),
      };
    });
  }

  /**
   * Batch-fetch particle/classifier annotations for a set of single characters.
   * Issues one DB query regardless of the set size.
   * Returns a Map keyed by character; each value is an array of entries since a single
   * character can be both a particle and a classifier (separate rows in the table).
   *
   * @param characters - Set of single-character strings to look up
   * @param language   - Language filter (default: 'zh')
   */
  private async fetchParticlesAndClassifiers(
    characters: Set<string>,
    language: string = 'zh'
  ): Promise<Map<string, ParticleClassifierEntry[]>> {
    if (characters.size === 0) return new Map();

    const result = await this.dbManager.executeQuery<any>(async (client) => {
      return await client.query(
        `SELECT id, character, language, type, definition, "createdAt"
         FROM particlesandclassifiers
         WHERE character = ANY($1) AND language = $2`,
        [[...characters], language]
      );
    });

    const map = new Map<string, ParticleClassifierEntry[]>();
    for (const row of result.recordset) {
      const existing = map.get(row.character) ?? [];
      existing.push({
        id: row.id,
        character: row.character,
        language: row.language,
        type: row.type as 'particle' | 'classifier',
        definition: row.definition,
        createdAt: row.createdAt,
      });
      map.set(row.character, existing);
    }
    return map;
  }

  /**
   * Enrich each entry with expansionMetadata (per-character pronunciation + definition).
   *
   * Expansion metadata is computed on-the-fly from dictionaryentries and is not stored.
   * All unique expansion characters across the batch are merged into one lookup query.
   *
   * @param entries - Objects with optional `expansion` field
   * @param language - Language filter for dictionary lookups (default: 'zh')
   */
  async enrichExpansionMetadataBatch<T extends {
    expansion?: string | null;
    expansionLiteralTranslation?: string | null;
  }>(entries: T[], language: string = 'zh'): Promise<T[]> {
    const withExpansion = entries.filter(e =>
      typeof e.expansion === 'string' && e.expansion.trim().length > 0
    );

    if (withExpansion.length === 0) {
      return entries.map(entry => ({ ...entry, expansionMetadata: null }));
    }

    // 1. Collect all unique expansion characters across all entries
    const allChars = new Set<string>();
    for (const entry of withExpansion) {
      for (const char of [...entry.expansion!.trim()]) {
        if (char.trim().length > 0) {
          allChars.add(char);
        }
      }
    }

    // 2. Single batch DB query for all characters
    const dictEntries = await this.findMultipleByWord1([...allChars], language);
    const dictMap = buildDictMap(dictEntries);

    // 3. Attach per-character metadata for each entry's expansion
    return entries.map(entry => {
      const expansion = typeof entry.expansion === 'string' ? entry.expansion.trim() : '';
      if (!expansion) {
        return { ...entry, expansionMetadata: null };
      }

      const expansionMetadata: Record<string, { pronunciation?: string; definition?: string }> = {};
      const translatedExpansion =
        typeof entry.expansionLiteralTranslation === 'string'
          ? entry.expansionLiteralTranslation
          : null;

      for (const char of [...expansion]) {
        const charMeta = dictMap.get(char);
        if (!charMeta) continue;

        expansionMetadata[char] = {};
        if (charMeta.pronunciation) {
          expansionMetadata[char].pronunciation = charMeta.pronunciation;
        }
        const bestDefinition = pickDefinitionForTranslatedSentence(charMeta, translatedExpansion);
        if (bestDefinition) {
          expansionMetadata[char].definition = bestDefinition;
        }
      }

      return {
        ...entry,
        expansionMetadata: Object.keys(expansionMetadata).length > 0 ? expansionMetadata : null,
      };
    });
  }

  /**
   * Override create to handle JSON stringification of definitions
   */
  async create(data: DictionaryEntryCreateData): Promise<DictionaryEntry> {
    const result = await this.dbManager.executeQuery<any>(async (client) => {
      return await client.query(`
        INSERT INTO ${this.tableName} (language, word1, word2, pronunciation, definitions)
        VALUES ($1, $2, $3, $4, $5)
        RETURNING ${DICTIONARY_COLUMNS}
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
