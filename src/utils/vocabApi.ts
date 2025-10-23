/**
 * Vocabulary API utilities for token-based lookups and cache integration
 * Handles communication with the backend API for vocabulary operations
 */

import type { VocabEntry, VocabLookupResponse, DictionaryEntry } from '../types';
import { API_BASE_URL } from '../constants';
import { getCachedEntries, cacheEntries, getCachedDictionaryEntries, cacheDictionaryEntries } from './vocabCache';

/**
 * Fetches vocabulary entries by tokens with cache integration
 * @param tokens Array of tokens to look up
 * @param token JWT authentication token
 * @returns Promise resolving to both personal and dictionary entries
 */
export async function fetchVocabEntriesByTokens(
  tokens: string[],
  token: string
): Promise<VocabLookupResponse> {
  if (!tokens || tokens.length === 0) {
    console.log('[VOCAB-CLIENT] 📝 No tokens provided for vocabulary lookup');
    return { personalEntries: [], dictionaryEntries: [] };
  }

  console.log(`[VOCAB-CLIENT] 🔍 Starting vocab lookup for ${tokens.length} tokens:`, {
    totalTokens: tokens.length,
    sampleTokens: tokens.slice(0, 10), // Show first 10 tokens as sample
    allTokens: tokens.length <= 20 ? tokens : `${tokens.slice(0, 20).join(', ')}... (+${tokens.length - 20} more)`
  });

  // Check both personal and dictionary caches
  const { foundEntries: cachedPersonalEntries, missingTokens: personalMissingTokens } = getCachedEntries(tokens);
  const { foundEntries: cachedDictEntries, missingTokens: dictMissingTokens } = getCachedDictionaryEntries(tokens);
  
  console.log(`[VOCAB-CLIENT] 🎯 Cache analysis:`, {
    totalRequested: tokens.length,
    personalCacheHits: tokens.length - personalMissingTokens.length,
    dictionaryCacheHits: tokens.length - dictMissingTokens.length,
    personalHitRate: `${((tokens.length - personalMissingTokens.length) / tokens.length * 100).toFixed(1)}%`,
    dictionaryHitRate: `${((tokens.length - dictMissingTokens.length) / tokens.length * 100).toFixed(1)}%`,
    cachedPersonalEntries: cachedPersonalEntries.length,
    cachedDictionaryEntries: cachedDictEntries.length
  });
  
  // Determine which tokens need API fetch (union of missing tokens from both caches)
  const tokensNeedingFetch = Array.from(new Set([...personalMissingTokens, ...dictMissingTokens]));
  
  // If all tokens are cached in both caches, return immediately
  if (tokensNeedingFetch.length === 0) {
    console.log(`[VOCAB-CLIENT] ✅ Complete cache hit: All ${tokens.length} tokens found in both caches`);
    return {
      personalEntries: cachedPersonalEntries,
      dictionaryEntries: cachedDictEntries
    };
  }

  console.log(`[VOCAB-CLIENT] 🌐 Preparing API request for ${tokensNeedingFetch.length} missing tokens:`, {
    tokensToFetch: tokensNeedingFetch.length <= 15 ? tokensNeedingFetch : `${tokensNeedingFetch.slice(0, 15).join(', ')}... (+${tokensNeedingFetch.length - 15} more)`,
    requestSize: `${JSON.stringify({ tokens: tokensNeedingFetch }).length} bytes`,
    missingFromPersonalCache: personalMissingTokens.length,
    missingFromDictionaryCache: dictMissingTokens.length
  });

  try {
    const requestStart = performance.now();
    
    // Fetch missing tokens from API
    const response = await fetch(`${API_BASE_URL}/api/vocabEntries/by-tokens`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${token}`,
      },
      credentials: 'include',
      body: JSON.stringify({ tokens: tokensNeedingFetch }),
    });

    const requestTime = performance.now() - requestStart;

    if (!response.ok) {
      const errorData = await response.json().catch(() => ({}));
      console.error(`[VOCAB-CLIENT] ❌ API request failed:`, {
        status: response.status,
        statusText: response.statusText,
        error: errorData.error,
        requestTime: `${requestTime.toFixed(2)}ms`,
        tokensRequested: tokensNeedingFetch.length
      });
      throw new Error(errorData.error || `HTTP ${response.status}: ${response.statusText}`);
    }

    const responseData: VocabLookupResponse = await response.json();
    
    console.log(`[VOCAB-CLIENT] 📥 API response received:`, {
      requestTime: `${requestTime.toFixed(2)}ms`,
      tokensRequested: tokensNeedingFetch.length,
      personalEntriesReceived: responseData.personalEntries.length,
      dictionaryEntriesReceived: responseData.dictionaryEntries.length,
      personalMatchRate: `${(responseData.personalEntries.length / tokensNeedingFetch.length * 100).toFixed(1)}%`,
      dictionaryMatchRate: `${(responseData.dictionaryEntries.length / tokensNeedingFetch.length * 100).toFixed(1)}%`
    });

    // Cache personal entries
    const personalTokenEntries: { [token: string]: VocabEntry[] } = {};
    personalMissingTokens.forEach(token => {
      const matchingEntries = responseData.personalEntries.filter(entry => entry.entryKey === token);
      personalTokenEntries[token] = matchingEntries;
    });
    cacheEntries(personalTokenEntries);
    
    // Cache dictionary entries
    const dictTokenEntries: { [token: string]: DictionaryEntry[] } = {};
    dictMissingTokens.forEach(token => {
      const matchingEntries = responseData.dictionaryEntries.filter(entry => 
        entry.word1 === token || entry.word2 === token
      );
      dictTokenEntries[token] = matchingEntries;
    });
    cacheDictionaryEntries(dictTokenEntries);
    
    // Log caching statistics
    console.log(`[VOCAB-CLIENT] 💾 Caching complete:`, {
      personalTokensCached: Object.keys(personalTokenEntries).length,
      personalEntriesCached: Object.values(personalTokenEntries).reduce((sum, entries) => sum + entries.length, 0),
      dictionaryTokensCached: Object.keys(dictTokenEntries).length,
      dictionaryEntriesCached: Object.values(dictTokenEntries).reduce((sum, entries) => sum + entries.length, 0)
    });

    // Combine cached and new entries
    const allPersonalEntries = [...cachedPersonalEntries, ...responseData.personalEntries];
    const allDictionaryEntries = [...cachedDictEntries, ...responseData.dictionaryEntries];
    
    // Remove duplicates
    const uniquePersonalEntries = allPersonalEntries.filter((entry, index, self) => 
      index === self.findIndex(e => e.id === entry.id)
    );
    const uniqueDictionaryEntries = allDictionaryEntries.filter((entry, index, self) => 
      index === self.findIndex(e => e.id === entry.id)
    );

    return {
      personalEntries: uniquePersonalEntries,
      dictionaryEntries: uniqueDictionaryEntries
    };
  } catch (error) {
    console.error('Error fetching vocabulary entries by tokens:', error);
    
    // Return cached entries even if API call fails
    if (cachedPersonalEntries.length > 0 || cachedDictEntries.length > 0) {
      console.log(`⚠️ API failed, returning cached: ${cachedPersonalEntries.length} personal, ${cachedDictEntries.length} dictionary`);
      return {
        personalEntries: cachedPersonalEntries,
        dictionaryEntries: cachedDictEntries
      };
    }
    
    throw error;
  }
}

/**
 * Creates a new vocabulary entry and updates cache
 * @param entryData Entry data to create
 * @param token JWT authentication token
 * @returns Promise resolving to created entry
 */
export async function createVocabEntry(
  entryData: { entryKey: string; entryValue: string; hskLevelTag?: string },
  token: string
): Promise<VocabEntry> {
  try {
    const response = await fetch(`${API_BASE_URL}/api/vocabEntries`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${token}`,
      },
      credentials: 'include',
      body: JSON.stringify(entryData),
    });

    if (!response.ok) {
      const errorData = await response.json().catch(() => ({}));
      throw new Error(errorData.error || `HTTP ${response.status}: ${response.statusText}`);
    }

    const newEntry: VocabEntry = await response.json();
    
    // Update cache with new entry
    const { addCachedEntry } = await import('./vocabCache');
    addCachedEntry(newEntry);
    
    return newEntry;
  } catch (error) {
    console.error('Error creating vocabulary entry:', error);
    throw error;
  }
}

/**
 * Updates a vocabulary entry and updates cache
 * @param entryId ID of entry to update
 * @param entryData Updated entry data
 * @param token JWT authentication token
 * @returns Promise resolving to updated entry
 */
export async function updateVocabEntry(
  entryId: number,
  entryData: { entryKey: string; entryValue: string; hskLevelTag?: string },
  token: string
): Promise<VocabEntry> {
  try {
    const response = await fetch(`${API_BASE_URL}/api/vocabEntries/${entryId}`, {
      method: 'PUT',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${token}`,
      },
      credentials: 'include',
      body: JSON.stringify(entryData),
    });

    if (!response.ok) {
      const errorData = await response.json().catch(() => ({}));
      throw new Error(errorData.error || `HTTP ${response.status}: ${response.statusText}`);
    }

    const updatedEntry: VocabEntry = await response.json();
    
    // Update cache with modified entry
    const { updateCachedEntry } = await import('./vocabCache');
    updateCachedEntry(updatedEntry);
    
    return updatedEntry;
  } catch (error) {
    console.error('Error updating vocabulary entry:', error);
    throw error;
  }
}

/**
 * Deletes a vocabulary entry and removes from cache
 * @param entryId ID of entry to delete
 * @param token JWT authentication token
 * @returns Promise resolving to success status
 */
export async function deleteVocabEntry(entryId: number, token: string): Promise<boolean> {
  try {
    const response = await fetch(`${API_BASE_URL}/api/vocabEntries/${entryId}`, {
      method: 'DELETE',
      headers: {
        'Authorization': `Bearer ${token}`,
      },
      credentials: 'include',
    });

    if (!response.ok) {
      const errorData = await response.json().catch(() => ({}));
      throw new Error(errorData.error || `HTTP ${response.status}: ${response.statusText}`);
    }

    // Remove from cache
    const { removeCachedEntry } = await import('./vocabCache');
    removeCachedEntry(entryId);
    
    return true;
  } catch (error) {
    console.error('Error deleting vocabulary entry:', error);
    throw error;
  }
}

/**
 * Handles bulk import operations and invalidates cache
 * @param file CSV file to import
 * @param token JWT authentication token
 * @returns Promise resolving to import results
 */
export async function importVocabFromCSV(
  file: File,
  token: string
): Promise<{
  message: string;
  results: {
    total: number;
    imported: number;
    updated: number;
    skipped: number;
    errors: any[];
  };
}> {
  try {
    const formData = new FormData();
    formData.append('file', file);

    const response = await fetch(`${API_BASE_URL}/api/vocabEntries/import`, {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${token}`,
      },
      credentials: 'include',
      body: formData,
    });

    if (!response.ok) {
      const errorData = await response.json().catch(() => ({}));
      throw new Error(errorData.error || `HTTP ${response.status}: ${response.statusText}`);
    }

    const result = await response.json();
    
    // Invalidate cache after bulk import
    const { invalidateCache, CacheInvalidationReason } = await import('./vocabCache');
    invalidateCache(CacheInvalidationReason.BULK_IMPORT);
    
    return result;
  } catch (error) {
    console.error('Error importing vocabulary from CSV:', error);
    throw error;
  }
}

/**
 * Estimates the number of API calls needed for a given set of tokens
 * Useful for performance monitoring and user feedback
 * @param tokens Array of tokens to analyze
 * @returns Estimation object with cache hit/miss information
 */
export function estimateApiCalls(tokens: string[]): {
  totalTokens: number;
  cachedTokens: number;
  apiCallsNeeded: number;
  cacheHitRate: number;
} {
  if (!tokens || tokens.length === 0) {
    return {
      totalTokens: 0,
      cachedTokens: 0,
      apiCallsNeeded: 0,
      cacheHitRate: 0
    };
  }

  const { missingTokens } = getCachedEntries(tokens);
  const cachedTokens = tokens.length - missingTokens.length;
  
  return {
    totalTokens: tokens.length,
    cachedTokens,
    apiCallsNeeded: missingTokens.length > 0 ? 1 : 0, // Single API call for all missing tokens
    cacheHitRate: tokens.length > 0 ? (cachedTokens / tokens.length) * 100 : 0
  };
}
