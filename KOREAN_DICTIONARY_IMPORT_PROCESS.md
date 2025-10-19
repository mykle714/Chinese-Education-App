# Korean Dictionary Import Process

**Document Purpose:** Step-by-step guide for importing Korean dictionary data into the vocabulary learning application.

**Last Updated:** October 18, 2025

---

## Dictionary Source

### KENGDIC (Korean-English Dictionary)

- **Repository:** https://github.com/garfieldnate/kengdic
- **License:** Creative Commons (free for educational use)
- **Format:** TSV (Tab-Separated Values)
- **Size:** ~12 MB
- **Entries:** 117,509 Korean-English dictionary entries
- **Encoding:** UTF-8

### Dictionary Format

The KENGDIC dictionary uses TSV format with the following columns:

```
id	surface	hanja	gloss	level	created	source
```

**Column Mapping:**
- `surface` → Hangul (Korean script) - stored as `word1`
- `hanja` → Chinese characters (when available) - stored as `word2`
- `gloss` → English definition - stored in `definitions` array
- Other columns are metadata (not imported)

---

## Prerequisites

### Required Software
- Node.js (v16+)
- TypeScript/tsx runtime
- PostgreSQL database (running in Docker)
- Git (for cloning repository)

### Required Files
- Import script: `server/scripts/import-kengdic-tsv.ts`
- Database: PostgreSQL with multi-language schema

### Database Schema Requirements

The `DictionaryEntries` table must have:
```sql
language VARCHAR(10)      -- 'ko' for Korean
word1 TEXT               -- Hangul
word2 TEXT               -- Hanja (nullable)
pronunciation TEXT       -- Romanization (nullable, currently empty)
definitions JSONB        -- Array of definitions
```

---

## Import Process

### Step 1: Download Dictionary File

**Option A: Clone Repository (Recommended)**
```bash
cd /tmp
git clone https://github.com/garfieldnate/kengdic.git
```

The dictionary file will be at: `/tmp/kengdic/kengdic.tsv`

**Option B: Direct Download**
```bash
cd /home/cow/data/dictionaries
curl -L -o kengdic.tsv "https://raw.githubusercontent.com/garfieldnate/kengdic/master/kengdic.tsv"
```

### Step 2: Copy to Project Directory

```bash
cp /tmp/kengdic/kengdic.tsv /home/cow/data/dictionaries/
```

Verify the file:
```bash
ls -lh /home/cow/data/dictionaries/kengdic.tsv
wc -l /home/cow/data/dictionaries/kengdic.tsv
```

Expected output:
- File size: ~12 MB
- Line count: ~133,765 lines

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

Navigate to server directory and run import:
```bash
cd /home/cow/server
npx tsx scripts/import-kengdic-tsv.ts
```

**Expected Output:**
```
🇰🇷 KENGDIC Korean Dictionary Import (TSV format)
================================================

📄 Reading file: /home/cow/data/dictionaries/kengdic.tsv
   Found 133765 lines
🔍 Parsing entries...
✅ Parsed 117509 entries

🔌 Connecting to PostgreSQL...
✅ Connected

🗑️  Clearing existing Korean entries...
✅ Cleared

💾 Inserting 117509 entries in batches of 1000...
   Progress: 10000/117509 (9%)
   Progress: 20000/117509 (17%)
   ...
   Progress: 110000/117509 (94%)

✅ Import complete!
   Total entries: 117509
   Duration: 6.51s
   Speed: 18049 entries/sec
🔌 Connection closed
```

**Import Performance:**
- Duration: 6-8 seconds
- Speed: 15,000-20,000 entries/second
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
 ko       |      117509
```

View sample entries:
```bash
docker exec -i cow-postgres-local psql -U cow_user -d cow_db -c \
  "SELECT word1, word2, definitions FROM dictionaryentries WHERE language = 'ko' LIMIT 5;"
```

Expected format:
```
   word1    |  word2  |        definitions
------------+---------+---------------------------
 안녕하세요 |         | ["promenade"]
 학생       |         | ["student"]
 선생님     | 先生님  | ["Teacher"]
 친구       | 親舊    | ["A friend"]
 사랑       |         | ["love"]
```

---

## Import Script Details

### File Location
`server/scripts/import-kengdic-tsv.ts`

### Key Features

1. **TSV Parsing**
   - Reads UTF-8 encoded TSV file
   - Splits by tab delimiter
   - Extracts hangul, hanja, and definitions

2. **Data Transformation**
   - Maps `surface` → `word1` (Hangul)
   - Maps `hanja` → `word2` (nullable)
   - Converts `gloss` → JSON array of definitions
   - Sets `language` = 'ko'

3. **Batch Processing**
   - Processes 1000 entries per batch
   - Reduces database load
   - Provides progress updates

4. **Error Handling**
   - Skips header row
   - Validates required fields
   - Reports parsing failures

### Code Structure

```typescript
interface KEngDicEntry {
    hangul: string;       // word1
    hanja: string;        // word2
    romanization: string; // pronunciation (empty)
    definitions: string[];
}

function parseKEngDicLine(line: string, lineNumber: number): KEngDicEntry | null {
    const parts = line.split('\t');
    
    // Skip header
    if (lineNumber === 1) return null;
    
    const hangul = parts[1]?.trim();
    const hanja = parts[2]?.trim();
    const gloss = parts[3]?.trim();
    
    return {
        hangul,
        hanja: hanja || '',
        romanization: '',
        definitions: [gloss]
    };
}
```

---

## Testing the Import

### Run API Test

```bash
cd /home/cow/server
node tests/test-korean-dictionary-api.js
```

**Expected Output:**
```
🌐 Testing Korean Dictionary API
=================================

🔐 Logging in...
✅ Logged in

🔍 Testing /api/vocabEntries/by-tokens...
   Sample tokens: 학생, 한국, 선생님, 사랑, 친구

📊 Results:
   Dictionary entries: 7

✨ Sample Korean Dictionary Entries:
   1. 사랑 - love
   2. 선생님 (先生님) - Teacher
   3. 친구 (親舊) - A friend

🎉 SUCCESS! Korean dictionary lookups are working!
```

### Manual Testing

1. Log into the application
2. Go to Settings → Select Korean as learning language
3. Go to Reader page
4. Select Korean text (e.g., "한국어")
5. Verify dictionary popup appears with definition

---

## Troubleshooting

### Issue 1: File Not Found

**Symptom:**
```
❌ File not found.
```

**Solution:**
- Verify file path: `/home/cow/data/dictionaries/kengdic.tsv`
- Check file permissions: `ls -l data/dictionaries/kengdic.tsv`
- Re-download if necessary

### Issue 2: Database Connection Failed

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

### Issue 3: Import Parsing Errors

**Symptom:**
```
✅ Parsed 0 entries
```

**Solution:**
- File might be empty or corrupted
- Check file contents: `head -10 data/dictionaries/kengdic.tsv`
- Verify TSV format with tabs (not spaces)
- Re-download dictionary file

### Issue 4: Encoding Issues

**Symptom:**
- Korean characters appear as "?" or ""
- Database shows replacement characters

**Solution:**
- KENGDIC uses UTF-8 encoding (standard)
- Verify with: `file -b --mime-encoding data/dictionaries/kengdic.tsv`
- Should return: `utf-8` or `us-ascii`
- No additional encoding conversion needed

### Issue 5: Slow Import Performance

**Symptom:**
- Import takes >30 seconds
- Progress updates are very slow

**Solution:**
- Check database connection latency
- Verify Docker container resources
- Consider adjusting `BATCH_SIZE` in import script
- Default is 1000 entries per batch

---

## Re-importing or Updating

### Clear Existing Entries

To re-import Korean dictionary (e.g., with updated data):

```bash
# Option 1: Use import script (automatically clears)
cd server
npx tsx scripts/import-kengdic-tsv.ts

# Option 2: Manual clearing
docker exec -i cow-postgres-local psql -U cow_user -d cow_db -c \
  "DELETE FROM dictionaryentries WHERE language = 'ko';"
```

### Verify Removal

```bash
docker exec -i cow-postgres-local psql -U cow_user -d cow_db -c \
  "SELECT COUNT(*) FROM dictionaryentries WHERE language = 'ko';"
```

Should return `0` if cleared successfully.

---

## Performance Metrics

### Import Statistics
- **File Size:** 12 MB
- **Total Lines:** 133,765
- **Valid Entries:** 117,509
- **Import Time:** 6-8 seconds
- **Import Speed:** 15,000-20,000 entries/second
- **Database Size Increase:** ~85 MB

### Runtime Performance
- **First Dictionary Lookup:** 15-30ms (API call)
- **Cached Lookup:** 0ms (instant)
- **Cache Storage:** ~1-2 MB per 1000 tokens
- **Average Query Time:** 10-15ms

---

## Data Quality Notes

### Coverage
- **117,509 entries** - Good coverage for common Korean vocabulary
- Includes both modern and traditional Korean words
- Mix of pure Korean (hangul) and Sino-Korean (hanja) terms

### Hanja (Chinese Characters)
- Not all entries have hanja
- Modern Korean words typically use only hangul
- Traditional/formal words often include hanja
- Example: 학생 (學生) = student (has hanja), but 사랑 (no hanja) = love

### Definitions
- Single English definition per entry
- Some entries are brief (e.g., "student")
- Others are more detailed with context

### Romanization
- **Currently not included** in the import
- The `pronunciation` field is empty
- Can be added later using a romanization library
- Recommended: Revised Romanization of Korean standard

---

## Related Files

### Import Script
- `server/scripts/import-kengdic-tsv.ts`

### Test Scripts
- `server/tests/test-korean-dictionary-api.js`

### Sample Data Scripts
- `server/tests/add-korean-sample-data-corrected.sql`

### Documentation
- `KOREAN_DICTIONARY_SUCCESS.md` - Comprehensive implementation summary
- `ADDING_NEW_LANGUAGE_GUIDE.md` - General guide for adding any language

---

## Quick Reference Commands

```bash
# Download dictionary
cd /tmp && git clone https://github.com/garfieldnate/kengdic.git
cp /tmp/kengdic/kengdic.tsv /home/cow/data/dictionaries/

# Import dictionary
cd /home/cow/server
npx tsx scripts/import-kengdic-tsv.ts

# Verify import
docker exec -i cow-postgres-local psql -U cow_user -d cow_db -c \
  "SELECT COUNT(*) FROM dictionaryentries WHERE language = 'ko';"

# Test API
cd /home/cow/server
node tests/test-korean-dictionary-api.js

# View sample entries
docker exec -i cow-postgres-local psql -U cow_user -d cow_db -c \
  "SELECT word1, word2, definitions FROM dictionaryentries WHERE language = 'ko' LIMIT 10;"
```

---

## Support & Additional Resources

### Dictionary Source
- **GitHub Repository:** https://github.com/garfieldnate/kengdic
- **Issues/Updates:** Check repository for latest version

### Korean Language Resources
- Revised Romanization: https://en.wikipedia.org/wiki/Revised_Romanization_of_Korean
- Hangul information: https://en.wikipedia.org/wiki/Hangul
- Korean language info: https://en.wikipedia.org/wiki/Korean_language

### Application Documentation
- General language guide: `ADDING_NEW_LANGUAGE_GUIDE.md`
- Implementation summary: `KOREAN_DICTIONARY_SUCCESS.md`
- Multi-language status: `MULTI_LANGUAGE_STATUS.md`

---

## Changelog

### Version 1.0 (October 18, 2025)
- Initial Korean dictionary import process documented
- Based on KENGDIC repository
- 117,509 entries successfully imported
- Tested and verified working in production

---

**Questions or Issues?**
- Check the troubleshooting section above
- Review `KOREAN_DICTIONARY_SUCCESS.md` for comprehensive details
- Consult `ADDING_NEW_LANGUAGE_GUIDE.md` for general patterns
