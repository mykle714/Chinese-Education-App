import { BaseDAL } from '../base/BaseDAL.js';
import { IDictionaryDAL } from '../interfaces/IDictionaryDAL.js';
import { dbManager } from '../base/DatabaseManager.js';
import { DictionaryEntry, DictionaryEntryCreateData, ParticleClassifierEntry } from '../../types/index.js';
import { ValidationError } from '../../types/dal.js';
import { resolveShortDefinition, longDefObjectToDisplayString } from '../../utils/definitions.js';
import { ShortDefinitionPronunciationOverride, ExampleSentenceDefinitionPronunciationOverride } from '../../types/index.js';
import { getAllSubstrings, buildDictMap, buildExcludeSet, segmentWithDict, buildSegmentMetadata, splitHanRuns, RenderedSegmentMeta } from '../shared/segmentString.js';
import { LongDefinitionPart } from '../../types/index.js';
import { segmentPinyin } from '../../utils/pinyinSegment.js';
import { dictTableForLanguage } from '../shared/dictTable.js';
import { AiDictionaryCacheRow, WordComparisonRow } from '../../types/index.js';
import { sanitizeDocumentContent } from '../../utils/sanitizeContent.js';

// Standard column list for all dictionary SELECT queries
const DICTIONARY_COLUMNS = `
  id, language, script, discoverable, "createdAt",
  word1, word2, pronunciation, "numberedPinyin", tone,
  "partsOfSpeech", "difficulty",
  definitions, "longDefinition",
  "definitionClusters",
  breakdown, synonyms,
  "exampleSentences",
  "characterRationale",
  "matchException",
  "shortDefinitionPronunciationOverride",
  "exampleSentenceDefinitionPronunciationOverride",
  "vernacularScore",
  "wordForms"
`.trim();

// Per-language variant of the SELECT list. `definitionClusters` (migration 90) is a Chinese-only
// enrichment (its per-cluster reading is pinyin), and the Spanish det (`dictionaryentries_es`) has
// no such column — so for es we select a typed NULL placeholder to keep the column list, row shape,
// and mapRowToEntity uniform across languages without adding a meaningless column to the es table.
function dictionaryColumns(language: string): string {
  if (language === 'es') {
    return DICTIONARY_COLUMNS.replace('"definitionClusters",', 'NULL::jsonb AS "definitionClusters",');
  }
  return DICTIONARY_COLUMNS;
}

/**
 * Parse a numbered-pinyin search query (e.g. "jian4 shen1") into a Postgres regex matched
 * against the numberedPinyin column (space-separated syllables; neutral-tone syllables carry
 * no digit at all — see server/scripts/backfill/chinese/backfill-numbered-pinyin.js). Per
 * syllable: "0"/"5" means neutral tone (matched as the bare base), no digit means "any tone"
 * (base with an optional 1–4 digit), and 1–4 means that exact tone. Each token ends in a `\y`
 * word-boundary so a syllable match can't bleed into a longer one sharing the same prefix (e.g.
 * "shen" any-tone must not match "sheng1", and neutral "shen0" must not match "shen1" — digits
 * count as word characters, so without the boundary an optional/absent digit would just let the
 * regex consume whatever digit followed). Anchored at the start only (a "starts with" match,
 * consistent with the other search paths' prefix semantics), so a query can name a leading
 * subset of a multi-syllable word's syllables.
 *
 * Returns null — falling back to the existing word1/pronunciation/definitions search — if any
 * token isn't syllable-shaped, or if no token carries an explicit digit (otherwise a plain
 * multi-word phrase like "to work out" would be misread as an all-any-tone pinyin query).
 */
function buildNumberedPinyinPattern(searchTerm: string): string | null {
  return buildTokenPinyinPattern(searchTerm.trim().split(/\s+/).filter(Boolean), true);
}

/**
 * Build the numberedPinyin regex from an array of already-separated syllable tokens (each a base
 * optionally suffixed with a tone digit 0–5). Shared by the direct numbered-pinyin path (via
 * buildNumberedPinyinPattern, `requireDigit = true`) and the stage-2 spaceless-segmentation path
 * (docs/DICTIONARY_AI_FALLBACK_SEARCH.md), which passes tilings from `segmentPinyin` with
 * `requireDigit = false` — those tokens are already confirmed valid pinyin, so an all-any-tone
 * (digit-free) query is legitimate rather than an ambiguous English phrase.
 *
 * Returns null if any token isn't syllable-shaped, or if `requireDigit` is set and no token
 * carries an explicit tone digit.
 */
function buildTokenPinyinPattern(tokens: string[], requireDigit: boolean): string | null {
  if (tokens.length === 0) return null;

  let hasExplicitDigit = false;
  const tokenPatterns: string[] = [];
  for (const token of tokens) {
    const match = /^([a-zü]+)([0-5])?$/.exec(token);
    if (!match) return null;
    const [, base, digit] = match;
    const escapedBase = base.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
    if (digit === undefined) {
      tokenPatterns.push(`${escapedBase}[1-4]?\\y`); // any tone
    } else if (digit === '0' || digit === '5') {
      hasExplicitDigit = true;
      tokenPatterns.push(`${escapedBase}\\y`); // neutral tone: no digit in the column
    } else {
      hasExplicitDigit = true;
      tokenPatterns.push(`${escapedBase}${digit}\\y`); // exact tone
    }
  }

  if (requireDigit && !hasExplicitDigit) return null;
  return `^${tokenPatterns.join('\\s+')}`;
}

/**
 * Dictionary Data Access Layer implementation
 * Handles all database operations for CC-CEDICT dictionary entries
 */
export class DictionaryDAL extends BaseDAL<DictionaryEntry, DictionaryEntryCreateData, Partial<DictionaryEntryCreateData>> implements IDictionaryDAL {
  constructor() {
    super(dbManager, 'dictionaryentries_zh', 'id');
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
      difficulty: row.difficulty ?? null,
      definitions,
      shortDefinitionPronunciationOverride: (row.shortDefinitionPronunciationOverride as ShortDefinitionPronunciationOverride | null) ?? null,
      shortDefinition: resolveShortDefinition(definitions, row.shortDefinitionPronunciationOverride),
      exampleSentenceDefinitionPronunciationOverride: (row.exampleSentenceDefinitionPronunciationOverride as ExampleSentenceDefinitionPronunciationOverride | null) ?? null,
      // Stored as a JSONB object keyed by POS (migration 70); hydrated to the canonical
      // labeled string the API/renderer expect (see longDefObjectToDisplayString).
      longDefinition: longDefObjectToDisplayString(row.longDefinition),
      definitionClusters: row.definitionClusters ?? null,
      breakdown: row.breakdown ?? null,
      synonyms: row.synonyms ?? null,
      exampleSentences: row.exampleSentences ?? null, // Enriched on-the-fly via enrichExampleSentencesMetadataBatch
      characterRationale: row.characterRationale ?? null, // Per-character rationale (jsonb, migration 102); display-ready, no runtime enrichment
      matchException: row.matchException ?? [],
      vernacularScore: row.vernacularScore ?? null,
      wordForms: row.wordForms ?? null,
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

    // Pinyin is stored lowercase in the pronunciation/numberedPinyin columns, and
    // pronunciation is matched with the case-sensitive regex operator (~). Lowercase the
    // query so uppercased pinyin (e.g. "Ni3 Hao3") still matches; harmless for the
    // case-insensitive ILIKE paths and leaves Chinese characters in word1 untouched.
    searchTerm = searchTerm.toLowerCase();

    // Route to the per-language det table (Chinese → dictionaryentries_zh, Spanish →
    // dictionaryentries_es). Everything pinyin/pronunciation-related below is Chinese-only: the
    // Spanish rows have NULL pronunciation / numberedPinyin, so those clauses are skipped for es.
    const isZh = language === 'zh';
    const table = dictTableForLanguage(language);

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

    // Numbered-pinyin syllable query (e.g. "jian4 shen1"), built against the numberedPinyin
    // column (space-separated syllables; neutral-tone syllables carry no digit at all —
    // never "0"/"5" — see server/scripts/backfill/chinese/backfill-numbered-pinyin.js). Per
    // syllable: an explicit "0"/"5" means neutral (matched as the bare base, no digit); no
    // digit at all means "any tone" (base with an optional 1–4 digit); 1–4 means that exact
    // tone. Requires at least one explicit digit somewhere in the query so a plain multi-word
    // English/pinyin-shaped phrase without any tone digit (ambiguous with a definitions search)
    // isn't misread as an all-any-tone pinyin query. Returns null (falls back to the existing
    // word1/pronunciation/definitions search) if any token isn't syllable-shaped.
    const numberedPinyinPattern = isZh ? buildNumberedPinyinPattern(searchTerm) : null;

    // $1 language and $2 word1-prefix pattern are used for every language. The pronunciation params
    // ($3 accent-agnostic prefix regex, $4 the 'g'-exclusion) and the numbered-pinyin clause are
    // Chinese-only — the es det has NULL pronunciation/numberedPinyin, and `NOT (NULL ~ x)` would
    // drop every Spanish row — so es matches on word1 + first-definition only.
    const params: any[] = [language, searchPattern];
    let paramIdx = params.length;

    let pronunciationClause = '';
    let pronunciationExclusion = '';
    let numberedPinyinClause = '';
    if (isZh) {
      params.push(regexPattern, excludePattern); // $3, $4
      paramIdx = params.length;
      pronunciationClause = `\n          OR pronunciation ~ $3`;
      pronunciationExclusion = `\n        AND NOT (pronunciation ~ $4)`;
      if (numberedPinyinPattern) {
        paramIdx += 1;
        numberedPinyinClause = `\n          OR "numberedPinyin" ~* $${paramIdx}`;
        params.push(numberedPinyinPattern);
      }
    }

    // Word/pinyin match (everything except the English-definition contains search).
    // Reused both as the WHERE word-match group and as the ORDER BY priority test so
    // that the ranking mirrors exactly how a row qualified. For es this is the word1 prefix
    // alone (the pinyin/pronunciation pieces are empty).
    const wordMatchExpr = `word1 ILIKE $2${pronunciationClause}${numberedPinyinClause}`;

    // English-definition search. We match only the text actually shown on the result
    // card (DictionaryEntryRow): the FIRST definition with all parenthetical substrings
    // stripped — i.e. regexp_replace(definitions->>0, '\s*\([^)]*\)', '', 'g'), mirroring
    // the frontend stripParentheses(definitions[0]). Matching is whole-word only, via the
    // Postgres word-boundary anchor \y, so "art" matches "art"/"fine art" but not "start".
    // Case-insensitive (~*) since the query term is lowercased but card text may be capitalised.
    // Guarded by a minimum length so trivial single-letter searches don't scan the table.
    const definitionsSearchEnabled = searchTerm.trim().length >= 2;
    // Escape regex metacharacters in the user term, then anchor it to word boundaries.
    const escapedTerm = searchTerm.trim().replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
    const wholeWordDefinitionPattern = `\\y${escapedTerm}\\y`;
    let definitionsClause = '';
    if (definitionsSearchEnabled) {
      paramIdx += 1;
      definitionsClause = `\n          OR regexp_replace(definitions->>0, '\\s*\\([^)]*\\)', '', 'g') ~* $${paramIdx}`;
      params.push(wholeWordDefinitionPattern);
    }

    // Placeholder indices for LIMIT/OFFSET shift with however many optional params preceded them.
    const limitPlaceholder = `$${paramIdx + 1}`;
    const offsetPlaceholder = `$${paramIdx + 2}`;

    // Build the parameter lists so their count exactly matches the referenced placeholders.
    const countParams: any[] = params;
    const entriesParams = [...params, limit, offset];

    // Get total count for pagination
    // Search with regex for pronunciation (accent-agnostic + word boundaries), LIKE for word1/definitions
    // Exclude results where pronunciation ends in 'g' immediately after the search term
    const countResult = await this.dbManager.executeQuery<any>(async (client) => {
      return await client.query(`
        SELECT COUNT(*) as count
        FROM ${table}
        WHERE language = $1 AND (
          ${wordMatchExpr}${definitionsClause}
        )${pronunciationExclusion}
      `, countParams);
    });

    // Get paginated results
    // Search with regex for pronunciation (accent-agnostic + word boundaries), LIKE for word1/definitions
    // Exclude results where pronunciation ends in 'g' immediately after the search term
    const entriesResult = await this.dbManager.executeQuery<any>(async (client) => {
      return await client.query(`
        SELECT ${dictionaryColumns(language)}
        FROM ${table}
        WHERE language = $1 AND (
          ${wordMatchExpr}${definitionsClause}
        )${pronunciationExclusion}
        ORDER BY
          CASE WHEN (${wordMatchExpr}) THEN 0 ELSE 1 END,
          LENGTH(word1), word1
        LIMIT ${limitPlaceholder} OFFSET ${offsetPlaceholder}
      `, entriesParams);
    });

    const queryTime = performance.now() - startTime;
    const total = parseInt(countResult.recordset[0].count, 10);

    console.log(`[DICTIONARY-DAL] ✅ Found ${entriesResult.recordset.length}/${total} matches in ${queryTime.toFixed(2)}ms`);

    // Stage 2 — spaceless-pinyin fallback (docs/DICTIONARY_AI_FALLBACK_SEARCH.md). Only when the
    // primary search found nothing: segment the (possibly space-free) term into pinyin syllables,
    // enumerate every valid tiling, and match each re-spaced form against numberedPinyin. This lets
    // "jianshen"/"jian4shen1" resolve even though the direct numbered-pinyin path (which needs
    // spaces + a digit) matched nothing. Chinese-only (es has no pinyin).
    if (isZh && total === 0) {
      const tilings = segmentPinyin(searchTerm);
      if (tilings.length > 0) {
        // Build one pattern per tiling; tokens are already valid pinyin so digits aren't required.
        const patterns = [...new Set(
          tilings
            .map(tokens => buildTokenPinyinPattern(tokens, false))
            .filter((p): p is string => p !== null)
        )];
        if (patterns.length > 0) {
          return this.searchByNumberedPinyinPatterns(patterns, language, limit, offset);
        }
      }
    }

    return {
      entries: entriesResult.recordset.map(row => this.mapRowToEntity(row)),
      total: total
    };
  }

  /**
   * Stage-2 helper (docs/DICTIONARY_AI_FALLBACK_SEARCH.md): match numberedPinyin against any of a
   * set of regex patterns (one per spaceless-segmentation tiling), OR-ed together. Same
   * count+paginate shape as searchByWord1's primary query, ordered shortest-word-first.
   */
  private async searchByNumberedPinyinPatterns(
    patterns: string[],
    language: string,
    limit: number,
    offset: number
  ): Promise<{ entries: DictionaryEntry[], total: number }> {
    // $1 = language, $2..$(n+1) = patterns, then LIMIT/OFFSET.
    const orClause = patterns.map((_, i) => `"numberedPinyin" ~* $${i + 2}`).join('\n          OR ');
    const baseParams: any[] = [language, ...patterns];
    const limitPlaceholder = `$${baseParams.length + 1}`;
    const offsetPlaceholder = `$${baseParams.length + 2}`;

    const countResult = await this.dbManager.executeQuery<any>(async (client) => {
      return await client.query(`
        SELECT COUNT(*) as count
        FROM ${this.tableName}
        WHERE language = $1 AND (
          ${orClause}
        )
      `, baseParams);
    });

    const entriesResult = await this.dbManager.executeQuery<any>(async (client) => {
      return await client.query(`
        SELECT ${DICTIONARY_COLUMNS}
        FROM ${this.tableName}
        WHERE language = $1 AND (
          ${orClause}
        )
        ORDER BY LENGTH(word1), word1
        LIMIT ${limitPlaceholder} OFFSET ${offsetPlaceholder}
      `, [...baseParams, limit, offset]);
    });

    const total = parseInt(countResult.recordset[0].count, 10);
    console.log(`[DICTIONARY-DAL] 🈶 Spaceless-pinyin fallback matched ${entriesResult.recordset.length}/${total}`);
    return {
      entries: entriesResult.recordset.map(row => this.mapRowToEntity(row)),
      total,
    };
  }

  /**
   * Read a cached AI-synthesized dictionary entry by its exact query key (see
   * docs/DICTIONARY_AI_FALLBACK_SEARCH.md). Returns the row (word1 NULL ⇒ cached empty result) or
   * null on a miss.
   */
  async getAiCacheEntry(queryKey: string, language: string): Promise<AiDictionaryCacheRow | null> {
    const result = await this.dbManager.executeQuery<AiDictionaryCacheRow>(async (client) => {
      return await client.query(`
        SELECT id, "queryKey", language, word1, pinyin, definition, "queriedAt"
        FROM ai_dictionary_cache
        WHERE "queryKey" = $1 AND language = $2
      `, [queryKey, language]);
    });
    return result.recordset[0] || null;
  }

  /**
   * Insert or refresh a cached AI result for (queryKey, language). A null `word1` records an empty
   * result (AI found no likely meaning); `queriedAt` is reset to now() so the 3-month empty-row
   * staleness clock restarts on every (re-)prompt.
   */
  async upsertAiCacheEntry(
    queryKey: string,
    language: string,
    entry: { word1: string; pinyin: string; definition: string } | null
  ): Promise<void> {
    await this.dbManager.executeQuery(async (client) => {
      return await client.query(`
        INSERT INTO ai_dictionary_cache ("queryKey", language, word1, pinyin, definition, "queriedAt")
        VALUES ($1, $2, $3, $4, $5, now())
        ON CONFLICT ("queryKey", language) DO UPDATE
          SET word1 = EXCLUDED.word1,
              pinyin = EXCLUDED.pinyin,
              definition = EXCLUDED.definition,
              "queriedAt" = now()
      `, [queryKey, language, entry?.word1 ?? null, entry?.pinyin ?? null, entry?.definition ?? null]);
    });
  }

  /**
   * Read a user's completed AI-fallback model-call count for a local streak-day (migration 99).
   * Returns 0 when no row exists. Read before each model call to enforce the daily abuse limit.
   */
  async getAiUsageCount(userId: string, usageDate: string): Promise<number> {
    const result = await this.dbManager.executeQuery<{ count: number }>(async (client) => {
      return await client.query(`
        SELECT count FROM dictionary_ai_usage
        WHERE "userId" = $1 AND "usageDate" = $2
      `, [userId, usageDate]);
    });
    return result.recordset[0]?.count ?? 0;
  }

  /**
   * Atomically upsert-increment a user's completed AI-fallback call count for a local streak-day
   * and return the new value. Called once per COMPLETED model call (never on a cache hit).
   */
  async incrementAiUsage(userId: string, usageDate: string): Promise<number> {
    const result = await this.dbManager.executeQuery<{ count: number }>(async (client) => {
      return await client.query(`
        INSERT INTO dictionary_ai_usage ("userId", "usageDate", count)
        VALUES ($1, $2, 1)
        ON CONFLICT ("userId", "usageDate") DO UPDATE
          SET count = dictionary_ai_usage.count + 1
        RETURNING count
      `, [userId, usageDate]);
    });
    return result.recordset[0].count;
  }

  /**
   * Read a cached word-comparison paragraph for a canonically-ordered pair (migration 105).
   * Caller (DictionaryService.compareWords) sorts wordA/wordB before calling — this method
   * does not sort. See docs/WORD_COMPARE_FEATURE.md.
   */
  async getComparison(wordA: string, wordB: string, language: string): Promise<WordComparisonRow | null> {
    const result = await this.dbManager.executeQuery<WordComparisonRow>(async (client) => {
      return await client.query(`
        SELECT id, "wordA", "wordB", language, comparison, model, "queriedAt"
        FROM word_comparison_cache
        WHERE "wordA" = $1 AND "wordB" = $2 AND language = $3
      `, [wordA, wordB, language]);
    });
    return result.recordset[0] || null;
  }

  /**
   * Insert or refresh a cached comparison for a canonically-ordered pair. `queriedAt` is reset
   * to now() so it reflects the most recent (re-)generation.
   */
  async upsertComparison(
    wordA: string,
    wordB: string,
    language: string,
    comparison: string,
    model: string
  ): Promise<void> {
    await this.dbManager.executeQuery(async (client) => {
      return await client.query(`
        INSERT INTO word_comparison_cache ("wordA", "wordB", language, comparison, model, "queriedAt")
        VALUES ($1, $2, $3, $4, $5, now())
        ON CONFLICT ("wordA", "wordB", language) DO UPDATE
          SET comparison = EXCLUDED.comparison,
              model = EXCLUDED.model,
              "queriedAt" = now()
      `, [wordA, wordB, language, comparison, model]);
    });
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
    word1?: string;
    entryKey?: string;
    exampleSentences?: Array<{ foreignText: string; english: string; partOfSpeechDict?: Record<string, string>; [key: string]: any }> | null;
  }>(entries: T[], language: string = 'zh'): Promise<T[]> {
    const withSentences = entries.filter(e => e.exampleSentences?.length);
    if (withSentences.length === 0) return entries;

    // Spanish (and other space-segmented Latin-script languages) don't use the
    // Chinese greedy character segmentation or pinyin/particle lookups. Split on
    // whitespace and attach a per-word definition from dictionaryentries_es.
    if (language === 'es') {
      return this.enrichSpanishExampleSentencesMetadataBatch(entries, withSentences, language);
    }

    // 1. Collect all candidate substrings across all sentences — one combined set
    const allCandidates = new Set<string>();
    for (const entry of withSentences) {
      for (const sentence of entry.exampleSentences!) {
        for (const candidate of getAllSubstrings(sentence.foreignText)) {
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

    // 3b. Batch-fetch human approvals (validations table) so each sentence can carry
    //     `humanApproved` — sentences without a valid approval render with the
    //     AI-generated styling on the client (docs/DATA_VALIDATION_SYSTEM.md).
    const approvedByWord = await this.fetchApprovedSentenceContents(withSentences, language);

    // 4. Enrich each sentence object with _segments, segmentMetadata, and humanApproved
    return entries.map(entry => {
      if (!entry.exampleSentences?.length) return entry;
      const approvedContents = approvedByWord.get(entry.word1 ?? entry.entryKey ?? '');

      return {
        ...entry,
        exampleSentences: entry.exampleSentences.map(sentence => {
          // Segmentation is authored by the example-sentence tagging pass
          // (backfill-example-sentences.js) and persisted on `segments`, so
          // partOfSpeechDict/senseDict/numberDict keys align exactly with the segments
          // rendered here. Trust the stored segmentation when present; fall back to a
          // live GSA only for rows written before the pass existed (no `segments`).
          const prioritySegments = entry.word1 ? [entry.word1] : undefined;
          const segments = Array.isArray(sentence.segments) && sentence.segments.length > 0
            ? sentence.segments
            : segmentWithDict(sentence.foreignText, dictMap, excludeTokens, prioritySegments);
          // Build per-segment metadata via the shared helper. Example sentences use the
          // full feature set: particle/classifier annotation (gated by the segment POS dict),
          // per-segment sense → cluster dd (senseDict), context-matched fallback definitions
          // (against the English translation), and wordForms.
          const segmentMetadata = buildSegmentMetadata(segments, dictMap, {
            pacMap,
            partOfSpeechDict: sentence.partOfSpeechDict,
            translatedContext: sentence.english,
            includeWordForms: true,
            senseDict: sentence.senseDict,
          });

          return {
            ...sentence,
            _segments: segments,
            segmentMetadata,
            humanApproved: this.isSentenceHumanApproved(approvedContents, sentence),
          };
        }),
      };
    });
  }

  /**
   * Batch-fetch the human-APPROVED example-sentence bodies for a set of entries,
   * keyed by headword (`word1`). One query regardless of batch size.
   *
   * A validation row counts here only with the approval stamp (`action = 'approve'`);
   * flags are suggestions, not endorsements. The rows are joined back to the det
   * table by `entryId` (validations are keyed by the det surrogate id, which is
   * stable across data deploys — docs/DATA_VALIDATION_SYSTEM.md) so we can key the
   * result by word1, the identity the enrichment batch actually carries (vet-joined
   * entries expose `entryKey` = det `word1`, not the det id).
   *
   * Whether the approved content still matches the CURRENT det data is decided
   * per-sentence in isSentenceHumanApproved — an approval of since-regenerated text
   * must not keep blessing the new text.
   */
  private async fetchApprovedSentenceContents(
    entries: Array<{ word1?: string; entryKey?: string }>,
    language: string
  ): Promise<Map<string, Set<string>>> {
    const words = [...new Set(
      entries.map(e => e.word1 ?? e.entryKey).filter((w): w is string => !!w)
    )];
    const approvedByWord = new Map<string, Set<string>>();
    if (words.length === 0) return approvedByWord;

    const table = dictTableForLanguage(language);
    const result = await this.dbManager.executeQuery<{ word1: string; content: string }>(
      async (client) =>
        client.query(
          `SELECT d.word1, val.content
             FROM validations val
             JOIN ${table} d ON d.id = val."entryId" AND d.language = val.language
            WHERE val.language = $1
              AND val.action = 'approve'
              AND val.field IN ('exampleSentence0', 'exampleSentence1', 'exampleSentence2')
              AND d.word1 = ANY($2)`,
          [language, words]
        )
    );

    for (const row of result.recordset) {
      let contents = approvedByWord.get(row.word1);
      if (!contents) {
        contents = new Set<string>();
        approvedByWord.set(row.word1, contents);
      }
      // The stored body is `exampleSentenceN:\n<pretty-printed JSON>` (ValidationService
      // composeBody/rawField). Strip the label line here so the per-sentence match is
      // index-agnostic — a reorder of exampleSentences doesn't orphan an exact approval.
      contents.add(row.content.slice(row.content.indexOf('\n') + 1));
    }
    return approvedByWord;
  }

  /**
   * An approval is valid for THIS sentence only if the approved content matches the
   * current det data — an approval recorded before the sentence was regenerated,
   * re-tagged, or edited must not carry over to data no human reviewed.
   *
   * The comparison mirrors ValidationService.composeBody/rawField for
   * exampleSentenceN: the composed body is the label line (stripped at fetch time)
   * plus `JSON.stringify(<raw det sentence object>, null, 2)`. Both sides read the
   * same jsonb value from the same det row, so Postgres's canonical jsonb key order
   * makes the serialization deterministic. The sentence passed in must be the
   * UN-enriched object (before `_segments`/`segmentMetadata`/`humanApproved` are
   * spread on), exactly as stored in the det column.
   *
   * The current body is run through sanitizeDocumentContent (idempotent — it only
   * strips control chars and normalizes line endings) to match how the approved
   * content was stored, since validations.content passed through the same sanitizer
   * on its way into the table.
   */
  private isSentenceHumanApproved(
    approvedContents: Set<string> | undefined,
    sentence: Record<string, unknown>
  ): boolean {
    if (!approvedContents || approvedContents.size === 0) return false;
    // Defensively drop the runtime-only enrichment keys. They are appended by
    // spread AFTER the stored keys, so removing them restores the det column's
    // exact serialization even if a sentence arrives already enriched.
    const { _segments, segmentMetadata, humanApproved, ...rawSentence } =
      sentence ?? {};
    void _segments; void segmentMetadata; void humanApproved;
    const body = JSON.stringify(rawSentence, null, 2);
    return approvedContents.has(sanitizeDocumentContent(body));
  }

  /**
   * Attach `definitionsApproved: boolean` to each entry: TRUE iff a validator
   * approved the 'definitions' field (docs/DATA_VALIDATION_SYSTEM.md) and it still
   * matches the entry's CURRENT raw det data. Unlike the example-sentence flag, this
   * is bundled as ONE unit across three columns (`partsOfSpeech` + `definitions` +
   * `longDefinition` — mirroring `ValidationService.composeBody`'s 'definitions'
   * branch): editing or regenerating ANY of the three invalidates the whole approval.
   *
   * Independent of enrichExampleSentencesMetadataBatch (no exampleSentences
   * precondition) — callers chain it alongside enrichLongDefinitionMetadataBatch.
   * Reads the RAW det columns fresh (not the caller's already-transformed
   * `longDefinition` display string) so the comparison matches composeBody exactly.
   */
  async enrichDefinitionsApprovalBatch<T extends {
    word1?: string;
    entryKey?: string;
  }>(entries: T[], language: string = 'zh'): Promise<Array<T & { definitionsApproved: boolean }>> {
    const words = [...new Set(
      entries.map(e => e.word1 ?? e.entryKey).filter((w): w is string => !!w)
    )];
    if (words.length === 0) return entries.map(e => ({ ...e, definitionsApproved: false }));

    const table = dictTableForLanguage(language);
    const rawResult = await this.dbManager.executeQuery<{
      word1: string;
      partsOfSpeech: string[] | null;
      definitions: unknown;
      longDefinition: unknown;
    }>(
      async (client) =>
        client.query(
          `SELECT word1, "partsOfSpeech", definitions, "longDefinition"
             FROM ${table} WHERE word1 = ANY($1) AND language = $2`,
          [words, language]
        )
    );
    const rawByWord = new Map(rawResult.recordset.map(r => [r.word1, r]));
    const approvedByWord = await this.fetchApprovedDefinitionsContents(words, language);

    return entries.map(entry => {
      const word = entry.word1 ?? entry.entryKey;
      const raw = word ? rawByWord.get(word) : undefined;
      const definitionsApproved = raw
        ? this.isDefinitionsHumanApproved(approvedByWord.get(word!), raw)
        : false;
      return { ...entry, definitionsApproved };
    });
  }

  /**
   * Batch-fetch human-APPROVED 'definitions' bodies, keyed by headword. Mirrors
   * fetchApprovedSentenceContents but for the single `field = 'definitions'`
   * (no per-index stripping — the whole composed body is compared as one unit).
   */
  private async fetchApprovedDefinitionsContents(
    words: string[],
    language: string
  ): Promise<Map<string, Set<string>>> {
    const approvedByWord = new Map<string, Set<string>>();
    if (words.length === 0) return approvedByWord;

    const table = dictTableForLanguage(language);
    const result = await this.dbManager.executeQuery<{ word1: string; content: string }>(
      async (client) =>
        client.query(
          `SELECT d.word1, val.content
             FROM validations val
             JOIN ${table} d ON d.id = val."entryId" AND d.language = val.language
            WHERE val.language = $1
              AND val.action = 'approve'
              AND val.field = 'definitions'
              AND d.word1 = ANY($2)`,
          [language, words]
        )
    );

    for (const row of result.recordset) {
      let contents = approvedByWord.get(row.word1);
      if (!contents) {
        contents = new Set<string>();
        approvedByWord.set(row.word1, contents);
      }
      contents.add(row.content);
    }
    return approvedByWord;
  }

  /**
   * Rebuilds the exact 'definitions' composeBody output (ValidationService.composeBody
   * + rawField, three blocks joined by blank lines) from the CURRENT raw det columns
   * and compares against the stored approval content, run through the same
   * (idempotent) sanitizeDocumentContent used on the write path.
   */
  private isDefinitionsHumanApproved(
    approvedContents: Set<string> | undefined,
    raw: { partsOfSpeech: string[] | null; definitions: unknown; longDefinition: unknown }
  ): boolean {
    if (!approvedContents || approvedContents.size === 0) return false;
    const rawField = (name: string, value: unknown) => `${name}:\n${JSON.stringify(value ?? null, null, 2)}`;
    const body = [
      rawField('partsOfSpeech', raw.partsOfSpeech),
      rawField('definitions', raw.definitions),
      rawField('longDefinition', raw.longDefinition),
    ].join('\n\n');
    return approvedContents.has(sanitizeDocumentContent(body));
  }

  /**
   * Spanish counterpart of enrichExampleSentencesMetadataBatch. Spanish is written
   * in Latin script with word boundaries, so there is no greedy character
   * segmentation, no pinyin, and no particle/classifier model. Instead:
   *   - `_segments` = the sentence split on whitespace (the rendered word tokens).
   *   - `segmentMetadata[token]` = { definition } looked up from dictionaryentries_es
   *     by the token's punctuation-stripped, lowercased form.
   *
   * One batched query covers every word across every sentence. `word1` is matched
   * case-insensitively; the first row's first definition wins for homographs.
   */
  private async enrichSpanishExampleSentencesMetadataBatch<T extends {
    word1?: string;
    entryKey?: string;
    exampleSentences?: Array<{ foreignText: string; english: string; partOfSpeechDict?: Record<string, string>; [key: string]: any }> | null;
  }>(entries: T[], withSentences: T[], language: string = 'es'): Promise<T[]> {
    // Strip leading/trailing punctuation (incl. Spanish ¿ ¡ « » and ASCII) from a
    // token, leaving letters/numbers/inner hyphens/apostrophes for dictionary lookup.
    const cleanToken = (token: string): string =>
      token.replace(/^[^\p{L}\p{N}]+/u, '').replace(/[^\p{L}\p{N}]+$/u, '');

    // 1. Collect every distinct lowercased word form across all sentences.
    const lookupForms = new Set<string>();
    for (const entry of withSentences) {
      for (const sentence of entry.exampleSentences!) {
        for (const rawToken of sentence.foreignText.split(/\s+/)) {
          const cleaned = cleanToken(rawToken).toLowerCase();
          if (cleaned) lookupForms.add(cleaned);
        }
      }
    }

    // 2. One batch query against the Spanish dictionary table. (BaseDAL.tableName is
    //    dictionaryentries_zh, so query dictionaryentries_es explicitly here.)
    const defByForm = new Map<string, string>();
    if (lookupForms.size > 0) {
      const result = await this.dbManager.executeQuery<any>(async (client) => {
        return await client.query(
          `SELECT lower(word1) AS form, definitions
           FROM dictionaryentries_es
           WHERE lower(word1) = ANY($1)`,
          [[...lookupForms]]
        );
      });
      for (const row of result.recordset) {
        if (defByForm.has(row.form)) continue; // first row wins for homographs
        const defs = Array.isArray(row.definitions) ? row.definitions : [];
        const first = defs.find((d: unknown) => typeof d === 'string' && d.trim().length > 0);
        if (first) defByForm.set(row.form, first);
      }
    }

    // 2b. Batch-fetch human approvals so each sentence carries `humanApproved`,
    //     mirroring the Chinese path (docs/DATA_VALIDATION_SYSTEM.md).
    const approvedByWord = await this.fetchApprovedSentenceContents(withSentences, language);

    // 3. Attach _segments (whitespace tokens) + per-token definitions + humanApproved.
    return entries.map(entry => {
      if (!entry.exampleSentences?.length) return entry;
      const approvedContents = approvedByWord.get(entry.word1 ?? entry.entryKey ?? '');
      return {
        ...entry,
        exampleSentences: entry.exampleSentences.map(sentence => {
          const segments = sentence.foreignText.split(/\s+/).filter(Boolean);
          const segmentMetadata: Record<string, { definition?: string }> = {};
          for (const token of segments) {
            const def = defByForm.get(cleanToken(token).toLowerCase());
            if (def) segmentMetadata[token] = { definition: def };
          }
          return {
            ...sentence,
            _segments: segments,
            segmentMetadata,
            humanApproved: this.isSentenceHumanApproved(approvedContents, sentence),
          };
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
   * Enrich each entry's `longDefinition` into `longDefinitionParts` — an ordered list of
   * English-prose parts and embedded-Chinese parts. The Chinese parts carry the same
   * `{ foreignText, _segments, segmentMetadata }` shape as an example sentence, so the
   * client renders them as cpcd with the identical hover/tap definition popup.
   *
   * Chinese-only: `longDefinition` for non-`zh` languages (e.g. Spanish) has no Han runs,
   * so it returns a single text part with no DB work. Mirrors enrichExampleSentencesMetadataBatch:
   * one batched dictionary query + one batched particle/classifier query across all entries.
   * Computed on-the-fly; not stored in the DB.
   *
   * @param entries - Objects with optional `longDefinition` field
   * @param language - Language filter for dictionary lookups (default: 'zh')
   */
  async enrichLongDefinitionMetadataBatch<T extends {
    longDefinition?: string | null;
  }>(entries: T[], language: string = 'zh'): Promise<T[]> {
    // `longDefinition` is stored as a JSONB object keyed by POS (migration 70). Some
    // callers reach here with the raw object (dictJoin-based queries bypass the row→entity
    // map), so normalize each entry to the canonical labeled string first — both for the
    // segmentation below and on the entry itself, so the API never leaks the raw object.
    for (const entry of entries) {
      entry.longDefinition = longDefObjectToDisplayString(
        entry.longDefinition as Parameters<typeof longDefObjectToDisplayString>[0]
      );
    }

    // Split each long definition into runs once; reused for both candidate collection
    // and the final part assembly below.
    const runsByEntry = entries.map(entry => {
      const text = typeof entry.longDefinition === 'string' ? entry.longDefinition : '';
      return text ? splitHanRuns(text) : [];
    });

    // Only Chinese runs need dictionary segmentation. For non-zh (no Han) this stays empty
    // and we short-circuit without touching the DB.
    const allCandidates = new Set<string>();
    if (language === 'zh') {
      for (const runs of runsByEntry) {
        for (const run of runs) {
          if (run.type !== 'han') continue;
          for (const candidate of getAllSubstrings(run.value)) {
            allCandidates.add(candidate);
          }
        }
      }
    }

    if (allCandidates.size === 0) {
      // No embedded Chinese anywhere: every long definition is a single text part.
      return entries.map((entry, i) => ({
        ...entry,
        longDefinitionParts: runsByEntry[i].length
          ? runsByEntry[i].map(run => ({ type: 'text' as const, value: run.value }))
          : null,
      }));
    }

    // Single batch dictionary query for all Chinese runs across all entries.
    const dictEntries = await this.findMultipleByWord1([...allCandidates], language);
    const dictMap = buildDictMap(dictEntries);
    const excludeTokens = buildExcludeSet(dictEntries);

    return entries.map((entry, i) => {
      const runs = runsByEntry[i];
      if (runs.length === 0) {
        return { ...entry, longDefinitionParts: null };
      }

      const parts: LongDefinitionPart[] = runs.map(run => {
        if (run.type === 'text') {
          return { type: 'text', value: run.value };
        }
        // Each Chinese run is a mini-sentence: GSA-segment it, then build segment metadata.
        // No partOfSpeechDict/translation context exists for an inline definition word, so
        // particle/classifier annotation is skipped and definitions fall back to the
        // dictionary's best/first sense.
        const segments = segmentWithDict(run.value, dictMap, excludeTokens);
        const segmentMetadata: Record<string, RenderedSegmentMeta> =
          buildSegmentMetadata(segments, dictMap);
        return { type: 'foreign', foreignText: run.value, _segments: segments, segmentMetadata };
      });

      return { ...entry, longDefinitionParts: parts };
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
