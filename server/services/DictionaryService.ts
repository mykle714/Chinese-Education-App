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
   * Get total count of dictionary entries
   */
  async getTotalCount(): Promise<number> {
    return await this.dictionaryDAL.getTotalCount();
  }

}
