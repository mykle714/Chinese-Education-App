import Anthropic from '@anthropic-ai/sdk';
import { IDictionaryDAL } from '../dal/interfaces/IDictionaryDAL.js';
import { DictionaryEntry, VocabEntry } from '../types/index.js';
import { ValidationError } from '../types/dal.js';

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
   * Generate an expanded form of a Chinese word using AI
   * Each morpheme is expanded by inserting additional characters while preserving all originals in order
   * Returns null if the word cannot be meaningfully expanded or if AI call fails
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

      const prompt = `You are a Chinese language expert. Expand the following Chinese word by inserting additional characters to make it more explicit.

Rules:
- Every character from the original word must appear in the expansion, in their original order
- You may ONLY add characters between or after the originals — never replace or omit any original character
- The expansion must preserve the same meaning as the original word
- The expansion must be a natural phrase that a native Mandarin speaker would actually say
- Examples:
  * 不知不觉 → 不知道不觉得 (added 道 and 得)
  * 违规 → 违反规矩 (added 反 and 矩)
  * 早晚 → 早上晚上 (added 上 twice)
- If the word cannot be meaningfully expanded while preserving all characters, return null

Word: ${trimmedWord}

Respond with ONLY a JSON object in this exact format:
{"expansion": "expanded form"} or {"expansion": null}`;

      const response = await anthropic.messages.create({
        model: 'claude-sonnet-4-6',
        max_tokens: 256,
        temperature: 0.7,
        messages: [{ role: 'user', content: prompt }]
      });

      const content = (response.content[0] as { type: string; text: string }).text.trim();
      const jsonText = content.replace(/^```(?:json)?\s*/i, '').replace(/\s*```\s*$/, '').trim();
      const parsed = JSON.parse(jsonText);

      return parsed.expansion || null;
    } catch (error: any) {
      console.error(`Failed to generate expansion for "${word}":`, error.message);
      return null;
    }
  }

  /**
   * Generate a long definition (25–75 chars) for a Chinese word using Claude Haiku AI
   * Returns null for non-Chinese words or if AI call fails
   */
  async generateLongDefinition(word: string, language: string, shortDef: string, definitions: string[]): Promise<string | null> {
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
