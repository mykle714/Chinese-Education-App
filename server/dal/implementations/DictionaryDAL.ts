import { BaseDAL } from '../base/BaseDAL.js';
import { IDictionaryDAL } from '../interfaces/IDictionaryDAL.js';
import { dbManager } from '../base/DatabaseManager.js';
import { DictionaryEntry, DictionaryEntryCreateData, ParticleClassifierEntry } from '../../types/index.js';
import { ValidationError } from '../../types/dal.js';
import { resolveShortDefinition, longDefObjectToDisplayString } from '../../utils/definitions.js';
import { ShortDefinitionPronunciationOverride, ExampleSentenceDefinitionPronunciationOverride } from '../../types/index.js';
import { getAllSubstrings, buildDictMap, buildExcludeSet, segmentWithDict, buildSegmentMetadata, splitHanRuns, RenderedSegmentMeta } from '../shared/segmentString.js';
import { LongDefinitionPart } from '../../types/index.js';

// Standard column list for all dictionary SELECT queries
const DICTIONARY_COLUMNS = `
  id, language, script, discoverable, "createdAt",
  word1, word2, pronunciation, "numberedPinyin", tone,
  "partsOfSpeech", "difficulty",
  definitions, "longDefinition",
  breakdown, synonyms,
  "exampleSentences",
  expansion, "expansionLiteralTranslation",
  "matchException",
  "shortDefinitionPronunciationOverride",
  "exampleSentenceDefinitionPronunciationOverride",
  "vernacularScore",
  "wordForms"
`.trim();

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
      breakdown: row.breakdown ?? null,
      synonyms: row.synonyms ?? null,
      exampleSentences: row.exampleSentences ?? null, // Enriched on-the-fly via enrichExampleSentencesMetadataBatch
      expansion: row.expansion ?? null,
      expansionLiteralTranslation: row.expansionLiteralTranslation ?? null,
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

    // Word/pinyin match (everything except the English-definition contains search).
    // Reused both as the WHERE word-match group and as the ORDER BY priority test so
    // that the ranking mirrors exactly how a row qualified.
    const wordMatchExpr = `word1 ILIKE $2
          OR pronunciation ~ $3${numberedPinyinClause}`;

    // English-definition search. We match only the text actually shown on the result
    // card (DictionaryEntryRow): the FIRST definition with all parenthetical substrings
    // stripped — i.e. regexp_replace(definitions->>0, '\s*\([^)]*\)', '', 'g'), mirroring
    // the frontend stripParentheses(definitions[0]). Matching is whole-word only, via the
    // Postgres word-boundary anchor \y, so "art" matches "art"/"fine art" but not "start".
    // $5 holds the anchored, regex-escaped pattern. Case-insensitive (~*) since the query
    // term is lowercased but card text may be capitalised.
    // Guarded by a minimum length so trivial single-letter searches don't scan the table.
    const definitionsSearchEnabled = searchTerm.trim().length >= 2;
    // Escape regex metacharacters in the user term, then anchor it to word boundaries.
    const escapedTerm = searchTerm.trim().replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
    const wholeWordDefinitionPattern = `\\y${escapedTerm}\\y`;
    const definitionsClause = definitionsSearchEnabled
      ? `\n          OR regexp_replace(definitions->>0, '\\s*\\([^)]*\\)', '', 'g') ~* $5`
      : '';

    // Placeholder indices for LIMIT/OFFSET shift by one when the definition param ($5) is present.
    const limitPlaceholder = definitionsSearchEnabled ? '$6' : '$5';
    const offsetPlaceholder = definitionsSearchEnabled ? '$7' : '$6';

    // Build the parameter lists so their count exactly matches the referenced placeholders.
    const countParams: any[] = [language, searchPattern, regexPattern, excludePattern];
    if (definitionsSearchEnabled) countParams.push(wholeWordDefinitionPattern);
    const entriesParams = [...countParams, limit, offset];

    // Get total count for pagination
    // Search with regex for pronunciation (accent-agnostic + word boundaries), LIKE for word1/definitions
    // Exclude results where pronunciation ends in 'g' immediately after the search term
    const countResult = await this.dbManager.executeQuery<any>(async (client) => {
      return await client.query(`
        SELECT COUNT(*) as count
        FROM ${this.tableName}
        WHERE language = $1 AND (
          ${wordMatchExpr}${definitionsClause}
        )
        AND NOT (pronunciation ~ $4)
      `, countParams);
    });

    // Get paginated results
    // Search with regex for pronunciation (accent-agnostic + word boundaries), LIKE for word1/definitions
    // Exclude results where pronunciation ends in 'g' immediately after the search term
    const entriesResult = await this.dbManager.executeQuery<any>(async (client) => {
      return await client.query(`
        SELECT ${DICTIONARY_COLUMNS}
        FROM ${this.tableName}
        WHERE language = $1 AND (
          ${wordMatchExpr}${definitionsClause}
        )
        AND NOT (pronunciation ~ $4)
        ORDER BY
          CASE WHEN (${wordMatchExpr}) THEN 0 ELSE 1 END,
          LENGTH(word1), word1
        LIMIT ${limitPlaceholder} OFFSET ${offsetPlaceholder}
      `, entriesParams);
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
    word1?: string;
    exampleSentences?: Array<{ foreignText: string; english: string; partOfSpeechDict?: Record<string, string>; [key: string]: any }> | null;
  }>(entries: T[], language: string = 'zh'): Promise<T[]> {
    const withSentences = entries.filter(e => e.exampleSentences?.length);
    if (withSentences.length === 0) return entries;

    // Spanish (and other space-segmented Latin-script languages) don't use the
    // Chinese greedy character segmentation or pinyin/particle lookups. Split on
    // whitespace and attach a per-word definition from dictionaryentries_es.
    if (language === 'es') {
      return this.enrichSpanishExampleSentencesMetadataBatch(entries, withSentences);
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

    // 4. Enrich each sentence object with _segments and segmentMetadata
    return entries.map(entry => {
      if (!entry.exampleSentences?.length) return entry;

      return {
        ...entry,
        exampleSentences: entry.exampleSentences.map(sentence => {
          // Tokens tagged as 'classifier' in this sentence's AI-generated POS dict
          // become forced segment boundaries — guarantees they surface as standalone
          // segments so the particle/classifier annotation block below picks them up
          // even when they would otherwise be absorbed into a longer GSA match.
          const classifierTokens = new Set<string>(
            Object.entries(sentence.partOfSpeechDict ?? {})
              .filter(([, tag]) => tag === 'classifier')
              .map(([token]) => token)
          );
          // Force the entry's own headword to win segmentation when it appears in
          // the sentence — otherwise a higher-vernacularScore overlap can swallow it
          // and we'd end up showing the wrong segment's metadata for the vocab word.
          const prioritySegments = entry.word1 ? [entry.word1] : undefined;
          const segments = segmentWithDict(
            sentence.foreignText,
            dictMap,
            excludeTokens,
            prioritySegments,
            classifierTokens
          );
          // Build per-segment metadata via the shared helper. Example sentences use the
          // full feature set: particle/classifier annotation (gated by the AI POS dict),
          // context-matched definitions (against the English translation), and wordForms.
          const segmentMetadata = buildSegmentMetadata(segments, dictMap, {
            pacMap,
            partOfSpeechDict: sentence.partOfSpeechDict,
            translatedContext: sentence.english,
            includeWordForms: true,
          });

          return { ...sentence, _segments: segments, segmentMetadata };
        }),
      };
    });
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
    exampleSentences?: Array<{ foreignText: string; english: string; partOfSpeechDict?: Record<string, string>; [key: string]: any }> | null;
  }>(entries: T[], withSentences: T[]): Promise<T[]> {
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

    // 3. Attach _segments (whitespace tokens) + per-token definitions.
    return entries.map(entry => {
      if (!entry.exampleSentences?.length) return entry;
      return {
        ...entry,
        exampleSentences: entry.exampleSentences.map(sentence => {
          const segments = sentence.foreignText.split(/\s+/).filter(Boolean);
          const segmentMetadata: Record<string, { definition?: string }> = {};
          for (const token of segments) {
            const def = defByForm.get(cleanToken(token).toLowerCase());
            if (def) segmentMetadata[token] = { definition: def };
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
   * Enrich each entry with GSA-segmented expansion data.
   *
   * Mirrors enrichExampleSentencesMetadataBatch: runs the greedy segmentation algorithm
   * on each entry's expansion string, then batch-queries dictionaryentries_zh for all candidate
   * substrings. Computed on-the-fly; not stored in the DB.
   *
   * Each entry gains:
   *   - `expansionSegments: string[]`  — GSA word tokens (e.g. ["不知", "不觉"] for 不知不觉)
   *   - `expansionMetadata: Record<segment, { pronunciation?, definition? }>` — keyed by segment
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
      return entries.map(entry => ({ ...entry, expansionSegments: null, expansionMetadata: null }));
    }

    // 1. Collect all candidate substrings across all expansion strings
    const allCandidates = new Set<string>();
    for (const entry of withExpansion) {
      for (const candidate of getAllSubstrings(entry.expansion!.trim())) {
        allCandidates.add(candidate);
      }
    }

    // 2. Single batch DB query for all candidates
    const dictEntries = await this.findMultipleByWord1([...allCandidates], language);
    const dictMap = buildDictMap(dictEntries);
    const excludeTokens = buildExcludeSet(dictEntries);

    // 3. Run GSA and build segment-keyed metadata for each entry
    return entries.map(entry => {
      const expansion = typeof entry.expansion === 'string' ? entry.expansion.trim() : '';
      if (!expansion) {
        return { ...entry, expansionSegments: null, expansionMetadata: null };
      }

      const expansionSegments = segmentWithDict(expansion, dictMap, excludeTokens);
      const translatedExpansion =
        typeof entry.expansionLiteralTranslation === 'string'
          ? entry.expansionLiteralTranslation
          : null;

      // Expansion is pure Chinese: no particle/classifier model and no wordForms — just
      // pronunciation + context-matched definition (against the literal translation).
      const expansionMetadata = buildSegmentMetadata(expansionSegments, dictMap, {
        translatedContext: translatedExpansion,
      });

      return {
        ...entry,
        expansionSegments,
        expansionMetadata: Object.keys(expansionMetadata).length > 0 ? expansionMetadata : null,
      };
    });
  }

  /**
   * Enrich each entry's `longDefinition` into `longDefinitionParts` — an ordered list of
   * English-prose parts and embedded-Chinese parts. The Chinese parts carry the same
   * `{ foreignText, _segments, segmentMetadata }` shape as an example sentence, so the
   * client renders them as cpcd with the identical hover/tap definition popup.
   *
   * Chinese-only: `longDefinition` for non-`zh` languages (e.g. Spanish) has no Han runs,
   * so it returns a single text part with no DB work. Mirrors enrichExpansionMetadataBatch:
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
