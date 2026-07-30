/**
 * Vocabulary API utilities for token-based lookups and cache integration
 * Handles communication with the backend API for vocabulary operations
 */

import type { VocabEntry, VocabLookupResponse, DictionaryEntry } from '../types';
import { getCachedEntries, cacheEntries, getCachedDictionaryEntries, cacheDictionaryEntries } from './vocabCache';
import { apiDelete, apiPatch, apiPost, apiPut } from '../api/http';
import { vocabLog } from './vocabDebug';

/**
 * Fetches vocabulary entries by tokens with cache integration
 *   the LIVE token at call time via `authHeader()`, which keeps the caller's
 *   callback identity stable across silent token refreshes (see authHeader.ts and
 *   CLAUDE.md "Never reload on token refresh").
 * @returns Promise resolving to both personal and dictionary entries
 */
export async function fetchVocabEntriesByTokens(tokens: string[]): Promise<VocabLookupResponse> {
  if (!tokens || tokens.length === 0) {
    vocabLog('📝 No tokens provided for vocabulary lookup');
    return { personalEntries: [], dictionaryEntries: [] };
  }

  vocabLog(`🔍 Starting vocab lookup for ${tokens.length} tokens:`, {
    totalTokens: tokens.length,
    sampleTokens: tokens.slice(0, 10), // Show first 10 tokens as sample
    allTokens: tokens.length <= 20 ? tokens : `${tokens.slice(0, 20).join(', ')}... (+${tokens.length - 20} more)`
  });

  // Check both personal and dictionary caches
  const { foundEntries: cachedPersonalEntries, missingTokens: personalMissingTokens } = getCachedEntries(tokens);
  const { foundEntries: cachedDictEntries, missingTokens: dictMissingTokens } = getCachedDictionaryEntries(tokens);
  
  vocabLog(`🎯 Cache analysis:`, {
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
    vocabLog(`✅ Complete cache hit: All ${tokens.length} tokens found in both caches`);
    return {
      personalEntries: cachedPersonalEntries,
      dictionaryEntries: cachedDictEntries
    };
  }

  vocabLog(`🌐 Preparing API request for ${tokensNeedingFetch.length} missing tokens:`, {
    tokensToFetch: tokensNeedingFetch.length <= 15 ? tokensNeedingFetch : `${tokensNeedingFetch.slice(0, 15).join(', ')}... (+${tokensNeedingFetch.length - 15} more)`,
    requestSize: `${JSON.stringify({ tokens: tokensNeedingFetch }).length} bytes`,
    missingFromPersonalCache: personalMissingTokens.length,
    missingFromDictionaryCache: dictMissingTokens.length
  });

  try {
    const requestStart = performance.now();
    
    // Fetch missing tokens from API. apiPost supplies the base URL, credentials and
    // the live Authorization header, and throws ApiError (carrying the server's error
    // body) on a non-2xx — so the hand-rolled envelope and !ok branch are gone.
    let responseData: VocabLookupResponse;
    try {
      responseData = await apiPost<VocabLookupResponse>('/api/vocabEntries/byTokens', {
        tokens: tokensNeedingFetch,
      });
    } catch (err) {
      console.error(`[VOCAB-CLIENT] ❌ API request failed:`, {
        error: err instanceof Error ? err.message : err,
        requestTime: `${(performance.now() - requestStart).toFixed(2)}ms`,
        tokensRequested: tokensNeedingFetch.length,
      });
      throw err;
    }

    const requestTime = performance.now() - requestStart;
    
    vocabLog(`📥 API response received:`, {
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
    vocabLog(`💾 Caching complete:`, {
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
 * @returns Promise resolving to created entry
 */
export async function createVocabEntry(
  entryData: { entryKey: string; difficulty?: string },
): Promise<VocabEntry> {
  try {
    const newEntry = await apiPost<VocabEntry>('/api/vocabEntries', entryData);
    
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
 * @returns Promise resolving to updated entry
 */
export async function updateVocabEntry(
  entryId: number,
  entryData: { entryKey: string; difficulty?: string },
): Promise<VocabEntry> {
  try {
    const updatedEntry = await apiPut<VocabEntry>(`/api/vocabEntries/${entryId}`, entryData);
    
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
 * @returns Promise resolving to success status
 */
export async function deleteVocabEntry(entryId: number): Promise<boolean> {
  try {
    await apiDelete(`/api/vocabEntries/${entryId}`);

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
 * @returns Promise resolving to import results
 */
export interface ImportCsvResult {
  message: string;
  results: {
    total: number;
    imported: number;
    updated: number;
    skipped: number;
    errors: unknown[];
  };
}

export async function importVocabFromCSV(file: File): Promise<ImportCsvResult> {
  try {
    const formData = new FormData();
    formData.append('file', file);

    // FormData passes through src/api/http.ts untouched so the browser sets its own
    // multipart boundary.
    const result = await apiPost<ImportCsvResult>('/api/vocabEntries/import', formData);
    
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
 * Persist (or clear) the learner's chosen definition-cluster sense for one vet row
 * (migration 99). `selectedSense` is the cluster's `sense` LABEL — stable across
 * re-clustering, unlike a positional index; pass `null` to clear back to the default/starred
 * sense. Only meaningful for a real vet row (a user's saved card); the read-only dictionary
 * cdp uses a det-fallback entry with no user context and never calls this. See
 * docs/DEFINITION_CLUSTERS.md.
 *
 * @returns the row's persisted `selectedSense` after the write (echoed by the server).
 */
export async function saveSelectedSense(
  entryId: number,
  selectedSense: string | null,
): Promise<{ id: number; selectedSense: string | null }> {
  return apiPatch<{ id: number; selectedSense: string | null }>(
    `/api/vocabEntries/${entryId}/selectedSense`,
    { selectedSense },
  );
}

/**
 * Estimates the number of API calls needed for a given set of tokens
 * Useful for performance monitoring and user feedback
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

/**
 * Add a discoverable word to the user's "Learn Now" bucket.
 *
 * NOTE ON NAMING: the endpoint, the returned status, and this function keep the
 * internal `library` name because they are backend contracts; only the user-facing
 * copy says "Learn Now" (CLAUDE.md § Terminology: "Learn Now" cards).
 *
 * Takes no `token` — apiPost supplies the header at call time, so callers can omit
 * `token` from their dependency arrays (CLAUDE.md ⛔ "Never reload on token refresh").
 * Extracted from the two call sites that had hand-rolled the same POST: the flp
 * entry panel and the dictionary cdp.
 */
export async function addToLibrary(
  entryKey: string,
  // Optional to match VocabEntry.language, which is optional. When undefined the key
  // is omitted from the body and the server falls back to the user's selected
  // language — the same behaviour the two hand-rolled call sites had.
  language: string | undefined
): Promise<{ status: 'added' | 'already-in-library' }> {
  return apiPost<{ status: 'added' | 'already-in-library' }>(
    '/api/vocabEntries/addToLibrary',
    { entryKey, language }
  );
}
