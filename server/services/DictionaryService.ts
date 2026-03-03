import Anthropic from '@anthropic-ai/sdk';
import { IDictionaryDAL } from '../dal/interfaces/IDictionaryDAL.js';
import { DictionaryEntry } from '../types/index.js';
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
    
    return await this.dictionaryDAL.findByWord1(trimmedTerm, language);
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
    
    const totalTime = performance.now() - startTime;
    console.log(`[DICTIONARY-SERVICE] ✅ Lookup complete:`, {
      language: language,
      termsQueried: uniqueTerms.length,
      entriesFound: entries.length,
      matchRate: `${(entries.length / uniqueTerms.length * 100).toFixed(1)}%`,
      totalTime: `${totalTime.toFixed(2)}ms`
    });

    return entries;
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
    
    return await this.dictionaryDAL.searchByWord1(trimmedTerm, language, limit, offset);
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
- Examples:
  * 不知不觉 → 不知道不觉得 (added 道 and 得)
  * 违规 → 违反规矩 (added 反 and 矩)
  * 早晚 → 早上晚上 (added 上 twice)
- If the word cannot be meaningfully expanded while preserving all characters, return null

Word: ${trimmedWord}

Respond with ONLY a JSON object in this exact format:
{"expansion": "expanded form"} or {"expansion": null}`;

      const response = await anthropic.messages.create({
        model: 'claude-haiku-4-5-20251001',
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
   * Generate a short definition from an array of definition strings
   * Deterministic — no AI required
   * Returns the shortest meaningful token after filtering grammatical notes
   */
  generateShortDefinition(definitions: string[]): string | null {
    if (!definitions || definitions.length === 0) {
      return null;
    }

    const candidates: string[] = [];

    for (const def of definitions) {
      // Skip definitions that are purely grammatical notes
      const trimmed = def.trim();
      if (trimmed.startsWith('(') || trimmed.startsWith('CL:')) {
        continue;
      }

      // Split by "; " to get individual senses
      const senses = trimmed.split('; ');

      for (const sense of senses) {
        // Strip trailing parenthetical content
        const stripped = sense.replace(/ \([^)]+\)$/, '').trim();
        if (stripped.length > 0) {
          candidates.push(stripped);
        }
      }
    }

    // Fall back to unfiltered tokens if all definitions were filtered out
    if (candidates.length === 0) {
      for (const def of definitions) {
        const senses = def.trim().split('; ');
        for (const sense of senses) {
          const stripped = sense.replace(/ \([^)]+\)$/, '').trim();
          if (stripped.length > 0) {
            candidates.push(stripped);
          }
        }
      }
    }

    if (candidates.length === 0) {
      return null;
    }

    // Return the token with the fewest characters
    return candidates.reduce((shortest, current) =>
      current.length < shortest.length ? current : shortest
    );
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
Short definition: ${shortDef}
Existing definitions: ${definitions.join(' | ')}

Write a single English definition that is between 25 and 75 characters long.
It should elaborate on the short definition with key context.
Respond with only the definition text — no quotes, no extra text.`;

      const response = await anthropic.messages.create({
        model: 'claude-haiku-4-5-20251001',
        max_tokens: 128,
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

}
