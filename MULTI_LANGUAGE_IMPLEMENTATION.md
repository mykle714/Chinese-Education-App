# Multi-Language Support Implementation Guide

## Overview

This document describes the implementation of multi-language support for Japanese, Korean, and Vietnamese dictionaries in addition to the existing Chinese (Mandarin) support.

## Languages Supported

- **Chinese (zh)**: Using CC-CEDICT dictionary (~120,000 entries)
- **Japanese (ja)**: Using JMdict dictionary (~180,000 entries)
- **Korean (ko)**: Using CC-KEDICT dictionary (~50,000 entries)
- **Vietnamese (vi)**: Using Vietnamese-English dictionary (~40,000 entries)

## Architecture Changes

### 1. Database Schema

The database has been updated to support multiple languages using a unified schema:

#### DictionaryEntries Table
- **language** (VARCHAR): Language code ('zh', 'ja', 'ko', 'vi')
- **word1** (VARCHAR): Primary word form
  - Chinese: simplified characters
  - Japanese: kanji (or kana if no kanji)
  - Korean: hangul
  - Vietnamese: word
- **word2** (VARCHAR, nullable): Secondary word form
  - Chinese: traditional characters
  - Japanese: kana reading
  - Korean: hanja (Chinese characters)
  - Vietnamese: null
- **pronunciation** (VARCHAR, nullable): Pronunciation
  - Chinese: pinyin with tone marks
  - Japanese: romaji
  - Korean: romanization
  - Vietnamese: null (already Latin script)
- **definitions** (JSONB): Array of English definitions

#### Users Table
- **preferredLanguage** (VARCHAR): User's preferred study language (default: 'zh')

#### VocabEntries Table
- **language** (VARCHAR): Language of the vocabulary entry
- **script** (VARCHAR): Script type (e.g., 'simplified', 'hiragana', 'hangul')

### 2. TypeScript Types

Updated types in `server/types/index.ts`:
- Added `Language` type: `'zh' | 'ja' | 'ko' | 'vi'`
- Updated `DictionaryEntry` interface with new schema fields
- Updated `User` interface with `preferredLanguage` field
- Updated `VocabEntry` interface with `language` field

### 3. Data Access Layer

Updated `DictionaryDAL`:
- `findByWord1(word1: string, language?: string)`: Find entry by primary word
- `findMultipleByWord1(words: string[], language?: string)`: Batch lookup with language filter
- Backward compatibility methods: `findBySimplified()` and `findMultipleBySimplified()`

## Dictionary Sources

### Japanese (JMdict)
- **Source**: Electronic Dictionary Research and Development Group (EDRDG)
- **Format**: XML
- **License**: Creative Commons Attribution-ShareAlike 3.0
- **Download**: ftp://ftp.edrdg.org/pub/Nihongo/JMdict_e.gz
- **Size**: ~180,000 entries

### Korean (CC-KEDICT)
- **Source**: CC-KEDICT Project
- **Format**: Line-based (similar to CC-CEDICT)
- **License**: Creative Commons
- **Download**: https://github.com/mhagiwara/cc-kedict
- **Size**: ~50,000 entries

### Vietnamese
- **Source**: Various open-source projects
- **Format**: Various (tab-separated, @-separated, etc.)
- **License**: Open source
- **Download**: https://github.com/hieuphq/vietnamese-dictionary
- **Size**: ~40,000 entries

## Installation & Setup

### Step 1: Install Dependencies

```bash
cd /home/cow/server
npm install xml2js @types/xml2js
```

### Step 2: Run Database Migration

```bash
# Using Docker (recommended)
docker exec -i cow-postgres-local psql -U cow_user -d cow_db < database/migrations/05-add-multi-language-support.sql
```

This migration will:
- Add `preferredLanguage` column to Users table
- Add `language` column to DictionaryEntries table
- Rename columns (simplified→word1, traditional→word2, pinyin→pronunciation)
- Make word2 and pronunciation nullable
- Add indexes for efficient language filtering
- Update existing Chinese entries to language='zh'

### Step 3: Download Dictionary Files

```bash
# Make the download script executable
chmod +x server/scripts/download-dictionaries.sh

# Run the download script
bash server/scripts/download-dictionaries.sh
```

This will download:
- JMdict_e.gz (Japanese)
- cc-kedict.txt (Korean)
- viet-dict.txt (Vietnamese - may require manual download)

### Step 4: Uncompress JMdict

```bash
gunzip /home/cow/data/dictionaries/JMdict_e.gz
```

### Step 5: Import Dictionaries

Import each dictionary (can be done in any order):

```bash
# Chinese (already imported, but can re-run if needed)
node --loader ts-node/esm server/scripts/import-cedict-pg.ts

# Japanese (~5-10 minutes)
node --loader ts-node/esm server/scripts/import-jmdict.ts

# Korean (~1-2 minutes)
node --loader ts-node/esm server/scripts/import-kedict.ts

# Vietnamese (~1-2 minutes)
node --loader ts-node/esm server/scripts/import-vdict.ts
```

Each import script will:
1. Parse the dictionary file
2. Clear existing entries for that language
3. Insert entries in batches
4. Report progress and statistics

## Usage

### Setting User Language Preference

Users can set their preferred language through the settings page (to be implemented in UI):

```typescript
// API: PUT /api/users/language
{
  "preferredLanguage": "ja"  // 'zh', 'ja', 'ko', or 'vi'
}
```

### Dictionary Lookups

The dictionary lookup now supports language filtering:

```typescript
// Lookup with specific language
const entry = await dictionaryDAL.findByWord1('こんにちは', 'ja');

// Batch lookup with language filter
const entries = await dictionaryDAL.findMultipleByWord1(
  ['안녕하세요', '감사합니다'], 
  'ko'
);

// Backward compatible (Chinese only)
const chineseEntry = await dictionaryDAL.findBySimplified('你好');
```

### Vocabulary Entries

All vocabulary entries are tagged with a language:

```typescript
const vocabEntry: VocabEntryCreateData = {
  userId: 'user-id',
  entryKey: 'こんにちは',
  entryValue: 'Hello',
  language: 'ja',
  script: 'hiragana'
};
```

## Next Steps (UI Implementation)

### 1. Settings Page
- Add language selector dropdown
- Save preference to backend
- Update AuthContext with user's preferred language

### 2. Vocabulary Cards
- Display language badge on each card
- Filter cards by selected language
- Show appropriate fields based on language:
  - Chinese: simplified, traditional, pinyin
  - Japanese: kanji, kana, romaji
  - Korean: hangul, hanja, romanization
  - Vietnamese: word only

### 3. Reader Feature
- Use user's preferred language for dictionary lookups
- Display definitions in appropriate format

### 4. Add Entry Form
- Auto-detect or allow user to select language
- Show relevant fields based on language

## Testing

### Verify Migration
```sql
-- Check schema changes
\d DictionaryEntries
\d Users

-- Check existing data
SELECT language, COUNT(*) FROM DictionaryEntries GROUP BY language;
SELECT "preferredLanguage", COUNT(*) FROM Users GROUP BY "preferredLanguage";
```

### Verify Imports
```sql
-- Chinese entries
SELECT COUNT(*) FROM DictionaryEntries WHERE language = 'zh';

-- Japanese entries  
SELECT COUNT(*) FROM DictionaryEntries WHERE language = 'ja';

-- Korean entries
SELECT COUNT(*) FROM DictionaryEntries WHERE language = 'ko';

-- Vietnamese entries
SELECT COUNT(*) FROM DictionaryEntries WHERE language = 'vi';

-- Sample entries from each language
SELECT language, word1, word2, pronunciation, definitions 
FROM DictionaryEntries 
WHERE language IN ('zh', 'ja', 'ko', 'vi')
LIMIT 2 PER language;
```

### Test API Endpoints
```bash
# Test dictionary lookup (to be implemented)
curl http://localhost:3001/api/dictionary/lookup?word=こんにちは&language=ja

# Test user language preference (to be implemented)
curl -X PUT http://localhost:3001/api/users/language \
  -H "Content-Type: application/json" \
  -d '{"preferredLanguage": "ja"}'
```

## File Structure

```
/home/cow/
├── data/
│   └── dictionaries/
│       ├── JMdict_e          (uncompressed XML)
│       ├── cc-kedict.txt     (Korean dictionary)
│       └── viet-dict.txt     (Vietnamese dictionary)
├── database/
│   └── migrations/
│       └── 05-add-multi-language-support.sql
├── server/
│   ├── scripts/
│   │   ├── download-dictionaries.sh
│   │   ├── import-jmdict.ts
│   │   ├── import-kedict.ts
│   │   └── import-vdict.ts
│   ├── types/
│   │   └── index.ts          (updated types)
│   └── dal/
│       ├── interfaces/
│       │   └── IDictionaryDAL.ts
│       └── implementations/
│           └── DictionaryDAL.ts
└── MULTI_LANGUAGE_IMPLEMENTATION.md (this file)
```

## Troubleshooting

### Import Errors
- **JMdict**: Ensure the file is uncompressed (gunzip)
- **Korean**: Check the file encoding (should be UTF-8)
- **Vietnamese**: May need manual download if automatic download fails

### Database Connection
- Ensure Docker containers are running
- Check environment variables (DB_HOST, DB_PORT, etc.)
- Verify connection with: `docker exec -it cow-postgres-local psql -U cow_user -d cow_db`

### Performance
- Imports may take several minutes for large dictionaries (especially JMdict)
- Indexes are created automatically for efficient lookups
- Batch inserts (1000 entries per batch) optimize performance

## Credits

- **CC-CEDICT**: MDBG (Chinese-English Dictionary)
- **JMdict**: Electronic Dictionary Research and Development Group (EDRDG)
- **CC-KEDICT**: Masato Hagiwara
- **Vietnamese Dictionary**: Various open-source contributors
