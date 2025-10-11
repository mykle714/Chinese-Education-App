/**
 * Vocabulary API utilities for token-based lookups and cache integration
 * Handles communication with the backend API for vocabulary operations
 */

import type { VocabEntry } from '../types';
import { API_BASE_URL } from '../constants';
import { getCachedEntries, cacheEntries } from './vocabCache';

/**
 * Fetches vocabulary entries by tokens with cache integration
 * @param tokens Array of tokens to look up
 * @param token JWT authentication token
 * @returns Promise resolving to vocabulary entries
 */
export async function fetchVocabEntriesByTokens(
  tokens: string[],
  token: string
): Promise<VocabEntry[]> {
  if (!tokens || tokens.length === 0) {
    console.log('[VOCAB-CLIENT] 📝 No tokens provided for vocabulary lookup');
    return [];
  }

  console.log(`[VOCAB-CLIENT] 🔍 Starting vocab lookup for ${tokens.length} tokens:`, {
    totalTokens: tokens.length,
    sampleTokens: tokens.slice(0, 10), // Show first 10 tokens as sample
    allTokens: tokens.length <= 20 ? tokens : `${tokens.slice(0, 20).join(', ')}... (+${tokens.length - 20} more)`
  });

  // Check cache first
  const { foundEntries, missingTokens } = getCachedEntries(tokens);
  
  console.log(`[VOCAB-CLIENT] 🎯 Cache analysis:`, {
    totalRequested: tokens.length,
    cacheHits: tokens.length - missingTokens.length,
    cacheMisses: missingTokens.length,
    cacheHitRate: `${((tokens.length - missingTokens.length) / tokens.length * 100).toFixed(1)}%`,
    cachedEntries: foundEntries.length,
    missingTokens: missingTokens.length <= 10 ? missingTokens : `${missingTokens.slice(0, 10).join(', ')}... (+${missingTokens.length - 10} more)`
  });
  
  // If all tokens are cached, return cached results
  if (missingTokens.length === 0) {
    console.log(`[VOCAB-CLIENT] ✅ Complete cache hit: All ${tokens.length} tokens found in cache, returning ${foundEntries.length} entries`);
    return foundEntries;
  }

  console.log(`[VOCAB-CLIENT] 🌐 Preparing API request for ${missingTokens.length} missing tokens:`, {
    tokensToFetch: missingTokens.length <= 15 ? missingTokens : `${missingTokens.slice(0, 15).join(', ')}... (+${missingTokens.length - 15} more)`,
    requestSize: `${JSON.stringify({ tokens: missingTokens }).length} bytes`
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
      body: JSON.stringify({ tokens: missingTokens }),
    });

    const requestTime = performance.now() - requestStart;

    if (!response.ok) {
      const errorData = await response.json().catch(() => ({}));
      console.error(`[VOCAB-CLIENT] ❌ API request failed:`, {
        status: response.status,
        statusText: response.statusText,
        error: errorData.error,
        requestTime: `${requestTime.toFixed(2)}ms`,
        tokensRequested: missingTokens.length
      });
      throw new Error(errorData.error || `HTTP ${response.status}: ${response.statusText}`);
    }

    const newEntries: VocabEntry[] = await response.json();
    
    console.log(`[VOCAB-CLIENT] 📥 API response received:`, {
      requestTime: `${requestTime.toFixed(2)}ms`,
      tokensRequested: missingTokens.length,
      entriesReceived: newEntries.length,
      matchRate: `${(newEntries.length / missingTokens.length * 100).toFixed(1)}%`,
      entriesFound: newEntries.map(e => e.entryKey).slice(0, 10) // Show first 10 found entries
    });

    // Cache ALL requested tokens (including those with no entries - negative caching)
    const tokenEntries: { [token: string]: VocabEntry[] } = {};
    
    // Group entries by their matching tokens, including empty arrays for tokens with no matches
    missingTokens.forEach(token => {
      const matchingEntries = newEntries.filter(entry => entry.entryKey === token);
      tokenEntries[token] = matchingEntries; // Cache empty array if no matches (negative caching)
    });

    // Cache all tokens (both with and without entries)
    cacheEntries(tokenEntries);
    
    // Log negative caching statistics
    const tokensWithEntries = Object.values(tokenEntries).filter(entries => entries.length > 0).length;
    const tokensWithoutEntries = missingTokens.length - tokensWithEntries;
    
    if (tokensWithoutEntries > 0) {
      console.log(`[VOCAB-CLIENT] 🚫 Negative caching applied:`, {
        tokensWithEntries,
        tokensWithoutEntries,
        negativeCacheRate: `${(tokensWithoutEntries / missingTokens.length * 100).toFixed(1)}%`,
        sampleEmptyTokens: missingTokens.filter(token => tokenEntries[token].length === 0).slice(0, 5)
      });
    }

    // Combine cached and new entries
    const allEntries = [...foundEntries, ...newEntries];
    
    // Remove duplicates based on entry ID
    const uniqueEntries = allEntries.filter((entry, index, self) => 
      index === self.findIndex(e => e.id === entry.id)
    );

    return uniqueEntries;
  } catch (error) {
    console.error('Error fetching vocabulary entries by tokens:', error);
    
    // Return cached entries even if API call fails
    if (foundEntries.length > 0) {
      console.log(`⚠️ API failed, returning ${foundEntries.length} cached entries`);
      return foundEntries;
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
