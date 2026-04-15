import Anthropic from '@anthropic-ai/sdk';
import { IDictionaryDAL } from '../dal/interfaces/IDictionaryDAL.js';
import { DictionaryEntry, VocabEntry } from '../types/index.js';
import { ValidationError } from '../types/dal.js';
import { getAllSubstrings, buildDictMap, buildExcludeSet, segmentWithDict } from '../dal/shared/segmentString.js';

/**
 * Dictionary Service - Contains business logic for dictionary operations
 * Handles CC-CEDICT dictionary lookups for the reader feature
 */
export class DictionaryService {
  constructor(private dictionaryDAL: IDictionaryDAL) {}

  /**
   * Look up a single term in the dictionary for a specific language
   */
  async lookupTerm(term: string, language: string): Promise<DictionaryEntry | null> {
    // Validation
    if (!term || term.trim().length === 0) {
      throw new ValidationError('Search term is required');
    }

    if (!language || language.trim().length === 0) {
      throw new ValidationError('Language is required');
    }

    const trimmedTerm = term.trim();
    
    const entry = await this.dictionaryDAL.findByWord1(trimmedTerm, language);
    if (!entry) return null;

    const [withExpansionMeta] = await this.enrichExpansionMetadataBatch([entry], language);
    return withExpansionMeta;
  }

  /**
   * Look up multiple terms in the dictionary for a specific language
   * Used by reader feature to get all dictionary matches for a document
   */
  async lookupMultipleTerms(terms: string[], language: string): Promise<DictionaryEntry[]> {
    console.log(`[DICTIONARY-SERVICE] 🔄 Processing lookup request for ${terms?.length || 0} terms in ${language}`);
    const startTime = performance.now();

    // Validation
    if (!terms || terms.length === 0) {
      console.log(`[DICTIONARY-SERVICE] 📝 Empty terms array, returning empty result`);
      return [];
    }

    if (!language || language.trim().length === 0) {
      throw new ValidationError('Language is required');
    }

    // Filter and clean terms
    const cleanedTerms = terms
      .map(t => t.trim())
      .filter(t => t.length > 0);

    // Remove duplicates
    const uniqueTerms = [...new Set(cleanedTerms)];

    console.log(`[DICTIONARY-SERVICE] 🧹 Term processing:`, {
      originalCount: terms.length,
      afterCleaning: cleanedTerms.length,
      afterDeduplication: uniqueTerms.length,
      language: language
    });

    if (uniqueTerms.length === 0) {
      console.log(`[DICTIONARY-SERVICE] 📝 No valid terms found`);
      return [];
    }

    // Business rule: limit to prevent abuse
    if (uniqueTerms.length > 1000) {
      throw new ValidationError('Too many terms requested (maximum 1000)');
    }

    const entries = await this.dictionaryDAL.findMultipleByWord1(uniqueTerms, language);
    const withExpansionMeta = await this.enrichExpansionMetadataBatch(entries, language);
    
    const totalTime = performance.now() - startTime;
    console.log(`[DICTIONARY-SERVICE] ✅ Lookup complete:`, {
      language: language,
      termsQueried: uniqueTerms.length,
      entriesFound: withExpansionMeta.length,
      matchRate: `${(withExpansionMeta.length / uniqueTerms.length * 100).toFixed(1)}%`,
      totalTime: `${totalTime.toFixed(2)}ms`
    });

    return withExpansionMeta;
  }

  /**
   * Search dictionary entries with pagination
   */
  async searchDictionary(
    searchTerm: string,
    language: string,
    limit: number = 50,
    offset: number = 0
  ): Promise<{ entries: DictionaryEntry[], total: number }> {
    // Validation
    if (!searchTerm || searchTerm.trim().length === 0) {
      throw new ValidationError('Search term is required');
    }

    if (!language || language.trim().length === 0) {
      throw new ValidationError('Language is required');
    }

    if (limit < 1 || limit > 100) {
      throw new ValidationError('Limit must be between 1 and 100');
    }

    if (offset < 0) {
      throw new ValidationError('Offset must be non-negative');
    }

    const trimmedTerm = searchTerm.trim();
    
    const result = await this.dictionaryDAL.searchByWord1(trimmedTerm, language, limit, offset);
    const withExpansionMeta = await this.enrichExpansionMetadataBatch(result.entries, language);

    return {
      entries: withExpansionMeta,
      total: result.total,
    };
  }

  /**
   * Segment input text using the GSA, then for each segment fetch all dictionary entries
   * whose word1 starts with that segment (prefix search).
   *
   * Returns groups ordered by segment character length (longest first). Within each group,
   * entries are ordered by the DAL's default relevance ordering.
   * Groups with no matching entries are silently dropped.
   */
  async segmentAndLookup(text: string, language: string): Promise<Array<{ segment: string; exactEntries: DictionaryEntry[]; prefixEntries: DictionaryEntry[] }>> {
    if (!text.trim()) return [];

    const trimmed = text.trim();

    // Step 1: collect all candidate substrings for a single-round-trip DB query to feed the GSA
    const candidates = getAllSubstrings(trimmed);
    const exactEntries = await this.dictionaryDAL.findMultipleByWord1(candidates, language);

    // Step 2: build GSA structures and segment the input
    const dictMap = buildDictMap(exactEntries);
    const excludeSet = buildExcludeSet(exactEntries);
    const rawSegments = segmentWithDict(trimmed, dictMap, excludeSet);

    // Step 3: track each segment's character offset in the original string (first occurrence)
    const segmentPosition = new Map<string, number>();
    let charOffset = 0;
    for (const seg of rawSegments) {
      if (!segmentPosition.has(seg)) {
        segmentPosition.set(seg, charOffset);
      }
      charOffset += [...seg].length;
    }

    // Step 4: deduplicate, preserving first-occurrence GSA order
    const seen = new Set<string>();
    const uniqueSegments: string[] = [];
    for (const seg of rawSegments) {
      if (!seen.has(seg)) {
        seen.add(seg);
        uniqueSegments.push(seg);
      }
    }

    // Step 5: sort by position in the string (ASC), then by segment length (DESC) as tiebreaker
    uniqueSegments.sort((a, b) => {
      const posDiff = (segmentPosition.get(a) ?? 0) - (segmentPosition.get(b) ?? 0);
      if (posDiff !== 0) return posDiff;
      return [...b].length - [...a].length;
    });

    // Step 6: for each segment, fetch all entries that start with it (prefix search),
    // then split into exact matches (word1 === segment) and starts-with matches.
    const groups: Array<{ segment: string; exactEntries: DictionaryEntry[]; prefixEntries: DictionaryEntry[] }> = [];
    for (const seg of uniqueSegments) {
      const { entries } = await this.dictionaryDAL.searchByWord1(seg, language, 50, 0);
      if (entries.length === 0) continue;

      const enriched = await this.enrichExpansionMetadataBatch(entries, language);
      const exactEntries = enriched.filter(e => e.word1 === seg);
      const prefixEntries = enriched.filter(e => e.word1 !== seg);
      groups.push({ segment: seg, exactEntries, prefixEntries });
    }

    return groups;
  }

  /**
   * Get total count of dictionary entries
   */
  async getTotalCount(): Promise<number> {
    return await this.dictionaryDAL.getTotalCount();
  }

  /**
   * Generate character breakdown for a Chinese word
   * Looks up each character in the dictionary and returns a JSON object with definitions only.
   * Pronunciation is derived at read time from vocabentries.pronunciation (space-separated pinyin).
   * Returns null for non-Chinese words or if language is not 'zh'
   */
  async generateBreakdown(word: string, language: string): Promise<Record<string, { definition: string }> | null> {
    // Only generate breakdown for Chinese language
    if (!language || language !== 'zh') {
      return null;
    }

    if (!word || word.trim().length === 0) {
      return null;
    }

    const trimmedWord: string = word.trim();

    // Split the word into individual characters
    const characters: string[] = [...trimmedWord]; // Spread operator properly handles multi-byte characters

    if (characters.length === 0) {
      return null;
    }

    // Look up each character in the dictionary
    const characterEntries: DictionaryEntry[] = await this.dictionaryDAL.findMultipleByWord1(characters, 'zh');

    // Build the breakdown object with definition only (pronunciation is derived from vocabentries.pronunciation at read time)
    const breakdown: Record<string, { definition: string }> = {};

    for (const char of characters) {
      // Find the dictionary entry for this character
      const entry: DictionaryEntry | undefined = characterEntries.find(e => e.word1 === char);

      if (entry && entry.definitions && entry.definitions.length > 0) {
        breakdown[char] = {
          definition: entry.definitions[0],
        };
      } else {
        breakdown[char] = {
          definition: 'No definition',
        };
      }
    }

    return breakdown;
  }

  /**
   * Extract parts of speech from dictionary definitions
   * Parses definition strings for common POS markers
   */
  async extractPartsOfSpeech(word: string, language: string): Promise<string[]> {
    if (!language || language !== 'zh') {
      return [];
    }

    const entry: DictionaryEntry | null = await this.lookupTerm(word, language);
    if (!entry || !entry.definitions || entry.definitions.length === 0) {
      return [];
    }

    const posSet: Set<string> = new Set();
    const posPatterns: Record<string, RegExp> = {
      'noun': /\bn\b|\bnoun\b/i,
      'verb': /\bv\b|\bverb\b/i,
      'adjective': /\badj\b|\badjective\b/i,
      'adverb': /\badv\b|\badverb\b/i,
      'preposition': /\bprep\b|\bpreposition\b/i,
      'conjunction': /\bconj\b|\bconjunction\b/i,
      'pronoun': /\bpron\b|\bpronoun\b/i,
      'interjection': /\binterj\b|\binterjection\b/i,
      'particle': /\bparticle\b/i,
      'classifier': /\bclassifier\b|\bmeasure word\b/i,
    };

    for (const definition of entry.definitions) {
      for (const [pos, pattern] of Object.entries(posPatterns)) {
        if (pattern.test(definition)) {
          posSet.add(pos);
        }
      }
    }

    return Array.from(posSet);
  }

  /**
   * Find synonyms for a Chinese word by searching for other words with similar definitions
   */
  async findSynonyms(word: string, language: string): Promise<string[]> {
    if (!language || language !== 'zh') {
      return [];
    }

    const entry: DictionaryEntry | null = await this.lookupTerm(word, language);
    if (!entry || !entry.definitions || entry.definitions.length === 0) {
      return [];
    }

    // Take first definition and search for other words with matching definitions
    const primaryDefinition: string = entry.definitions[0].toLowerCase();
    
    // Search for entries with similar definitions (this is a simple approach)
    // In a production system, you might want more sophisticated similarity matching
    const searchResults = await this.dictionaryDAL.searchByWord1(word, language, 20, 0);
    
    const synonyms: string[] = [];
    for (const result of searchResults.entries) {
      // Skip the original word
      if (result.word1 === word) continue;
      
      // Check if any definition overlaps significantly
      for (const def of result.definitions) {
        const defLower: string = def.toLowerCase();
        // Simple overlap check - if definitions share key words
        if (defLower.includes(primaryDefinition.split(' ')[0]) || 
            primaryDefinition.includes(defLower.split(' ')[0])) {
          synonyms.push(result.word1);
          break;
        }
      }
      
      if (synonyms.length >= 5) break;
    }

    return synonyms;
  }

  /**
   * Generate example sentences for a Chinese word
   * Creates 3 sentences showing different grammatical uses
   */
  async generateExampleSentences(word: string, language: string): Promise<Array<{ chinese: string; english: string; usage: string }>> {
    if (!language || language !== 'zh') {
      return [];
    }

    const entry: DictionaryEntry | null = await this.lookupTerm(word, language);
    if (!entry) {
      return [];
    }

    // Get English translation for use in sentences
    const englishMeaning: string = entry.definitions && entry.definitions.length > 0 
      ? entry.definitions[0].replace(/\(.*?\)/g, '').trim() 
      : word;

    // Generate 3 template-based sentences
    const sentences = [
      {
        chinese: `我很喜欢${word}。`,
        english: `I really like ${englishMeaning}.`,
        usage: 'object'
      },
      {
        chinese: `${word}很有用。`,
        english: `${englishMeaning} is very useful.`,
        usage: 'subject'
      },
      {
        chinese: `这是一个关于${word}的故事。`,
        english: `This is a story about ${englishMeaning}.`,
        usage: 'prepositional'
      }
    ];

    return sentences;
  }

  /**
   * Generate an expansion for a Chinese word that reveals why the word is constructed the way it is,
   * by expanding morphemes into more vernacular/colloquial component forms.
   * Returns null if the word is already maximally vernacular, or if no illuminating expansion exists.
   */
  async generateExpansion(word: string, language: string): Promise<string | null> {
    if (!language || language !== 'zh') {
      return null;
    }

    if (!word || word.trim().length === 0) {
      return null;
    }

    const apiKey = process.env.ANTHROPIC_API_KEY;
    if (!apiKey) {
      return null;
    }

    try {
      const anthropic = new Anthropic({ apiKey });
      const trimmedWord = word.trim();

      const prompt = `You are a Chinese language expert. Your task is to expand a Chinese word into a more vernacular phrase that reveals *why the word is constructed the way it is* — i.e., what each morpheme means in everyday speech.

Rules:
- Every character from the original word must appear in the expansion, in their original order
- You may add characters anywhere — before, between, or after the originals — but never replace or omit any original character
- The expansion must use natural, everyday Mandarin that a native speaker would actually say
- The expansion must make the word's internal structure more transparent by showing what each morpheme means via its more common vernacular form
- Be strict: a valid expansion must pass ALL of the following checks:
  1. Each added chunk meaningfully expands a morpheme into a more common everyday word (e.g. 规 → 规矩, 知 → 知道, 早 → 早上)
  2. The result sounds like something a native speaker would naturally say — not a dictionary gloss or a sentence
  3. The expansion reveals insight a learner could not get from seeing the original alone

- Return null if ANY of the following apply:
  - The word is already maximally vernacular (e.g. 吃饭, 喝水, 走路, 睡觉)
  - The expansion would be circular or tautological (e.g. 学生 → 学习的学生)
  - The expansion only appends a weak suffix or classifier (e.g. 太极拳 → 太极拳法, 母亲节 → 母亲节日)
  - The expansion only reduplicates characters (e.g. 干净 → 干干净净)
  - The expansion only adds grammatical particles or aspect markers without illuminating a morpheme (e.g. 游泳 → 游着泳)
  - The expansion just appends a synonym of the whole word rather than unpacking the morphemes (e.g. 重要 → 重要紧要)
  - No natural-sounding expansion exists that meaningfully explains the structure

Good examples (each morpheme expanded into its everyday form):
  * 违规 → 违反规矩 (违 → 违反 "to violate", 规 → 规矩 "rules/norms")
  * 不知不觉 → 不知道不觉得 (知 → 知道, 觉 → 觉得)
  * 早晚 → 早上晚上 (早 → 早上, 晚 → 晚上)
  * 规则 → 规矩法则 (规 → 规矩, 则 → 法则)
  * 客厅 → 客人厅堂 (客 → 客人, 厅 → 厅堂)

Null examples:
  * 吃饭 → null (maximally vernacular)
  * 学生 → null (学习的学生 is circular)
  * 干净 → null (干干净净 is just reduplication)
  * 重要 → null (no morpheme-level expansion possible)
  * 今天 → null (今日天天 fails — 今日 is more literary, not more vernacular)
  * 母亲节 → null (母亲节日 is a weak append of 日 with no morpheme insight)
  * 网络 → null (网络网络 is circular nonsense)
  * 感冒 → null (感觉冒出来 changes the meaning)

Word: ${trimmedWord}

Respond with ONLY a JSON object in this exact format, no extra text:
{"expansion": "expanded form"} or {"expansion": null}`;

      const response = await anthropic.messages.create({
        model: 'claude-sonnet-4-6',
        max_tokens: 256,
        temperature: 0.3,
        system: 'You are a Chinese language expert. You respond only with valid JSON — no explanations, no reasoning, no extra text.',
        messages: [{ role: 'user', content: prompt }]
      });

      const content = (response.content[0] as { type: string; text: string }).text.trim();
      const stripped = content.replace(/^```(?:json)?\s*/i, '').replace(/\s*```\s*$/, '').trim();
      const objMatch = stripped.match(/\{[\s\S]*?\}/);
      if (!objMatch) return null;
      const parsed = JSON.parse(objMatch[0]);

      const raw: string | null = parsed.expansion || null;
      return raw ? this.validateExpansion(trimmedWord, raw) : null;
    } catch (error: any) {
      console.error(`Failed to generate expansion for "${word}":`, error.message);
      return null;
    }
  }

  /**
   * Post-processing validation for AI-generated expansions.
   * Catches common failure modes the prompt alone doesn't reliably prevent.
   * Returns null if the expansion is invalid.
   */
  private validateExpansion(original: string, expansion: string): string | null {
    // Must add characters — expansion must be strictly longer
    if (expansion.length <= original.length) return null;

    // Must not be identical to the original
    if (expansion === original) return null;

    // Must not contain the original as a contiguous substring (circular)
    if (expansion.includes(original)) return null;

    // Must not double any original character consecutively (AABB/reduplication pattern)
    for (const char of original) {
      if (expansion.includes(char + char)) return null;
    }

    // No original character may appear MORE times in the expansion than it does in the original.
    // (Prevents expansions where a morpheme is accidentally echoed, e.g. 加油站 → 加油的油站)
    for (const char of new Set(original)) {
      const origCount = [...original].filter(c => c === char).length;
      const expCount  = [...expansion].filter(c => c === char).length;
      if (expCount > origCount) return null;
    }

    // All original characters must appear in the expansion in their original order
    let pos = 0;
    for (const char of original) {
      const idx = expansion.indexOf(char, pos);
      if (idx === -1) return null;
      pos = idx + 1;
    }

    return expansion;
  }

  /**
   * Generate a long definition (25–75 chars) for a Chinese word using Claude Haiku AI
   * Returns null for non-Chinese words or if AI call fails
   */
  async generateLongDefinition(word: string, language: string, definitions: string[]): Promise<string | null> {
    if (!language || language !== 'zh') {
      return null;
    }

    if (!word || word.trim().length === 0) {
      return null;
    }

    const apiKey = process.env.ANTHROPIC_API_KEY;
    if (!apiKey) {
      return null;
    }

    try {
      const anthropic = new Anthropic({ apiKey });

      const prompt = `You are a Chinese language expert providing dictionary definitions.
Word: ${word.trim()}
Existing definitions: ${definitions.join(' | ')}

Write a single English definition that is between 25 and 150 characters long.
Goals (address whichever are most relevant to this word):
- Dispel common misconceptions or mistranslations
- Clarify how this word differs from similar or easily confused concepts
Respond with only the definition text — no quotes, no extra text.`;

      const response = await anthropic.messages.create({
        model: 'claude-haiku-4-5-20251001',
        max_tokens: 256,
        temperature: 0.3,
        messages: [{ role: 'user', content: prompt }]
      });

      const text = (response.content[0] as { type: string; text: string }).text.trim();
      return text.length > 0 ? text : null;
    } catch (error: any) {
      console.error(`Failed to generate long definition for "${word}":`, error.message);
      return null;
    }
  }

  /**
   * Batch-fetch synonym metadata (pronunciation + first definition) from dictionaryentries.
   * Returns a map of { [word]: { definition, pronunciation } } for each found synonym.
   */
  async buildSynonymMetadata(
    synonymWords: string[],
    language: string
  ): Promise<Record<string, { definition: string; pronunciation: string }>> {
    if (!synonymWords || synonymWords.length === 0) {
      return {};
    }

    const entries = await this.dictionaryDAL.findMultipleByWord1(synonymWords, language);

    const metadata: Record<string, { definition: string; pronunciation: string }> = {};
    for (const entry of entries) {
      metadata[entry.word1] = {
        definition: entry.definitions?.[0] ?? '',
        pronunciation: entry.pronunciation ?? '',
      };
    }

    return metadata;
  }

  /**
   * Enrich an array of VocabEntry objects with computed synonymsMetadata.
   * Collects all synonym words across entries, batch-fetches their metadata
   * from dictionaryentries, and attaches it to each entry.
   */

  /**
   * Enrich each example sentence with `_segments` and `segmentMetadata` on-the-fly.
   * Delegates to the DAL batch method, which makes one DB query across all sentences.
   *
   * @param entries - Objects with optional `exampleSentences` field
   * @param language - Language filter (default: 'zh')
   */
  async enrichExampleSentencesMetadataBatch<T extends {
    exampleSentences?: Array<{ chinese: string; english: string; [key: string]: any }> | null;
  }>(entries: T[], language: string = 'zh'): Promise<T[]> {
    return this.dictionaryDAL.enrichExampleSentencesMetadataBatch(entries, language);
  }

  /**
   * Enrich entries with per-character metadata for `expansion`.
   *
   * @param entries - Objects with optional `expansion` field
   * @param language - Language filter (default: 'zh')
   */
  async enrichExpansionMetadataBatch<T extends {
    expansion?: string | null;
  }>(entries: T[], language: string = 'zh'): Promise<T[]> {
    return this.dictionaryDAL.enrichExpansionMetadataBatch(entries, language);
  }

  async enrichEntriesWithSynonymMetadata(entries: VocabEntry[]): Promise<VocabEntry[]> {
    // Collect all unique synonym words across all entries
    const allSynonyms = new Set<string>();
    for (const entry of entries) {
      if (entry.synonyms?.length) {
        for (const syn of entry.synonyms) {
          allSynonyms.add(syn);
        }
      }
    }

    if (allSynonyms.size === 0) return entries;

    // Single batch query for all synonym metadata
    // Use 'zh' as default since synonyms are currently only for Chinese
    const metadata = await this.buildSynonymMetadata([...allSynonyms], 'zh');

    // Attach metadata to each entry that has synonyms
    return entries.map(entry => {
      if (!entry.synonyms?.length) return entry;

      const entryMetadata: Record<string, { definition: string; pronunciation: string }> = {};
      for (const syn of entry.synonyms) {
        if (metadata[syn]) {
          entryMetadata[syn] = metadata[syn];
        }
      }

      return {
        ...entry,
        synonymsMetadata: Object.keys(entryMetadata).length > 0 ? entryMetadata : null,
      };
    });
  }

}
