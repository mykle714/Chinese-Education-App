# Vietnamese Dictionary Sources Guide

This document provides verified sources for Vietnamese-English dictionary data that can be used with the application.

## Current Status

The import script `server/scripts/import-vdict.ts` is ready and supports multiple Vietnamese dictionary formats:
- `word@definition1;definition2` format
- Tab-separated (`word\tdefinition`)
- Pipe-separated (`word|definition`)
- Space-separated formats

**Target file location**: `data/dictionaries/viet-dict.txt`

## Recommended Vietnamese Dictionary Sources

### Option 1: CC-CEDICT Vietnamese (VDict) ⭐ RECOMMENDED

**Source**: Modified CEDICT format for Vietnamese
**URL**: https://cc-cedict.org/wiki/
**Alternative**: Search for "Vietnamese CEDICT" or "VDict project"

**Format**: Line-delimited similar to CEDICT
```
word [pronunciation] /definition1/definition2/
```

**Estimated Size**: 30,000-50,000 entries
**License**: CC BY-SA 3.0
**Encoding**: UTF-8

**Download Instructions**:
1. Visit the CC-CEDICT wiki or related Vietnamese projects
2. Look for Vietnamese dictionary downloads
3. Download the dictionary file
4. Save to `data/dictionaries/viet-dict.txt`

### Option 2: Wiktionary Data Dumps

**Source**: Wikimedia Foundation
**URL**: https://dumps.wikimedia.org/viwiktionary/latest/
**Direct File**: `viwiktionary-latest-pages-articles.xml.bz2`

**Format**: MediaWiki XML (requires parsing)
**Estimated Size**: Very large (500K+ entries with metadata)
**License**: CC BY-SA 3.0
**Encoding**: UTF-8

**Pros**: 
- Most comprehensive Vietnamese dictionary available
- Includes usage examples, etymologies
- Regularly updated

**Cons**:
- Complex XML format requires custom parser
- Very large file size
- Includes non-dictionary pages

**Download Instructions**:
1. Visit https://dumps.wikimedia.org/viwiktionary/latest/
2. Download `viwiktionary-latest-pages-articles.xml.bz2`
3. Extract: `bunzip2 viwiktionary-latest-pages-articles.xml.bz2`
4. Parse XML to extract word entries (requires custom script)

### Option 3: StarDict Dictionaries

**Source**: StarDict project and community dictionaries
**URL**: Search for "StarDict Vietnamese English dictionary"

**Format**: Binary StarDict format (requires conversion)
**Estimated Size**: 20,000-100,000 entries depending on dictionary
**License**: Various (check individual dictionaries)
**Encoding**: UTF-8

**Popular StarDict Vietnamese Dictionaries**:
- `vien-stardict` - Vietnamese-English
- `enviet-stardict` - English-Vietnamese (reverse)
- `han_viet` - Han-Viet (Sino-Vietnamese)

**Download Instructions**:
1. Search for StarDict Vietnamese dictionaries
2. Download .dict.dz, .idx, and .ifo files
3. Use `stardict-tools` to convert to text format:
   ```bash
   sudo apt-get install stardict-tools
   stardict2txt input.ifo output.txt
   ```
4. Convert to supported format and save to `data/dictionaries/viet-dict.txt`

### Option 4: Create Custom Dictionary from Multiple Sources

If finding a single comprehensive source is difficult, you can combine multiple smaller sources:

**A. Basic Word Lists**:
- **Vietnamese-Frequency**: https://github.com/hermitdave/FrequencyWords/tree/master/content/2018/vi
- Contains most common Vietnamese words (no definitions)

**B. Translation Memory Databases**:
- **OPUS Corpus**: http://opus.nlpl.eu/
- Parallel texts that can be processed for word pairs

**C. Tatoeba Sentences**:
- **URL**: https://tatoeba.org/en/downloads
- Vietnamese-English sentence pairs
- Can extract word-definition mappings

### Option 5: Simple Starter Dictionary (Quick Start)

If you need to test the system immediately, you can create a small starter dictionary manually:

**Create**: `data/dictionaries/viet-dict.txt`

**Format**: Use tab-separated values
```
xin chào	hello; greetings
cảm ơn	thank you
tạm biệt	goodbye; farewell
người	person; people
nước	water; country
đẹp	beautiful; pretty
học	to study; to learn
yêu	to love
ăn	to eat
uống	to drink
```

This will allow you to test the system with ~10-20 entries while searching for a comprehensive source.

## Vietnamese Dictionary Format Requirements

### Character Encoding
- **Required**: UTF-8 encoding
- Vietnamese uses Latin alphabet with diacritical marks
- No special encoding conversion needed (unlike Japanese/Korean)

### Diacritical Marks (Tone Marks)
Vietnamese has 6 tones represented by diacritical marks:
- á (acute) - rising tone
- à (grave) - falling tone  
- ả (hook) - dipping-rising tone
- ã (tilde) - rising-glottal tone
- ạ (dot below) - glottal stop
- a (no mark) - level tone

**Important**: The dictionary MUST preserve these marks accurately!

### Property Mapping
```
word1: Vietnamese word with proper diacritics
word2: null (Vietnamese doesn't have a secondary writing system)
pronunciation: null or romanization (usually not needed)
definitions: Array of English definitions
```

## Converting Common Formats

### Format 1: EDICT-style
```
Input:  word [pronunciation] /def1/def2/
Output: word@def1;def2
```

### Format 2: TSV (Tab-Separated)
```
Input:  word<TAB>definition
Output: (already compatible)
```

### Format 3: JSON
```json
Input:  {"word": "xin chào", "definition": "hello"}
Output: xin chào	hello
```

Use this script to convert JSON to tab-separated:
```bash
jq -r '.[] | "\(.word)\t\(.definition)"' input.json > viet-dict.txt
```

## Import Process

Once you have the dictionary file:

1. **Place file**: Copy to `data/dictionaries/viet-dict.txt`

2. **Run import**:
   ```bash
   cd server
   npx tsx scripts/import-vdict.ts
   ```

3. **Expected output**:
   ```
   🇻🇳 Vietnamese Dictionary Import
   =================================
   
   📄 Reading file: /home/cow/data/dictionaries/viet-dict.txt
      Found XXXXX lines
   🔍 Parsing entries...
   ✅ Parsed XXXXX entries
   
   🔌 Connecting to PostgreSQL...
   ✅ Connected
   
   💾 Inserting XXXXX entries...
   ✅ Import complete!
   ```

4. **Verify**:
   ```bash
   docker exec -i cow-postgres-local psql -U cow_user -d cow_db -c \
     "SELECT COUNT(*) FROM dictionaryentries WHERE language = 'vi';"
   ```

## Testing

After import, test with sample Vietnamese words:
- xin chào (hello)
- cảm ơn (thank you)
- Việt Nam (Vietnam)
- người (person)
- đẹp (beautiful)

## Troubleshooting

### Issue: No entries parsed
**Cause**: File format not recognized
**Solution**: Check the format and modify `parseDictLine()` in `import-vdict.ts`

### Issue: Diacritics display as 
**Cause**: Wrong encoding
**Solution**: Ensure file is UTF-8 encoded:
```bash
file -bi data/dictionaries/viet-dict.txt
# Should show: charset=utf-8
```

### Issue: Import fails with connection error
**Cause**: PostgreSQL not accessible
**Solution**: 
```bash
docker ps | grep postgres
docker restart cow-postgres-local
```

## Recommendations

**For immediate testing**: 
- Create a small manual dictionary (Option 5) with 20-50 common words

**For production use**:
- Use Wiktionary dumps (most comprehensive)
- Or find StarDict Vietnamese dictionaries (good quality)
- Or search for CC-CEDICT Vietnamese variant

**Next Steps**:
1. Choose a source from above
2. Download/create the dictionary file
3. Place in `data/dictionaries/viet-dict.txt`
4. Run the import script
5. Test with the application

## Additional Resources

- **Vietnamese Language Resources**: https://www.omniglot.com/writing/vietnamese.htm
- **Vietnamese Phonetics**: Understanding tones and pronunciation
- **Unicode Vietnamese**: https://en.wikipedia.org/wiki/Vietnamese_language_and_computers

## Need Help?

If you're having trouble finding or downloading a dictionary:
1. Try the "Simple Starter Dictionary" option first
2. Search GitHub for "Vietnamese English dictionary txt"
3. Check linguistics forums and communities
4. Consider creating a crowdsourced dictionary from Tatoeba sentences

---

**Last Updated**: 2025-10-18
**Status**: Dictionary file needed - import script ready
