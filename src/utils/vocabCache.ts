/**
 * Vocabulary and dictionary cache management.
 *
 * Both caches share the same shape:
 *   { data: { [token]: { entries: T[], lastAccessed: Date } }, metadata: CacheMetadata }
 *
 * The shared logic (localStorage read/write, LRU eviction, size limits) lives in
 * LocalStorageCacheManager<T>. Vocab-specific mutations (add/update/remove a single
 * entry across all token buckets) are implemented on top using the manager's public API.
 */

import type { VocabEntry, DictionaryEntry } from '../types.js';

// ─── Shared Types ────────────────────────────────────────────────────────────

export interface CacheEntry<T> {
  entries: T[];
  lastAccessed: Date;
}

export interface CacheStorage<T> {
  [token: string]: CacheEntry<T>;
}

export interface CacheMetadata {
  lastUpdated: Date;
  version: string;
  entryCount: number;
  totalTokens: number;
}

export interface CacheShape<T> {
  data: CacheStorage<T>;
  metadata: CacheMetadata;
}

// Legacy type aliases kept for external consumers
export type VocabCacheEntry = CacheEntry<VocabEntry>;
export type VocabCacheStorage = CacheStorage<VocabEntry>;
export type VocabCacheMetadata = CacheMetadata;
export type VocabCache = CacheShape<VocabEntry>;
export type DictionaryCacheEntry = CacheEntry<DictionaryEntry>;
export type DictionaryCacheStorage = CacheStorage<DictionaryEntry>;
export type DictionaryCache = CacheShape<DictionaryEntry>;

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

// ─── Generic Cache Manager ────────────────────────────────────────────────────

const CACHE_VERSION = '1.0.0';
const MAX_CACHE_SIZE_MB = 10;
const STALE_CACHE_DAYS = 7;

/**
 * Generic localStorage cache for token → entry[] mappings.
 * Handles read/write, LRU eviction, size enforcement, and version gating.
 * Instantiate once per data type (vocab, dictionary) with a unique storage key.
 */
class LocalStorageCacheManager<T> {
  private readonly key: string;
  private readonly logPrefix: string;

  constructor(options: { key: string; logPrefix: string }) {
    this.key = options.key;
    this.logPrefix = options.logPrefix;
  }

  // ── Private persistence helpers ──────────────────────────────────────────

  /** Read raw cache from localStorage. Returns null on miss, version mismatch, or parse error. */
  get(): CacheShape<T> | null {
    try {
      const raw = localStorage.getItem(this.key);
      if (!raw) return null;

      const cache: CacheShape<T> = JSON.parse(raw);

      if (!cache.metadata || cache.metadata.version !== CACHE_VERSION) {
        console.log(`${this.logPrefix} Version mismatch, invalidating`);
        this.invalidate(CacheInvalidationReason.VERSION_MISMATCH);
        return null;
      }

      // Revive Date strings back to Date objects (JSON.parse gives strings)
      cache.metadata.lastUpdated = new Date(cache.metadata.lastUpdated);
      Object.values(cache.data).forEach(entry => {
        entry.lastAccessed = new Date(entry.lastAccessed);
      });

      return cache;
    } catch {
      console.error(`${this.logPrefix} Error reading cache, invalidating`);
      this.invalidate(CacheInvalidationReason.CORRUPTION);
      return null;
    }
  }

  /** Write cache to localStorage, enforcing the size limit. */
  save(cache: CacheShape<T>): void {
    try {
      const json = JSON.stringify(cache);
      const sizeMB = new Blob([json]).size / (1024 * 1024);

      if (sizeMB > MAX_CACHE_SIZE_MB) {
        // Evict LRU entries before trying again
        console.warn(`${this.logPrefix} Size (${sizeMB.toFixed(2)}MB) exceeds limit, running cleanup`);
        this.cleanup();
        return;
      }

      localStorage.setItem(this.key, json);
    } catch (error) {
      console.error(`${this.logPrefix} Error saving cache:`, error);
      if (error instanceof DOMException && error.code === 22) {
        // QuotaExceededError — storage is full
        this.invalidate(CacheInvalidationReason.STORAGE_LIMIT);
      }
    }
  }

  // ── Public API ───────────────────────────────────────────────────────────

  /**
   * Look up a set of tokens in the cache.
   * Updates lastAccessed timestamps for hits and persists them.
   */
  getCachedEntries(tokens: string[]): { foundEntries: T[]; missingTokens: string[] } {
    const cache = this.get();
    if (!cache) return { foundEntries: [], missingTokens: tokens };

    const foundEntries: T[] = [];
    const missingTokens: string[] = [];
    const now = new Date();
    let hits = 0;

    tokens.forEach(token => {
      const entry = cache.data[token];
      if (entry) {
        entry.lastAccessed = now;
        foundEntries.push(...entry.entries);
        hits++;
      } else {
        missingTokens.push(token);
      }
    });

    if (hits > 0) {
      this.save(cache);
      console.log(`${this.logPrefix} ${hits}/${tokens.length} tokens cached (${(hits / tokens.length * 100).toFixed(1)}%)`);
    }

    return { foundEntries, missingTokens };
  }

  /**
   * Write a batch of token → entries[] pairs into the cache.
   */
  cacheEntries(tokenEntries: { [token: string]: T[] }): void {
    const cache = this.get() ?? this.createEmpty();

    const now = new Date();
    let newCount = 0;

    Object.entries(tokenEntries).forEach(([token, entries]) => {
      cache.data[token] = { entries, lastAccessed: now };
      newCount += entries.length;
    });

    cache.metadata.lastUpdated = now;
    cache.metadata.entryCount += newCount;
    cache.metadata.totalTokens = Object.keys(cache.data).length;

    this.save(cache);
    console.log(`${this.logPrefix} Cached ${newCount} entries for ${Object.keys(tokenEntries).length} tokens`);
  }

  /**
   * Remove all entries from localStorage.
   */
  invalidate(reason: CacheInvalidationReason): void {
    try {
      localStorage.removeItem(this.key);
      console.log(`${this.logPrefix} Invalidated: ${reason}`);
    } catch (error) {
      console.error(`${this.logPrefix} Error invalidating:`, error);
    }
  }

  /**
   * Check staleness and size conditions; return the reason to invalidate, or null.
   */
  shouldInvalidate(): CacheInvalidationReason | null {
    const cache = this.get();
    if (!cache) return null;

    const daysSince = (Date.now() - cache.metadata.lastUpdated.getTime()) / (1000 * 60 * 60 * 24);
    if (daysSince > STALE_CACHE_DAYS) return CacheInvalidationReason.STALE_DATA;

    try {
      const sizeMB = new Blob([JSON.stringify(cache)]).size / (1024 * 1024);
      if (sizeMB > MAX_CACHE_SIZE_MB) return CacheInvalidationReason.STORAGE_LIMIT;
    } catch {
      return CacheInvalidationReason.CORRUPTION;
    }

    return null;
  }

  /**
   * LRU eviction: remove the oldest 25% of token buckets to reclaim space.
   */
  cleanup(): void {
    const cache = this.get();
    if (!cache) return;

    // Sort token buckets oldest-first by lastAccessed
    const sorted = Object.entries(cache.data)
      .sort(([, a], [, b]) => a.lastAccessed.getTime() - b.lastAccessed.getTime());

    const toRemove = Math.floor(sorted.length * 0.25);
    for (let i = 0; i < toRemove; i++) {
      delete cache.data[sorted[i][0]];
    }

    cache.metadata.lastUpdated = new Date();
    cache.metadata.totalTokens = Object.keys(cache.data).length;
    cache.metadata.entryCount = Object.values(cache.data)
      .reduce((sum, e) => sum + e.entries.length, 0);

    this.save(cache);
    console.log(`${this.logPrefix} Cleanup: removed ${toRemove} token buckets`);
  }

  // ── Helpers ──────────────────────────────────────────────────────────────

  private createEmpty(): CacheShape<T> {
    return {
      data: {},
      metadata: {
        lastUpdated: new Date(),
        version: CACHE_VERSION,
        entryCount: 0,
        totalTokens: 0
      }
    };
  }
}

// ─── Cache Instances ──────────────────────────────────────────────────────────

const vocabManager = new LocalStorageCacheManager<VocabEntry>({
  key: 'cow_vocab_cache',
  logPrefix: '[VOCAB-CACHE]'
});

const dictManager = new LocalStorageCacheManager<DictionaryEntry>({
  key: 'cow_dict_cache',
  logPrefix: '[DICT-CACHE]'
});

// ─── Vocab Cache Public API ───────────────────────────────────────────────────

export function getCachedEntries(tokens: string[]) {
  return vocabManager.getCachedEntries(tokens);
}

export function cacheEntries(tokenEntries: { [token: string]: VocabEntry[] }) {
  vocabManager.cacheEntries(tokenEntries);
}

export function invalidateCache(reason: CacheInvalidationReason) {
  vocabManager.invalidate(reason);
}

export function shouldInvalidateCache(): CacheInvalidationReason | null {
  return vocabManager.shouldInvalidate();
}

export function cleanupCache() {
  vocabManager.cleanup();
}

/**
 * Update a single VocabEntry across every token bucket that contains it.
 * Called when the user edits a card's content.
 */
export function updateCachedEntry(updatedEntry: VocabEntry): void {
  const cache = vocabManager.get();
  if (!cache) return;

  let updated = false;
  Object.values(cache.data).forEach(bucket => {
    const idx = bucket.entries.findIndex(e => e.id === updatedEntry.id);
    if (idx !== -1) {
      bucket.entries[idx] = updatedEntry;
      updated = true;
    }
  });

  if (updated) {
    cache.metadata.lastUpdated = new Date();
    vocabManager.save(cache);
  }
}

/**
 * Remove a VocabEntry by ID from every token bucket that contains it.
 * Called when the user deletes a card.
 */
export function removeCachedEntry(entryId: number): void {
  const cache = vocabManager.get();
  if (!cache) return;

  let removed = false;
  let removedCount = 0;

  Object.keys(cache.data).forEach(token => {
    const before = cache.data[token].entries.length;
    cache.data[token].entries = cache.data[token].entries.filter(e => e.id !== entryId);
    const delta = before - cache.data[token].entries.length;

    if (delta > 0) {
      removed = true;
      removedCount += delta;
    }

    // Drop the token bucket entirely if it's now empty
    if (cache.data[token].entries.length === 0) {
      delete cache.data[token];
    }
  });

  if (removed) {
    cache.metadata.lastUpdated = new Date();
    cache.metadata.entryCount -= removedCount;
    cache.metadata.totalTokens = Object.keys(cache.data).length;
    vocabManager.save(cache);
  }
}

/**
 * Add a new VocabEntry to any token buckets whose key overlaps with the entry's key.
 * Called when the user saves a new card so the reader immediately sees it without a refetch.
 */
export function addCachedEntry(newEntry: VocabEntry): void {
  const cache = vocabManager.get();
  if (!cache) return;

  const entryKey = newEntry.entryKey;

  // A token bucket is relevant if either the token is a substring of the entry key or vice-versa
  const relevantTokens = Object.keys(cache.data).filter(
    token => entryKey.includes(token) || token.includes(entryKey)
  );

  if (relevantTokens.length === 0) return;

  relevantTokens.forEach(token => {
    const bucket = cache.data[token];
    const alreadyPresent = bucket.entries.some(e => e.id === newEntry.id);
    if (!alreadyPresent) {
      bucket.entries.push(newEntry);
    }
  });

  cache.metadata.lastUpdated = new Date();
  cache.metadata.entryCount += relevantTokens.length;
  vocabManager.save(cache);
}

/**
 * Get size and staleness stats for monitoring/debugging the vocab cache.
 */
export function getCacheStats(): {
  totalTokens: number;
  totalEntries: number;
  cacheSizeMB: number;
  lastUpdated: Date | null;
  oldestAccess: Date | null;
  newestAccess: Date | null;
} {
  const cache = vocabManager.get();
  if (!cache) {
    return { totalTokens: 0, totalEntries: 0, cacheSizeMB: 0, lastUpdated: null, oldestAccess: null, newestAccess: null };
  }

  const cacheSizeMB = Number((new Blob([JSON.stringify(cache)]).size / (1024 * 1024)).toFixed(2));
  const accessTimes = Object.values(cache.data).map(e => e.lastAccessed);
  const oldestAccess = accessTimes.length > 0 ? new Date(Math.min(...accessTimes.map(d => d.getTime()))) : null;
  const newestAccess = accessTimes.length > 0 ? new Date(Math.max(...accessTimes.map(d => d.getTime()))) : null;

  return {
    totalTokens: cache.metadata.totalTokens,
    totalEntries: cache.metadata.entryCount,
    cacheSizeMB,
    lastUpdated: cache.metadata.lastUpdated,
    oldestAccess,
    newestAccess
  };
}

/**
 * Validate metadata counts against actual data and repair if mismatched.
 * Useful for diagnosing cache consistency issues in development.
 */
export function validateAndRepairCache(): { isValid: boolean; errors: string[]; repaired: boolean } {
  const cache = vocabManager.get();
  if (!cache) return { isValid: false, errors: ['Cache not found'], repaired: false };

  const errors: string[] = [];
  let repaired = false;

  const actualEntryCount = Object.values(cache.data).reduce((sum, e) => sum + e.entries.length, 0);
  if (cache.metadata.entryCount !== actualEntryCount) {
    errors.push(`Entry count mismatch: expected ${cache.metadata.entryCount}, found ${actualEntryCount}`);
    cache.metadata.entryCount = actualEntryCount;
    repaired = true;
  }

  const actualTokenCount = Object.keys(cache.data).length;
  if (cache.metadata.totalTokens !== actualTokenCount) {
    errors.push(`Token count mismatch: expected ${cache.metadata.totalTokens}, found ${actualTokenCount}`);
    cache.metadata.totalTokens = actualTokenCount;
    repaired = true;
  }

  if (repaired) vocabManager.save(cache);

  return { isValid: errors.length === 0, errors, repaired };
}

// ─── Dictionary Cache Public API ──────────────────────────────────────────────

export function getCachedDictionaryEntries(tokens: string[]) {
  return dictManager.getCachedEntries(tokens);
}

export function cacheDictionaryEntries(tokenEntries: { [token: string]: DictionaryEntry[] }) {
  dictManager.cacheEntries(tokenEntries);
}

export function invalidateDictionaryCache(reason: CacheInvalidationReason) {
  dictManager.invalidate(reason);
}
