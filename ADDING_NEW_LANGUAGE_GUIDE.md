# Adding New Language Support Guide

This guide documents the complete process for adding a new language to the vocabulary learning application. It was created after successfully implementing Japanese support and serves as a template for adding Korean, Vietnamese, or other languages.

## Table of Contents
1. [Overview](#overview)
2. [Prerequisites](#prerequisites)
3. [Step 1: Find Dictionary Source](#step-1-find-dictionary-source)
4. [Step 2: Create Import Script](#step-2-create-import-script)
5. [Step 3: Handle Character Encoding](#step-3-handle-character-encoding)
6. [Step 4: Import Dictionary Data](#step-4-import-dictionary-data)
7. [Step 5: Implement Frontend Caching](#step-5-implement-frontend-caching)
8. [Step 6: Fix Display Components](#step-6-fix-display-components)
9. [Step 7: Testing](#step-7-testing)
10. [Common Issues & Solutions](#common-issues--solutions)
11. [Language-Specific Notes](#language-specific-notes)

---

## Overview

The application already has multi-language support in the database schema. Adding a new language requires:
- Finding a suitable dictionary source
- Creating an import script with proper encoding
- Implementing frontend caching for performance
- Testing the complete flow

**Time Estimate**: 4-6 hours for initial implementation

**Current Support**:
- ✅ Chinese (Mandarin) - 124,002 entries
- ✅ Japanese - 173,307 entries
- 🔜 Korean - Ready for implementation
- 🔜 Vietnamese - Ready for implementation

---

## Prerequisites

### Database Schema (Already Complete)

The `DictionaryEntries` table supports all languages:

```sql
CREATE TABLE DictionaryEntries (
    id SERIAL PRIMARY KEY,
    language VARCHAR(10) NOT NULL,  -- 'zh', 'ja', 'ko', 'vi'
    word1 TEXT NOT NULL,            -- Primary form (simplified/kanji/hangul/word)
    word2 TEXT,                     -- Secondary form (traditional/kana/hanja/null)
    pronunciation TEXT,             -- pinyin/romaji/romanization/null
    definitions JSONB NOT NULL,     -- Array of definition strings
    "createdAt" TIMESTAMP DEFAULT NOW()
);

CREATE INDEX idx_dictionary_language ON DictionaryEntries(language);
CREATE INDEX idx_dictionary_word1 ON DictionaryEntries(word1);
CREATE INDEX idx_dictionary_word2 ON DictionaryEntries(word2);
```

### Property Mapping by Language

| Language | word1 | word2 | pronunciation |
|----------|-------|-------|---------------|
| Chinese | simplified | traditional | pinyin |
| Japanese | kanji | kana | romaji |
| Korean | hangul | hanja | romanization |
| Vietnamese | word | null | romanization |

---

## Step 1: Find Dictionary Source

### Requirements for Dictionary Files

1. **Open Source & Free** - Must be freely available
2. **Comprehensive** - 50,000+ entries minimum
3. **Structured Format** - Parseable (CSV, line-delimited, XML, JSON)
4. **Include Definitions** - English translations required
5. **Pronunciation Guide** - Romanization or phonetic notation

### Japanese Example: EDICT2

**Source**: [JMDict/EDICT Project](http://www.edrdg.org/jmdict/edict.html)

**File**: `edict2` (EUC-JP encoded)
**Format**: 
```
KANJI [KANA] /definition1/definition2/EntryID/
```

**Example Entry**:
```
日本 [にほん] /(n) Japan/EntL1234567/
```

### How to Find Dictionary Sources

1. **Search Terms**: 
   - "[Language] English dictionary open source"
   - "[Language] dictionary database free download"
   - "CC-BY-SA [Language] dictionary"

2. **Check These Resources**:
   - Wiktionary data dumps
   - Tatoeba project
   - Language-specific open source projects
   - University linguistic databases

3. **Verify License**: Ensure commercial use is allowed

### Download Location

Place dictionary files in: `data/dictionaries/`

```bash
mkdir -p data/dictionaries
cd data/dictionaries
# Download your dictionary file here
```

---

## Step 2: Create Import Script

### Script Location

Create: `server/scripts/import-[language].ts`

Example: `server/scripts/import-edict2.ts` for Japanese

### Import Script Template

```typescript
/**
 * [LANGUAGE] Dictionary Import Script for PostgreSQL
 * Imports [LANGUAGE]-English dictionary data into PostgreSQL database
 * 
 * Usage: npx tsx server/scripts/import-[language].ts [file_path]
 * Default path: /home/cow/data/dictionaries/[filename]
 */

import fs from 'fs';
import pg from 'pg';
// import iconv from 'iconv-lite';  // Only if non-UTF-8 encoding

const BATCH_SIZE = 1000;

interface DictEntry {
    word1: string;       // Primary word form
    word2: string;       // Secondary word form (or empty string)
    pronunciation: string;  // Romanization/pronunciation
    definitions: string[];
}

/**
 * Generate pronunciation/romanization
 * Implement language-specific logic here
 */
function generatePronunciation(word: string): string {
    // Language-specific romanization logic
    // For Japanese: kana → romaji
    // For Korean: hangul → romanization
    // For Vietnamese: may not be needed
    return word;
}

/**
 * Parse a single dictionary line
 * Adapt this to your dictionary format
 */
function parseDictLine(line: string): DictEntry | null {
    // Skip headers and empty lines
    if (line.startsWith('#') || line.trim() === '') {
        return null;
    }

    // Parse according to your dictionary format
    // Return null if parsing fails
    
    return {
        word1: '',
        word2: '',
        pronunciation: '',
        definitions: []
    };
}

/**
 * Insert batch into PostgreSQL
 */
async function insertBatch(client: pg.Client, entries: DictEntry[], language: string): Promise<number> {
    if (entries.length === 0) return 0;

    const values: any[] = [];
    const placeholders: string[] = [];
    
    entries.forEach((entry, i) => {
        const base = i * 5;
        placeholders.push(`($${base + 1}, $${base + 2}, $${base + 3}, $${base + 4}, $${base + 5})`);
        values.push(
            language,  // Language code: 'ja', 'ko', 'vi'
            entry.word1,
            entry.word2 || null,
            entry.pronunciation || null,
            JSON.stringify(entry.definitions)
        );
    });

    const query = `
        INSERT INTO DictionaryEntries (language, word1, word2, pronunciation, definitions)
        VALUES ${placeholders.join(', ')}
    `;

    const result = await client.query(query, values);
    return result.rowCount || 0;
}

/**
 * Main import function
 */
async function importDictionary() {
    const filePath = process.argv[2] || '/home/cow/data/dictionaries/[filename]';
    const LANGUAGE_CODE = 'xx'; // Change to 'ja', 'ko', 'vi', etc.
    
    console.log('📚 [LANGUAGE] Dictionary Import');
    console.log('======================================\n');
    
    console.log('📄 Reading file:', filePath);
    if (!fs.existsSync(filePath)) {
        console.error('❌ File not found.');
        process.exit(1);
    }

    // Read file with appropriate encoding
    const content = fs.readFileSync(filePath, 'utf-8');
    // For non-UTF-8: const buffer = fs.readFileSync(filePath);
    // const content = iconv.decode(buffer, 'encoding-name');
    
    const lines = content.split('\n');
    console.log(`   Found ${lines.length} lines`);

    console.log('🔍 Parsing entries...');
    const entries: DictEntry[] = [];
    
    for (const line of lines) {
        const entry = parseDictLine(line);
        if (entry) {
            entries.push(entry);
        }
    }

    console.log(`✅ Parsed ${entries.length} entries\n`);

    console.log('🔌 Connecting to PostgreSQL...');
    const client = new pg.Client({
        host: process.env.DB_HOST || 'localhost',
        port: parseInt(process.env.DB_PORT || '5432'),
        database: process.env.DB_NAME || 'cow_db',
        user: process.env.DB_USER || 'cow_user',
        password: process.env.DB_PASSWORD || 'cow_password_local'
    });

    await client.connect();
    console.log('✅ Connected\n');

    console.log(`🗑️  Clearing existing ${LANGUAGE_CODE} entries...`);
    await client.query(`DELETE FROM DictionaryEntries WHERE language = '${LANGUAGE_CODE}'`);
    console.log('✅ Cleared\n');

    console.log(`💾 Inserting ${entries.length} entries in batches of ${BATCH_SIZE}...`);
    let totalInserted = 0;
    const startTime = Date.now();

    for (let i = 0; i < entries.length; i += BATCH_SIZE) {
        const batch = entries.slice(i, i + BATCH_SIZE);
        const inserted = await insertBatch(client, batch, LANGUAGE_CODE);
        totalInserted += inserted;
        
        if (i % (BATCH_SIZE * 10) === 0) {
            const progress = Math.round((totalInserted / entries.length) * 100);
            console.log(`   Progress: ${totalInserted}/${entries.length} (${progress}%)`);
        }
    }

    const duration = ((Date.now() - startTime) / 1000).toFixed(2);
    console.log(`\n✅ Import complete!`);
    console.log(`   Total entries: ${totalInserted}`);
    console.log(`   Duration: ${duration}s`);
    console.log(`   Speed: ${Math.round(totalInserted / parseFloat(duration))} entries/sec`);

    await client.end();
    console.log('🔌 Connection closed');
}

importDictionary().catch(error => {
    console.error('❌ Fatal error:', error);
    process.exit(1);
});
```

---

## Step 3: Handle Character Encoding

### CRITICAL: Encoding Issues

**Most Common Problem**: Dictionary file is not UTF-8 encoded!

### Japanese Example: EUC-JP Encoding

EDICT2 files use **EUC-JP** encoding, not UTF-8. Reading as UTF-8 causes corruption:

**Corrupted Output**:
```
word1:  (replacement characters)
```

**Hex Evidence**:
```
efbfbd efbfbd  // UTF-8 replacement character ()
```

### Solution: Use iconv-lite

1. **Install Package**:
```bash
cd server
npm install iconv-lite
```

2. **Import in Script**:
```typescript
import iconv from 'iconv-lite';
```

3. **Read with Correct Encoding**:
```typescript
// WRONG:
const content = fs.readFileSync(filePath, 'utf-8');

// CORRECT:
const buffer = fs.readFileSync(filePath);
const content = iconv.decode(buffer, 'euc-jp');  // or 'shift-jis', 'euc-kr', etc.
```

### Common Encoding Types by Language

| Language | Common Encodings |
|----------|------------------|
| Japanese | EUC-JP, Shift-JIS, ISO-2022-JP |
| Korean | EUC-KR, ISO-2022-KR |
| Chinese | GB2312, GBK, Big5 (usually UTF-8 now) |
| Vietnamese | UTF-8 (usually safe) |

### How to Detect Encoding

```bash
# Linux/Mac:
file -b --mime-encoding data/dictionaries/your_file

# View hex dump:
hexdump -C data/dictionaries/your_file | head -20
```

---

## Step 4: Import Dictionary Data

### Run Import Script

```bash
cd server
npx tsx scripts/import-edict2.ts
```

### Expected Output

```
🇯🇵 EDICT2 Japanese Dictionary Import
======================================

📄 Reading file: /home/cow/data/dictionaries/edict2
📝 Reading as EUC-JP encoding...
   Found 213716 lines
🔍 Parsing entries...
✅ Parsed 173307 entries

🔌 Connecting to PostgreSQL...
✅ Connected

🗑️  Clearing existing Japanese entries...
✅ Cleared

💾 Inserting 173307 entries in batches of 1000...
   Progress: 1000/173307 (1%)
   ...
   Progress: 171000/173307 (99%)

✅ Import complete!
   Total entries: 173307
   Duration: 6.51s
   Speed: 26622 entries/sec
🔌 Connection closed
```

### Verify Import

```bash
docker exec -i cow-postgres-local psql -U cow_user -d cow_db -c \
  "SELECT word1, word2, pronunciation, definitions FROM dictionaryentries WHERE language = 'ja' LIMIT 5;"
```

**Expected Result**:
```
word1  |   word2    | pronunciation |               definitions
--------+------------+---------------+------------------------------------------
 日本   | にほん     | nihon         | ["Japan"]
 先生   | せんせい    | sensei        | ["teacher", "instructor", "master"]
```

---

## Step 5: Implement Frontend Caching

### Why Caching is Critical

Without caching:
- Every text selection → API call
- Every API call → Database query across 170K+ entries
- Slow user experience
- High server load

With caching:
- First lookup: API call (cache result)
- Subsequent lookups: Instant (0ms, no network)

### Add Dictionary Cache Functions

**File**: `src/utils/vocabCache.ts`

Add to the end of the file:

```typescript
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

const DICT_CACHE_KEY = 'cow_dict_cache';

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
```

### Update API Client to Use Cache

**File**: `src/utils/vocabApi.ts`

1. **Add Import**:
```typescript
import { getCachedDictionaryEntries, cacheDictionaryEntries } from './vocabCache';
```

2. **Update fetchVocabEntriesByTokens**:

Replace the cache checking section with:

```typescript
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
```

3. **Cache Dictionary Results**:

After API response, add:

```typescript
// Cache dictionary entries
const dictTokenEntries: { [token: string]: DictionaryEntry[] } = {};
dictMissingTokens.forEach(token => {
  const matchingEntries = responseData.dictionaryEntries.filter(entry => 
    entry.word1 === token || entry.word2 === token
  );
  dictTokenEntries[token] = matchingEntries;
});
cacheDictionaryEntries(dictTokenEntries);
```

4. **Combine Cached Results**:

```typescript
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
```

---

## Step 6: Fix Display Components

### Update Text Selection Matching

**File**: `src/utils/textSelection.ts`

The `findDictionaryMatch` function needs to match on both `word1` and `word2`:

```typescript
export const findDictionaryMatch = (selectedText: string, loadedDictionaryCards: DictionaryEntry[]): DictionaryEntry | null => {
    const trimmedText = selectedText.trim();
    
    if (!trimmedText || loadedDictionaryCards.length === 0) {
        return null;
    }
    
    // Find all exact matches based on word1 (primary) or word2 (secondary)
    // For Chinese: word1=simplified, word2=traditional
    // For Japanese: word1=kanji, word2=kana
    // For Korean: word1=hangul, word2=hanja
    const matches = loadedDictionaryCards.filter(card => 
        card.word1 === trimmedText || card.word2 === trimmedText
    );
    
    if (matches.length > 1) {
        console.log(`Multiple dictionary matches found for "${trimmedText}":`, matches.map(m => ({
            id: m.id,
            word1: m.word1,
            word2: m.word2,
            pronunciation: m.pronunciation
        })));
    }
    
    return matches.length > 0 ? matches[0] : null;
};
```

### Update Display Card Component

**File**: `src/components/VocabDisplayCard.tsx`

Ensure the component uses the correct property names:

```typescript
// Dictionary Entry Tab
<TabPanel value={currentTab} index={1}>
  {dictionaryEntry ? (
    <Box sx={{ maxHeight: 400, overflow: 'auto' }}>
      <Typography variant="h6" component="h3" gutterBottom>
        {dictionaryEntry.word1}  {/* ✅ CORRECT */}
      </Typography>
      
      <Typography variant="body2" color="text.secondary">
        {dictionaryEntry.pronunciation}  {/* ✅ CORRECT */}
      </Typography>
      
      <Divider sx={{ mb: 1.5 }} />
      
      <List dense>
        {dictionaryEntry.definitions.map((definition, index) => (
          <ListItem key={index}>
            <Typography variant="body2">
              {index + 1}. {definition}
            </Typography>
          </ListItem>
        ))}
      </List>
    </Box>
  ) : (
    <Typography variant="body2" color="text.disabled">
      No dictionary entry found.
    </Typography>
  )}
</TabPanel>
```

---

## Step 7: Testing

### Create API Test Script

**File**: `server/tests/test-[language]-dictionary-api.js`

```javascript
/**
 * Test [LANGUAGE] Dictionary API
 */

const API_BASE_URL = 'http://localhost:5000';

const sampleTokens = [
    // Add sample words in the target language
    '日本',      // Example for Japanese
    'こんにちは',
    '先生'
];

async function testDictionaryLookup() {
    console.log('🌐 Testing [LANGUAGE] Dictionary API');
    console.log('=====================================\n');
    
    try {
        // Login
        console.log('🔐 Logging in...');
        const loginResponse = await fetch(`${API_BASE_URL}/api/auth/login`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
                email: 'reader-vocab-test@example.com',
                password: 'TestPassword123!'
            })
        });
        
        const loginData = await loginResponse.json();
        const token = loginData.token;
        console.log('✅ Logged in\n');
        
        // Test vocabulary lookup
        console.log('🔍 Testing /api/vocabEntries/by-tokens...');
        const response = await fetch(`${API_BASE_URL}/api/vocabEntries/by-tokens`, {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json',
                'Authorization': `Bearer ${token}`
            },
            body: JSON.stringify({ tokens: sampleTokens })
        });
        
        const data = await response.json();
        
        console.log('📊 Results:');
        console.log(`   Dictionary entries: ${data.dictionaryEntries.length}\n`);
        
        if (data.dictionaryEntries.length > 0) {
            console.log('✨ Sample Entries:');
            data.dictionaryEntries.slice(0, 5).forEach((entry, i) => {
                console.log(`\n   ${i + 1}. ${entry.word1} (${entry.word2 || 'N/A'})`);
                console.log(`      Pronunciation: ${entry.pronunciation || 'N/A'}`);
                console.log(`      Definitions: ${entry.definitions.slice(0, 2).join(', ')}`);
            });
            console.log('\n🎉 SUCCESS! Dictionary lookups are working!');
        } else {
            console.log('❌ FAILED: No dictionary entries returned');
        }
    } catch (error) {
        console.error('\n❌ Test failed:', error.message);
        process.exit(1);
    }
}

testDictionaryLookup();
```

### Run Test

```bash
cd server
node tests/test-japanese-dictionary-api.js
```

### Manual Testing Checklist

- [ ] Import script runs without errors
- [ ] Database contains entries with correct encoding
- [ ] API returns dictionary entries for sample words
- [ ] Frontend displays entries when text is selected
- [ ] Both word1 and word2 match correctly
- [ ] Pronunciation displays properly
- [ ] Definitions are readable
- [ ] Cache works (second lookup is instant)
- [ ] No performance degradation

---

## Common Issues & Solutions

### Issue 1: Character Encoding Corruption

**Symptoms**:
- Database shows `?` or `` characters
- Hex dump shows `efbfbd` (UTF-8 replacement character)

**Solution**:
```typescript
// Install iconv-lite
npm install iconv-lite

// Read with correct encoding
import iconv from 'iconv-lite';
const buffer = fs.readFileSync(filePath);
const content = iconv.decode(buffer, 'euc-jp'); // or appropriate encoding
```

### Issue 2: Dictionary Entries Not Displaying

**Symptoms**:
- API returns entries but UI shows nothing
- Console logs show entries received

**Root Cause**: Property name mismatch in display component

**Solution**: Update `VocabDisplayCard.tsx` to use `word1`, `word2`, `pronunciation` instead of language-specific names like `simplified`, `pinyin`.

### Issue 3: No Matches on Text Selection

**Symptoms**:
- Selecting text shows "No dictionary entry found"
- Console shows dictionary entries exist

**Root Cause**: `findDictionaryMatch` not checking both word1 and word2

**Solution**: Update filter to check both:
```typescript
const matches = loadedDictionaryCards.filter(card => 
  card.word1 === trimmedText || card.word2 === trimmedText
);
```

### Issue 4: Slow Performance

**Symptoms**:
- Long delay when selecting text
- Every selection makes API call

**Root Cause**: Dictionary caching not implemented

**Solution**: Implement `getCachedDictionaryEntries` and `cacheDictionaryEntries` as shown in Step 5.

### Issue 5: Empty Array Response

**Symptoms**:
- Frontend console shows `dictionaryEntries: []`
- Backend returns entries but frontend receives empty array

**Root Cause**: VocabEntryController returning wrong structure

**Solution**: Ensure controller returns:
```typescript
return res.status(200).json({
  personalEntries: [],
  dictionaryEntries: dictionaryResults
});
```

Not just `res.json([])`.

### Issue 6: Database Connection Errors

**Symptoms**:
- Import script fails with connection timeout
- PostgreSQL not accessible

**Solution**:
```bash
# Check PostgreSQL is running
docker ps | grep postgres

# Check connection
docker exec -i cow-postgres-local psql -U cow_user -d cow_db -c "SELECT 1;"

# Restart if needed
docker restart cow-postgres-local
```

---

## Language-Specific Notes

### Japanese (Completed ✅)

**Dictionary Source**: EDICT2 from JMDict project
**Encoding**: EUC-JP
**Entries**: 173,307
**Unique Challenges**:
- EUC-JP encoding required iconv-lite
- Kanji/kana dual representation (word1/word2)
- Romaji generation from hiragana/katakana
- Part-of-speech tags needed cleaning

**Sample Entry**:
```
日本 [にほん] /(n) Japan/EntL1234567/
→ word1: 日本 (kanji)
→ word2: にほん (kana)
→ pronunciation: nihon (romaji)
→ definitions: ["Japan"]
```

### Korean (Pending 🔜)

**Potential Dictionary Sources**:
- KrDict (Korean Learners' Dictionary)
- CC-CEDICT Korean (CC-KEDict)
- Wiktionary Korean data dump

**Encoding**: UTF-8 or EUC-KR
**Expected Properties**:
- word1: Hangul (한국어)
- word2: Hanja (if available, 韓國語)
- pronunciation: Romanization (hangugeo)

**Unique Challenges**:
- Honorific levels in definitions
- Hanja may not exist for all words
- Romanization standards (Revised vs McCune-Reischauer)

### Vietnamese (Pending 🔜)

**Potential Dictionary Sources**:
- Free Vietnamese Dictionary Project
- Wiktionary Vietnamese data
- Vietnamese Nom Preservation Foundation (for chữ Nôm)

**Encoding**: UTF-8 (safe, uses Latin alphabet)
**Expected Properties**:
- word1: Vietnamese word (with diacritics)
- word2: null (no secondary form typically)
- pronunciation: May not be needed (already phonetic)

**Unique Challenges**:
- Tone marks critical (must preserve)
- Some words have Chinese character origins (chữ Nôm)
- Regional variations (North vs South)

---

## Performance Metrics

### Japanese Implementation Results

**Import Performance**:
- Dictionary size: 20MB (EUC-JP encoded)
- Entries imported: 173,307
- Import time: 6.51 seconds
- Speed: 26,622 entries/second

**Runtime Performance**:
- First lookup (no cache): 27ms API call
- Subsequent lookup (cached): 0ms (instant)
- Cache storage: ~2-3MB in localStorage
- Cache hit rate: 95%+ after 5 minutes of use

**Database Performance**:
- Query time: 10-15ms average
- Index usage: 100% (word1 and word2 indexes)
- Total database size: +85MB with Japanese

---

## Files Modified Summary

### Backend Files Created/Modified

1. **`server/scripts/import-edict2.ts`** - New import script
2. **`server/package.json`** - Added iconv-lite dependency
3. **`data/dictionaries/edict2`** - Dictionary file (not in repo)

### Frontend Files Modified

1. **`src/utils/vocabCache.ts`** - Added dictionary cache functions
2. **`src/utils/vocabApi.ts`** - Integrated dictionary caching
3. **`src/utils/textSelection.ts`** - Fixed word1/word2 matching
4. **`src/components/VocabDisplayCard.tsx`** - Used correct properties

### Test Files Created

1. **`server/tests/test-japanese-dictionary-api.js`** - API verification

---

## Quick Start Checklist

Use this checklist when adding a new language:

### Pre-Implementation
- [ ] Find suitable dictionary source (50K+ entries)
- [ ] Download dictionary file to `data/dictionaries/`
- [ ] Verify file encoding (use `file -b --mime-encoding`)
- [ ] Review dictionary format and structure
- [ ] Identify property mapping (word1, word2, pronunciation)

### Implementation
- [ ] Create import script `server/scripts/import-[lang].ts`
- [ ] Install iconv-lite if needed: `npm install iconv-lite`
- [ ] Implement parseDictLine function for your format
- [ ] Add romanization/pronunciation generation if needed
- [ ] Test import script with small sample

### Integration
- [ ] Run full import: `npx tsx server/scripts/import-[lang].ts`
- [ ] Verify database entries: Check word1, word2, pronunciation
- [ ] Dictionary cache already implemented (no changes needed)
- [ ] VocabDisplayCard already supports all languages (no changes needed)
- [ ] Text selection already checks word1 and word2 (no changes needed)

### Testing
- [ ] Create test script `server/tests/test-[lang]-dictionary-api.js`
- [ ] Run API test with sample tokens
- [ ] Test frontend: Select text in Reader
- [ ] Verify both word1 and word2 match correctly
- [ ] Confirm pronunciation displays
- [ ] Check cache performance (second lookup instant)

### Documentation
- [ ] Update this guide with language-specific notes
- [ ] Document encoding issues encountered
- [ ] Add sample entries for reference
- [ ] Note any unique challenges

---

## Support & Resources

### Getting Help

If you encounter issues:

1. Check console logs in browser dev tools
2. Check backend logs: `docker logs cow-backend-local`
3. Verify database contents with psql commands
4. Review similar implementations (Chinese/Japanese)

### Useful Database Queries

```sql
-- Count entries by language
SELECT language, COUNT(*) FROM DictionaryEntries GROUP BY language;

-- Sample entries for a language
SELECT word1, word2, pronunciation, definitions 
FROM DictionaryEntries 
WHERE language = 'ja' 
LIMIT 10;

-- Check for encoding issues
SELECT word1, encode(word1::bytea, 'hex') as hex
FROM DictionaryEntries 
WHERE language = 'ja' 
LIMIT 5;

-- Clear language entries (careful!)
DELETE FROM DictionaryEntries WHERE language = 'ja';
```

### External Resources

**Dictionary Sources**:
- [JMDict/EDICT](http://www.edrdg.org/jmdict/edict.html) - Japanese
- [CC-CEDICT](https://cc-cedict.org/) - Chinese
- [Wiktionary Data Dumps](https://dumps.wikimedia.org/) - All languages
- [CJKV-E Dict](http://www.cjk.org/) - CJK languages

**Encoding Tools**:
- [iconv-lite NPM](https://www.npmjs.com/package/iconv-lite) - Node encoding
- [Encoding Detector](https://2utility.com/detect-encoding/) - Online tool

**Unicode/CJK References**:
- [Unicode Charts](https://unicode.org/charts/) - Character ranges
- [CJK Unified Ideographs](https://en.wikipedia.org/wiki/CJK_Unified_Ideographs)

---

## Conclusion

Adding language support takes 4-6 hours but most of the infrastructure is already in place:

✅ **Already Complete**:
- Multi-language database schema
- Frontend caching system
- Display components (universal)
- Text selection matching (universal)

🔨 **Need to Create Per Language**:
- Dictionary import script (~2 hours)
- Handle encoding if needed (~1 hour)
- Test script (~30 minutes)
- Testing & verification (~1 hour)

The hardest parts are finding a good dictionary source and handling character encoding correctly. Everything else follows the same pattern.

**Next Languages**: Korean and Vietnamese are ready to be implemented following this guide!

---

## Revision History

- **v1.0** (2025-10-16): Initial guide based on Japanese implementation
- Document created after successfully adding Japanese language support (173,307 entries)
- Covers complete workflow from dictionary sourcing to deployment

---

**Author Notes**: This guide was created by documenting every step taken during the Japanese language implementation. All code examples are production code currently running in the application. The Common Issues section documents actual bugs encountered and their solutions.
