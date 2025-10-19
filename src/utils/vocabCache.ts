/**
 * Vocabulary cache management system with CRUD synchronization
 * Provides persistent caching of vocabulary entries with real-time updates
 */

import type { VocabEntry, DictionaryEntry } from '../types.js';

export interface VocabCacheEntry {
  entries: VocabEntry[];
  lastAccessed: Date;
}

export interface VocabCacheStorage {
  [token: string]: VocabCacheEntry;
}

export interface VocabCacheMetadata {
  lastUpdated: Date;
  version: string;
  entryCount: number;
  totalTokens: number;
}

export interface VocabCache {
  data: VocabCacheStorage;
  metadata: VocabCacheMetadata;
}

// Cache invalidation reasons
export const CacheInvalidationReason = {
  BULK_IMPORT: 'bulk_import',
  USER_CHANGE: 'user_change',
  STORAGE_LIMIT: 'storage_limit',
  CORRUPTION: 'corruption',
  MANUAL: 'manual',
  VERSION_MISMATCH: 'version_mismatch',
  STALE_DATA: 'stale_data'
} as const;

export type CacheInvalidationReason = typeof CacheInvalidationReason[keyof typeof CacheInvalidationReason];

const VOCAB_CACHE_KEY = 'cow_vocab_cache';
const DICT_CACHE_KEY = 'cow_dict_cache';
const CACHE_VERSION = '1.0.0';
const MAX_CACHE_SIZE_MB = 10; // Maximum cache size in MB
const STALE_CACHE_DAYS = 7; // Cache considered stale after 7 days

/**
 * Gets the current vocabulary cache from localStorage
 * @returns VocabCache object or null if not found/invalid
 */
function getVocabCache(): VocabCache | null {
  try {
    const cacheData = localStorage.getItem(VOCAB_CACHE_KEY);
    if (!cacheData) return null;

    const cache: VocabCache = JSON.parse(cacheData);
    
    // Validate cache structure and version
    if (!cache.metadata || cache.metadata.version !== CACHE_VERSION) {
      console.log('Cache version mismatch, invalidating cache');
      invalidateCache(CacheInvalidationReason.VERSION_MISMATCH);
      return null;
    }

    // Convert date strings back to Date objects
    cache.metadata.lastUpdated = new Date(cache.metadata.lastUpdated);
    Object.values(cache.data).forEach(entry => {
      entry.lastAccessed = new Date(entry.lastAccessed);
    });

    return cache;
  } catch (error) {
    console.error('Error reading vocabulary cache:', error);
    invalidateCache(CacheInvalidationReason.CORRUPTION);
    return null;
  }
}

/**
 * Saves the vocabulary cache to localStorage
 * @param cache VocabCache object to save
 */
function saveVocabCache(cache: VocabCache): void {
  try {
    // Check cache size before saving
    const cacheString = JSON.stringify(cache);
    const cacheSizeMB = new Blob([cacheString]).size / (1024 * 1024);
    
    if (cacheSizeMB > MAX_CACHE_SIZE_MB) {
      console.warn(`Cache size (${cacheSizeMB.toFixed(2)}MB) exceeds limit, cleaning up`);
      cleanupCache();
      return;
    }

    localStorage.setItem(VOCAB_CACHE_KEY, cacheString);
  } catch (error) {
    console.error('Error saving vocabulary cache:', error);
    if (error instanceof DOMException && error.code === 22) {
      // Storage quota exceeded
      invalidateCache(CacheInvalidationReason.STORAGE_LIMIT);
    }
  }
}

/**
 * Gets cached vocabulary entries for specific tokens
 * @param tokens Array of tokens to look up
 * @returns Object with found entries and missing tokens
 */
export function getCachedEntries(tokens: string[]): {
  foundEntries: VocabEntry[];
  missingTokens: string[];
} {
  const cache = getVocabCache();
  if (!cache) {
    return { foundEntries: [], missingTokens: tokens };
  }

  const foundEntries: VocabEntry[] = [];
  const missingTokens: string[] = [];
  const now = new Date();
  
  // Track cache hit statistics for logging
  let positiveCacheHits = 0; // Tokens with vocabulary entries
  let negativeCacheHits = 0; // Tokens cached with no entries (negative cache)
  let cacheMisses = 0; // Tokens not in cache at all

  tokens.forEach(token => {
    const cacheEntry = cache.data[token];
    if (cacheEntry) {
      // Update last accessed time
      cacheEntry.lastAccessed = now;
      foundEntries.push(...cacheEntry.entries);
      
      // Track cache hit type
      if (cacheEntry.entries.length > 0) {
        positiveCacheHits++;
      } else {
        negativeCacheHits++;
      }
    } else {
      missingTokens.push(token);
      cacheMisses++;
    }
  });

  // Save updated access times if we accessed any cached entries
  if (positiveCacheHits > 0 || negativeCacheHits > 0) {
    saveVocabCache(cache);
  }

  // Log detailed cache statistics if there are any cache hits
  if (positiveCacheHits > 0 || negativeCacheHits > 0) {
    console.log(`[VOCAB-CACHE] 📊 Cache hit breakdown:`, {
      totalTokens: tokens.length,
      positiveCacheHits, // Tokens with entries
      negativeCacheHits, // Tokens with no entries (negative cache)
      cacheMisses,
      entriesReturned: foundEntries.length,
      cacheEfficiency: `${((positiveCacheHits + negativeCacheHits) / tokens.length * 100).toFixed(1)}%`
    });
  }

  return { foundEntries, missingTokens };
}

/**
 * Caches vocabulary entries for specific tokens
 * @param tokenEntries Object mapping tokens to their vocabulary entries
 */
export function cacheEntries(tokenEntries: { [token: string]: VocabEntry[] }): void {
  let cache = getVocabCache();
  
  if (!cache) {
    // Initialize new cache
    cache = {
      data: {},
      metadata: {
        lastUpdated: new Date(),
        version: CACHE_VERSION,
        entryCount: 0,
        totalTokens: 0
      }
    };
  }

  const now = new Date();
  let newEntryCount = 0;

  Object.entries(tokenEntries).forEach(([token, entries]) => {
    cache!.data[token] = {
      entries,
      lastAccessed: now
    };
    newEntryCount += entries.length;
  });

  // Update metadata
  cache.metadata.lastUpdated = now;
  cache.metadata.entryCount += newEntryCount;
  cache.metadata.totalTokens = Object.keys(cache.data).length;

  saveVocabCache(cache);
}

/**
 * Updates a cached vocabulary entry across all tokens
 * @param updatedEntry The updated vocabulary entry
 */
export function updateCachedEntry(updatedEntry: VocabEntry): void {
  const cache = getVocabCache();
  if (!cache) return;

  let updated = false;

  // Find and update the entry in all token caches
  Object.values(cache.data).forEach(cacheEntry => {
    const entryIndex = cacheEntry.entries.findIndex(entry => entry.id === updatedEntry.id);
    if (entryIndex !== -1) {
      cacheEntry.entries[entryIndex] = updatedEntry;
      updated = true;
    }
  });

  if (updated) {
    cache.metadata.lastUpdated = new Date();
    saveVocabCache(cache);
  }
}

/**
 * Removes a vocabulary entry from all token caches
 * @param entryId ID of the entry to remove
 */
export function removeCachedEntry(entryId: number): void {
  const cache = getVocabCache();
  if (!cache) return;

  let removed = false;
  let removedCount = 0;

  // Remove the entry from all token caches
  Object.keys(cache.data).forEach(token => {
    const originalLength = cache.data[token].entries.length;
    cache.data[token].entries = cache.data[token].entries.filter(entry => entry.id !== entryId);
    const newLength = cache.data[token].entries.length;
    
    if (newLength < originalLength) {
      removed = true;
      removedCount += (originalLength - newLength);
    }

    // Remove token cache if it becomes empty
    if (cache.data[token].entries.length === 0) {
      delete cache.data[token];
    }
  });

  if (removed) {
    cache.metadata.lastUpdated = new Date();
    cache.metadata.entryCount -= removedCount;
    cache.metadata.totalTokens = Object.keys(cache.data).length;
    saveVocabCache(cache);
  }
}

/**
 * Adds a new vocabulary entry to relevant token caches
 * @param newEntry The new vocabulary entry to add
 */
export function addCachedEntry(newEntry: VocabEntry): void {
  const cache = getVocabCache();
  if (!cache) return;

  // Find tokens that match the new entry's key
  const entryKey = newEntry.entryKey;
  const relevantTokens: string[] = [];

  // Check all cached tokens to see if they match or are contained in the new entry
  Object.keys(cache.data).forEach(token => {
    if (entryKey.includes(token) || token.includes(entryKey)) {
      relevantTokens.push(token);
    }
  });

  if (relevantTokens.length > 0) {
    relevantTokens.forEach(token => {
      // Check if entry already exists in this token cache
      const existingIndex = cache.data[token].entries.findIndex(entry => entry.id === newEntry.id);
      if (existingIndex === -1) {
        cache.data[token].entries.push(newEntry);
      }
    });

    cache.metadata.lastUpdated = new Date();
    cache.metadata.entryCount += relevantTokens.length;
    saveVocabCache(cache);
  }
}

/**
 * Invalidates the entire vocabulary cache
 * @param reason Reason for cache invalidation
 */
export function invalidateCache(reason: CacheInvalidationReason): void {
  try {
    localStorage.removeItem(VOCAB_CACHE_KEY);
    console.log(`Vocabulary cache invalidated: ${reason}`);
  } catch (error) {
    console.error('Error invalidating vocabulary cache:', error);
  }
}

/**
 * Checks if cache should be invalidated based on various conditions
 * @returns CacheInvalidationReason if cache should be invalidated, null otherwise
 */
export function shouldInvalidateCache(): CacheInvalidationReason | null {
  const cache = getVocabCache();
  if (!cache) return null;

  // Check for stale data
  const daysSinceUpdate = (Date.now() - cache.metadata.lastUpdated.getTime()) / (1000 * 60 * 60 * 24);
  if (daysSinceUpdate > STALE_CACHE_DAYS) {
    return CacheInvalidationReason.STALE_DATA;
  }

  // Check cache size
  try {
    const cacheString = JSON.stringify(cache);
    const cacheSizeMB = new Blob([cacheString]).size / (1024 * 1024);
    if (cacheSizeMB > MAX_CACHE_SIZE_MB) {
      return CacheInvalidationReason.STORAGE_LIMIT;
    }
  } catch (error) {
    return CacheInvalidationReason.CORRUPTION;
  }

  return null;
}

/**
 * Cleans up the cache by removing least recently accessed entries
 */
export function cleanupCache(): void {
  const cache = getVocabCache();
  if (!cache) return;

  // Sort tokens by last accessed time (oldest first)
  const sortedTokens = Object.entries(cache.data)
    .sort(([, a], [, b]) => a.lastAccessed.getTime() - b.lastAccessed.getTime());

  // Remove oldest 25% of tokens
  const tokensToRemove = Math.floor(sortedTokens.length * 0.25);
  
  for (let i = 0; i < tokensToRemove; i++) {
    const [token] = sortedTokens[i];
    delete cache.data[token];
  }

  // Update metadata
  cache.metadata.lastUpdated = new Date();
  cache.metadata.totalTokens = Object.keys(cache.data).length;
  cache.metadata.entryCount = Object.values(cache.data)
    .reduce((sum, entry) => sum + entry.entries.length, 0);

  saveVocabCache(cache);
  console.log(`Cache cleanup completed, removed ${tokensToRemove} token caches`);
}

/**
 * Gets cache statistics for monitoring and debugging
 * @returns Object with cache statistics
 */
export function getCacheStats(): {
  totalTokens: number;
  totalEntries: number;
  cacheSizeMB: number;
  lastUpdated: Date | null;
  oldestAccess: Date | null;
  newestAccess: Date | null;
} {
  const cache = getVocabCache();
  if (!cache) {
    return {
      totalTokens: 0,
      totalEntries: 0,
      cacheSizeMB: 0,
      lastUpdated: null,
      oldestAccess: null,
      newestAccess: null
    };
  }

  const cacheString = JSON.stringify(cache);
  const cacheSizeMB = new Blob([cacheString]).size / (1024 * 1024);
  
  const accessTimes = Object.values(cache.data).map(entry => entry.lastAccessed);
  const oldestAccess = accessTimes.length > 0 ? new Date(Math.min(...accessTimes.map(d => d.getTime()))) : null;
  const newestAccess = accessTimes.length > 0 ? new Date(Math.max(...accessTimes.map(d => d.getTime()))) : null;

  return {
    totalTokens: cache.metadata.totalTokens,
    totalEntries: cache.metadata.entryCount,
    cacheSizeMB: Number(cacheSizeMB.toFixed(2)),
    lastUpdated: cache.metadata.lastUpdated,
    oldestAccess,
    newestAccess
  };
}

/**
 * Validates cache consistency and repairs if necessary
 * @returns Object with validation results
 */
export function validateAndRepairCache(): {
  isValid: boolean;
  errors: string[];
  repaired: boolean;
} {
  const cache = getVocabCache();
  if (!cache) {
    return { isValid: false, errors: ['Cache not found'], repaired: false };
  }

  const errors: string[] = [];
  let repaired = false;

  // Validate metadata
  if (!cache.metadata) {
    errors.push('Missing cache metadata');
    return { isValid: false, errors, repaired: false };
  }

  // Validate entry counts
  const actualEntryCount = Object.values(cache.data)
    .reduce((sum, entry) => sum + entry.entries.length, 0);
  
  if (cache.metadata.entryCount !== actualEntryCount) {
    errors.push(`Entry count mismatch: expected ${cache.metadata.entryCount}, found ${actualEntryCount}`);
    cache.metadata.entryCount = actualEntryCount;
    repaired = true;
  }

  // Validate token count
  const actualTokenCount = Object.keys(cache.data).length;
  if (cache.metadata.totalTokens !== actualTokenCount) {
    errors.push(`Token count mismatch: expected ${cache.metadata.totalTokens}, found ${actualTokenCount}`);
    cache.metadata.totalTokens = actualTokenCount;
    repaired = true;
  }

  // Save repaired cache if needed
  if (repaired) {
    saveVocabCache(cache);
  }

  return {
    isValid: errors.length === 0,
    errors,
    repaired
  };
}

// ========================================
// DICTIONARY CACHE FUNCTIONS
// ========================================

export interface DictionaryCacheEntry {
  entries: DictionaryEntry[];
  lastAccessed: Date;
}

export interface DictionaryCacheStorage {
  [token: string]: DictionaryCacheEntry;
}

export interface DictionaryCache {
  data: DictionaryCacheStorage;
  metadata: VocabCacheMetadata;
}

/**
 * Gets the dictionary cache from localStorage
 */
function getDictionaryCache(): DictionaryCache | null {
  try {
    const cacheData = localStorage.getItem(DICT_CACHE_KEY);
    if (!cacheData) return null;

    const cache: DictionaryCache = JSON.parse(cacheData);
    
    if (!cache.metadata || cache.metadata.version !== CACHE_VERSION) {
      console.log('[DICT-CACHE] Version mismatch, invalidating');
      invalidateDictionaryCache(CacheInvalidationReason.VERSION_MISMATCH);
      return null;
    }

    cache.metadata.lastUpdated = new Date(cache.metadata.lastUpdated);
    Object.values(cache.data).forEach(entry => {
      entry.lastAccessed = new Date(entry.lastAccessed);
    });

    return cache;
  } catch (error) {
    console.error('[DICT-CACHE] Error reading cache:', error);
    invalidateDictionaryCache(CacheInvalidationReason.CORRUPTION);
    return null;
  }
}

/**
 * Saves the dictionary cache to localStorage
 */
function saveDictionaryCache(cache: DictionaryCache): void {
  try {
    const cacheString = JSON.stringify(cache);
    const cacheSizeMB = new Blob([cacheString]).size / (1024 * 1024);
    
    if (cacheSizeMB > MAX_CACHE_SIZE_MB) {
      console.warn(`[DICT-CACHE] Size (${cacheSizeMB.toFixed(2)}MB) exceeds limit, cleaning up`);
      cleanupDictionaryCache();
      return;
    }

    localStorage.setItem(DICT_CACHE_KEY, cacheString);
  } catch (error) {
    console.error('[DICT-CACHE] Error saving:', error);
    if (error instanceof DOMException && error.code === 22) {
      invalidateDictionaryCache(CacheInvalidationReason.STORAGE_LIMIT);
    }
  }
}

/**
 * Gets cached dictionary entries for specific tokens
 */
export function getCachedDictionaryEntries(tokens: string[]): {
  foundEntries: DictionaryEntry[];
  missingTokens: string[];
} {
  const cache = getDictionaryCache();
  if (!cache) {
    return { foundEntries: [], missingTokens: tokens };
  }

  const foundEntries: DictionaryEntry[] = [];
  const missingTokens: string[] = [];
  const now = new Date();
  
  let cacheHits = 0;

  tokens.forEach(token => {
    const cacheEntry = cache.data[token];
    if (cacheEntry) {
      cacheEntry.lastAccessed = now;
      foundEntries.push(...cacheEntry.entries);
      cacheHits++;
    } else {
      missingTokens.push(token);
    }
  });

  if (cacheHits > 0) {
    saveDictionaryCache(cache);
    console.log(`[DICT-CACHE] 📖 ${cacheHits}/${tokens.length} tokens cached (${(cacheHits/tokens.length*100).toFixed(1)}%)`);
  }

  return { foundEntries, missingTokens };
}

/**
 * Caches dictionary entries for specific tokens
 */
export function cacheDictionaryEntries(tokenEntries: { [token: string]: DictionaryEntry[] }): void {
  let cache = getDictionaryCache();
  
  if (!cache) {
    cache = {
      data: {},
      metadata: {
        lastUpdated: new Date(),
        version: CACHE_VERSION,
        entryCount: 0,
        totalTokens: 0
      }
    };
  }

  const now = new Date();
  let newEntryCount = 0;

  Object.entries(tokenEntries).forEach(([token, entries]) => {
    cache!.data[token] = {
      entries,
      lastAccessed: now
    };
    newEntryCount += entries.length;
  });

  cache.metadata.lastUpdated = now;
  cache.metadata.entryCount += newEntryCount;
  cache.metadata.totalTokens = Object.keys(cache.data).length;

  saveDictionaryCache(cache);
  console.log(`[DICT-CACHE] 💾 Cached ${newEntryCount} entries for ${Object.keys(tokenEntries).length} tokens`);
}

/**
 * Invalidates the dictionary cache
 */
export function invalidateDictionaryCache(reason: CacheInvalidationReason): void {
  try {
    localStorage.removeItem(DICT_CACHE_KEY);
    console.log(`[DICT-CACHE] Invalidated: ${reason}`);
  } catch (error) {
    console.error('[DICT-CACHE] Error invalidating:', error);
  }
}

/**
 * Cleans up dictionary cache by removing LRU entries
 */
function cleanupDictionaryCache(): void {
  const cache = getDictionaryCache();
  if (!cache) return;

  const sortedTokens = Object.entries(cache.data)
    .sort(([, a], [, b]) => a.lastAccessed.getTime() - b.lastAccessed.getTime());

  const tokensToRemove = Math.floor(sortedTokens.length * 0.25);
  
  for (let i = 0; i < tokensToRemove; i++) {
    delete cache.data[sortedTokens[i][0]];
  }

  cache.metadata.lastUpdated = new Date();
  cache.metadata.totalTokens = Object.keys(cache.data).length;
  cache.metadata.entryCount = Object.values(cache.data)
    .reduce((sum, entry) => sum + entry.entries.length, 0);

  saveDictionaryCache(cache);
  console.log(`[DICT-CACHE] Cleanup: removed ${tokensToRemove} token caches`);
}
