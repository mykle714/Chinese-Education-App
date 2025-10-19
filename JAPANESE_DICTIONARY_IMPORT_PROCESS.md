# Japanese Dictionary Import Process

**Document Purpose:** Step-by-step guide for importing Japanese dictionary data into the vocabulary learning application.

**Last Updated:** October 18, 2025

---

## Dictionary Source

### EDICT2 (Japanese-English Dictionary)

- **Official Website:** http://www.edrdg.org/jmdict/edict.html
- **Project:** Electronic Dictionary Research and Development Group (EDRDG)
- **License:** Creative Commons Attribution-ShareAlike 3.0 (free for commercial and non-commercial use)
- **Format:** Custom line-based format (EUC-JP encoded)
- **Size:** ~20 MB (compressed)
- **Entries:** 173,307 Japanese-English dictionary entries
- **Encoding:** EUC-JP (requires conversion)

### Dictionary Format

The EDICT2 dictionary uses a custom line-based format:

```
KANJI [KANA] /POS definitions/EntryID/
```

**Example Entries:**
```
日本 [にほん] /(n) Japan/EntL1234567/
学校 [がっこう] /(n) school/EntL7654321/
先生 [せんせい] /(n) teacher/instructor/master/EntL9876543/
```

**Column Mapping:**
- KANJI → Kanji/Chinese characters - stored as `word1`
- KANA (in brackets) → Hiragana/Katakana reading - stored as `word2`
- Definitions (between slashes) → English definitions - stored in `definitions` array
- Romaji is generated from kana - stored as `pronunciation`
- POS tags (e.g., `(n)` for noun) are cleaned and removed

---

## Prerequisites

### Required Software
- Node.js (v16+)
- TypeScript/tsx runtime
- PostgreSQL database (running in Docker)
- **iconv-lite** npm package (for EUC-JP encoding conversion)

### Required Files
- Import script: `server/scripts/import-edict2.ts`
- Database: PostgreSQL with multi-language schema

### Required npm Package

**CRITICAL:** EDICT2 uses EUC-JP encoding, NOT UTF-8!

```bash
cd /home/cow/server
npm install iconv-lite
```

### Database Schema Requirements

The `DictionaryEntries` table must have:
```sql
language VARCHAR(10)      -- 'ja' for Japanese
word1 TEXT               -- Kanji
word2 TEXT               -- Kana (hiragana/katakana)
pronunciation TEXT       -- Romaji
definitions JSONB        -- Array of definitions
```

---

## Import Process

### Step 1: Download Dictionary File

**Official Download Link:** http://ftp.edrdg.org/pub/Nihongo/edict2.gz

**Download and Extract:**
```bash
cd /home/cow/data/dictionaries

# Download compressed file
wget http://ftp.edrdg.org/pub/Nihongo/edict2.gz

# OR using curl
curl -O http://ftp.edrdg.org/pub/Nihongo/edict2.gz

# Extract
gunzip edict2.gz

# Verify file exists
ls -lh edict2
```

**Expected Output:**
- File size: ~20 MB
- Encoding: EUC-JP (verify with: `file -b --mime-encoding edict2`)

### Step 2: Verify Encoding

**CRITICAL STEP:** EDICT2 is encoded in EUC-JP, not UTF-8!

```bash
# Check encoding
file -b --mime-encoding /home/cow/data/dictionaries/edict2
```

**Expected output:** `unknown-8bit` or similar (NOT `utf-8`)

**View raw hex to confirm:**
```bash
hexdump -C /home/cow/data/dictionaries/edict2 | head -20
```

You should see Japanese characters, NOT UTF-8 replacement characters (efbfbd).

### Step 3: Verify Database Connection

Ensure PostgreSQL is running:
```bash
docker ps | grep postgres
```

Test connection:
```bash
docker exec -i cow-postgres-local psql -U cow_user -d cow_db -c "SELECT 1;"
```

### Step 4: Run Import Script

The import script handles EUC-JP to UTF-8 conversion automatically using `iconv-lite`.

Navigate to server directory and run import:
```bash
cd /home/cow/server
npx tsx scripts/import-edict2.ts
```

**Expected Output:**
```
🇯🇵 EDICT2 Japanese Dictionary Import
======================================

📄 Reading file: /home/cow/data/dictionaries/edict2
📝 Reading as EUC-JP encoding...
   Found 213716 lines
🔍 Parsing entries...
   Line 1000: 相 [あい]
   Line 2000: 藍 [あい]
   ...
   Line 210000: 和洋 [わよう]
✅ Parsed 173307 entries

🔌 Connecting to PostgreSQL...
✅ Connected

🗑️  Clearing existing Japanese entries...
✅ Cleared

💾 Inserting 173307 entries in batches of 1000...
   Progress: 10000/173307 (6%)
   Progress: 20000/173307 (12%)
   ...
   Progress: 170000/173307 (98%)

✅ Import complete!
   Total entries: 173307
   Duration: 6.51s
   Speed: 26622 entries/sec
🔌 Connection closed
```

**Import Performance:**
- Duration: 6-8 seconds
- Speed: 25,000-30,000 entries/second
- Database growth: ~85 MB

### Step 5: Verify Import

Check entry count:
```bash
docker exec -i cow-postgres-local psql -U cow_user -d cow_db -c \
  "SELECT language, COUNT(*) as entry_count FROM dictionaryentries GROUP BY language;"
```

Expected output should include:
```
language | entry_count
----------+-------------
 ja       |      173307
```

View sample entries:
```bash
docker exec -i cow-postgres-local psql -U cow_user -d cow_db -c \
  "SELECT word1, word2, pronunciation, definitions FROM dictionaryentries WHERE language = 'ja' LIMIT 5;"
```

Expected format:
```
 word1  |   word2    | pronunciation |               definitions
--------+------------+---------------+------------------------------------------
 日本   | にほん     | nihon         | ["Japan"]
 先生   | せんせい    | sensei        | ["teacher", "instructor", "master"]
 学校   | がっこう    | gakkou        | ["school"]
 本     | ほん       | hon           | ["book", "volume", "script"]
```

---

## Import Script Details

### File Location
`server/scripts/import-edict2.ts`

### Key Features

1. **EUC-JP Encoding Conversion**
   ```typescript
   import iconv from 'iconv-lite';
   
   const buffer = fs.readFileSync(filePath);
   const content = iconv.decode(buffer, 'euc-jp');  // Convert to UTF-8
   ```

2. **EDICT2 Format Parsing**
   - Extracts kanji form (primary word)
   - Extracts kana reading (in brackets)
   - Parses multiple definitions
   - Cleans POS tags and metadata

3. **Romaji Generation**
   - Converts hiragana/katakana to romaji
   - Uses Hepburn romanization system
   - Examples:
     - あ → a
     - か → ka
     - にほん → nihon
     - がっこう → gakkou

4. **Batch Processing**
   - Processes 1000 entries per batch
   - Reduces database load
   - Provides progress updates

5. **Error Handling**
   - Skips comment lines (starting with #)
   - Validates required fields
   - Reports parsing failures
   - Handles malformed entries gracefully

### Code Structure

```typescript
interface Edict2Entry {
    kanji: string;        // word1
    kana: string;         // word2
    romaji: string;       // pronunciation
    definitions: string[];
}

function parseEdict2Line(line: string): Edict2Entry | null {
    // Skip comments
    if (line.startsWith('#') || line.trim() === '') {
        return null;
    }
    
    // Extract kanji and kana
    const kanjiMatch = line.match(/^([^\[]+)/);
    const kanaMatch = line.match(/\[([^\]]+)\]/);
    
    // Extract definitions (between slashes)
    const defMatch = line.match(/\/(.*?)\/(EntL\d+)?\/$/);
    
    // Generate romaji from kana
    const romaji = kanaToRomaji(kana);
    
    return {
        kanji: kanji.trim(),
        kana: kana,
        romaji: romaji,
        definitions: cleanDefinitions(definitions)
    };
}
```

### Romaji Conversion

The script includes a comprehensive hiragana/katakana to romaji converter:

```typescript
function kanaToRomaji(kana: string): string {
    const conversionMap = {
        'あ': 'a', 'い': 'i', 'う': 'u', 'え': 'e', 'お': 'o',
        'か': 'ka', 'き': 'ki', 'く': 'ku', 'け': 'ke', 'こ': 'ko',
        'が': 'ga', 'ぎ': 'gi', 'ぐ': 'gu', 'げ': 'ge', 'ご': 'go',
        // ... (complete mapping for all kana)
        'ん': 'n'
    };
    
    // Handle special cases like っ (small tsu) and ー (long vowel mark)
    return convertKanaString(kana, conversionMap);
}
```

---

## Testing the Import

### Run API Test

```bash
cd /home/cow/server
node tests/test-japanese-dictionary-api.js
```

**Expected Output:**
```
📝 Test tokens: [ '日本', 'こんにちは', 'ありがとう', '食べる', '本', '学校', '先生' ]

🔐 Logging in as test user...
✅ Logged in successfully

🔍 Testing /api/vocabEntries/by-tokens...
✅ API Response received (27ms)

📊 Results:
   Personal entries: 0
   Dictionary entries: 5

✨ Dictionary Entries Found:

   1. 先生 (せんせい)
      Pronunciation: sensei
      Definitions: teacher, instructor, master

   2. 日本 (にほん)
      Pronunciation: nihon
      Definitions: Japan

   3. 本 (ほん)
      Pronunciation: hon
      Definitions: book, volume, script

🎉 SUCCESS! Japanese dictionary lookups are working!
```

### Manual Testing

1. Log into the application
2. Go to Settings → Select Japanese as learning language
3. Go to Reader page
4. Type or paste Japanese text (e.g., "日本語を勉強します")
5. Select Japanese words (e.g., "日本")
6. Verify dictionary popup appears with:
   - Kanji (日本)
   - Kana reading (にほん)
   - Romaji (nihon)
   - English definitions (Japan)

---

## Troubleshooting

### Issue 1: Encoding Corruption

**Symptoms:**
```
word1:  (replacement characters)
Hex: efbfbd efbfbd (UTF-8 replacement character)
```

**Root Cause:** Reading EUC-JP file as UTF-8

**Solution:**
```bash
# Ensure iconv-lite is installed
cd server
npm install iconv-lite

# Verify import script uses iconv-lite
grep -A 5 "iconv.decode" server/scripts/import-edict2.ts
```

The script MUST contain:
```typescript
import iconv from 'iconv-lite';
const buffer = fs.readFileSync(filePath);
const content = iconv.decode(buffer, 'euc-jp');
```

### Issue 2: File Not Found

**Symptom:**
```
❌ File not found.
```

**Solution:**
- Verify file path: `/home/cow/data/dictionaries/edict2`
- Check extraction: `ls -l data/dictionaries/edict2`
- Re-download if necessary

### Issue 3: Database Connection Failed

**Symptom:**
```
❌ Fatal error: Error: getaddrinfo EAI_AGAIN cow-postgres-local
```

**Solution:**
```bash
# Check if PostgreSQL is running
docker ps | grep postgres

# Restart if needed
docker restart cow-postgres-local

# Verify connection
docker exec -i cow-postgres-local psql -U cow_user -d cow_db -c "SELECT 1;"
```

### Issue 4: Import Parsing Errors

**Symptom:**
```
✅ Parsed 0 entries
```

**Solutions:**
1. **Wrong encoding:** Ensure using EUC-JP decoding
2. **Corrupted download:** Re-download dictionary file
3. **Wrong file format:** Verify it's EDICT2, not JMdict
4. **Check file contents:**
   ```bash
   head -20 /home/cow/data/dictionaries/edict2
   ```

Expected format: `漢字 [かな] /definition/EntryID/`

### Issue 5: iconv-lite Not Installed

**Symptom:**
```
Error: Cannot find module 'iconv-lite'
```

**Solution:**
```bash
cd /home/cow/server
npm install iconv-lite

# Verify installation
npm list iconv-lite
```

### Issue 6: Slow Import Performance

**Symptom:**
- Import takes >30 seconds
- Progress updates are very slow

**Solution:**
- Check database connection latency
- Verify Docker container resources
- Consider adjusting `BATCH_SIZE` in import script
- Default is 1000 entries per batch (optimal)

---

## Re-importing or Updating

### Clear Existing Entries

To re-import Japanese dictionary (e.g., with updated EDICT2 data):

```bash
# Option 1: Use import script (automatically clears)
cd server
npx tsx scripts/import-edict2.ts

# Option 2: Manual clearing
docker exec -i cow-postgres-local psql -U cow_user -d cow_db -c \
  "DELETE FROM dictionaryentries WHERE language = 'ja';"
```

### Verify Removal

```bash
docker exec -i cow-postgres-local psql -U cow_user -d cow_db -c \
  "SELECT COUNT(*) FROM dictionaryentries WHERE language = 'ja';"
```

Should return `0` if cleared successfully.

---

## Performance Metrics

### Import Statistics
- **File Size:** 20 MB (EUC-JP)
- **Total Lines:** 213,716
- **Valid Entries:** 173,307
- **Import Time:** 6-8 seconds
- **Import Speed:** 25,000-30,000 entries/second
- **Database Size Increase:** ~85 MB

### Runtime Performance
- **First Dictionary Lookup:** 15-30ms (API call + DB query)
- **Cached Lookup:** 0ms (instant from localStorage)
- **Cache Storage:** ~2-3 MB per 1000 tokens
- **Average Query Time:** 10-15ms

### Encoding Conversion Performance
- **EUC-JP to UTF-8:** ~1-2 seconds for 20MB file
- **Memory Usage:** ~100MB during conversion
- **CPU Usage:** Minimal (single-threaded)

---

## Data Quality Notes

### Coverage
- **173,307 entries** - Comprehensive coverage of Japanese vocabulary
- Includes common words, technical terms, and proper nouns
- Mix of pure Japanese (和語) and Sino-Japanese (漢語) words
- Some katakana loanwords from English

### Kanji vs Kana
- **word1 (kanji):** Primary lookup key
  - Example: 日本, 学校, 先生
- **word2 (kana):** Always present for pronunciation
  - Hiragana: にほん, がっこう, せんせい
  - Katakana: コンピューター, テレビ, etc.

### Romaji Quality
- Generated using Hepburn romanization
- Handles special cases:
  - っ (small tsu) → double consonant
  - ん → n (with context-aware rules)
  - ー (long vowel) → vowel doubling
- Examples:
  - がっこう → gakkou (double k for っ)
  - せんせい → sensei
  - コンピューター → konpyuutaa

### Definitions
- Multiple definitions per entry separated by slashes
- POS (part of speech) tags cleaned out
- Examples:
  - 本: ["book", "volume", "script"]
  - 先生: ["teacher", "instructor", "master"]
  - 食べる: ["to eat"]

### Part of Speech Tags (Cleaned)
Original EDICT2 includes tags like:
- `(n)` - noun
- `(v5r)` - godan verb
- `(adj-i)` - i-adjective

These are removed during import for cleaner definitions.

---

## Related Files

### Import Script
- `server/scripts/import-edict2.ts`

### Test Scripts
- `server/tests/test-japanese-dictionary-api.js`

### Sample Data Scripts
- `server/tests/add-japanese-sample-data.sql`
- `server/tests/add-japanese-vocab-from-text.sql`

### Documentation
- `JAPANESE_DICTIONARY_SUCCESS.md` - Comprehensive implementation summary
- `ADDING_NEW_LANGUAGE_GUIDE.md` - General guide for adding any language
- `MULTI_LANGUAGE_STATUS.md` - Overall multi-language status

---

## Quick Reference Commands

```bash
# Download dictionary
cd /home/cow/data/dictionaries
wget http://ftp.edrdg.org/pub/Nihongo/edict2.gz
gunzip edict2.gz

# Install encoding library
cd /home/cow/server
npm install iconv-lite

# Import dictionary
cd /home/cow/server
npx tsx scripts/import-edict2.ts

# Verify import
docker exec -i cow-postgres-local psql -U cow_user -d cow_db -c \
  "SELECT COUNT(*) FROM dictionaryentries WHERE language = 'ja';"

# Test API
cd /home/cow/server
node tests/test-japanese-dictionary-api.js

# View sample entries
docker exec -i cow-postgres-local psql -U cow_user -d cow_db -c \
  "SELECT word1, word2, pronunciation, definitions FROM dictionaryentries WHERE language = 'ja' LIMIT 10;"
```

---

## Support & Additional Resources

### Official EDICT Resources
- **Main Website:** http://www.edrdg.org/
- **EDICT Homepage:** http://www.edrdg.org/jmdict/edict.html
- **FTP Download:** http://ftp.edrdg.org/pub/Nihongo/
- **Documentation:** http://www.edrdg.org/jmdict/edict_doc.html

### Alternative Japanese Dictionaries
- **JMdict** (XML format, more comprehensive): http://www.edrdg.org/jmdict/j_jmdict.html
- **JMnedict** (Japanese proper names): http://www.edrdg.org/enamdict/enamdict_doc.html

### Encoding Resources
- **iconv-lite npm:** https://www.npmjs.com/package/iconv-lite
- **EUC-JP info:** https://en.wikipedia.org/wiki/Extended_Unix_Code#EUC-JP
- **Encoding detection:** `file -b --mime-encoding <filename>`

### Japanese Language Resources
- Hepburn romanization: https://en.wikipedia.org/wiki/Hepburn_romanization
- Hiragana chart: https://en.wikipedia.org/wiki/Hiragana
- Katakana chart: https://en.wikipedia.org/wiki/Katakana
- Kanji information: https://en.wikipedia.org/wiki/Kanji

### Application Documentation
- General language guide: `ADDING_NEW_LANGUAGE_GUIDE.md`
- Implementation summary: `JAPANESE_DICTIONARY_SUCCESS.md`
- Multi-language status: `MULTI_LANGUAGE_STATUS.md`

---

## Advanced Topics

### Using JMdict Instead of EDICT2

JMdict is the XML version with richer metadata:

**Advantages:**
- More structured data
- Better definition organization
- Includes usage examples
- Richer grammatical information

**Disadvantages:**
- Larger file size (~50+ MB)
- More complex parsing
- Requires XML parser

**Download:** http://ftp.edrdg.org/pub/Nihongo/JMdict_e.gz

### Adding JLPT Levels

Similar to HSK levels for Chinese, you can add JLPT (Japanese Language Proficiency Test) levels:

**External Resources:**
- JLPT vocabulary lists available online
- Can be cross-referenced with EDICT entries
- Would require additional import script

### Pitch Accent Information

For advanced learners, pitch accent can be useful:

**Resources:**
- OJAD (Online Japanese Accent Dictionary)
- Would require separate data source
- Not included in standard EDICT2

---

## Changelog

### Version 1.0 (October 18, 2025)
- Initial Japanese dictionary import process documented
- Based on EDICT2 from EDRDG
- 173,307 entries successfully imported
- EUC-JP encoding properly handled
- Romaji generation working
- Tested and verified in production

---

## License Information

### EDICT2 License

```
This package uses the EDICT and KANJIDIC dictionary files. 
These files are the property of the Electronic Dictionary Research 
and Development Group, and are used in conformance with the Group's 
licence.

The EDICT2 file is licensed under a 
Creative Commons Attribution-ShareAlike Licence (V3.0).
```

**License URL:** https://creativecommons.org/licenses/by-sa/3.0/

**Attribution:**
- Dictionary compiled by: Jim Breen and The Electronic Dictionary Research and Development Group
- Website: http://www.edrdg.org/

---

**Questions or Issues?**
- Check the troubleshooting section above
- Review `JAPANESE_DICTIONARY_SUCCESS.md` for comprehensive details
- Consult `ADDING_NEW_LANGUAGE_GUIDE.md` for general patterns
- Visit EDRDG website for dictionary updates: http://www.edrdg.org/
