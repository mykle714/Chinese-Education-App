/**
 * CC-CEDICT Import Script
 * Downloads and imports CC-CEDICT Chinese-English dictionary data into the database
 * 
 * Usage: node --loader ts-node/esm server/scripts/import-cedict.ts
 * 
 * This script:
 * 1. Downloads the latest CC-CEDICT from MDBG
 * 2. Parses the dictionary format: Traditional Simplified [pinyin] /definition1/definition2/
 * 3. Converts pinyin from tone numbers (ni3 hao3) to tone marks (nǐ hǎo)
 * 4. Imports entries into the DictionaryEntries table with batch inserts
 */

import https from 'https';
import zlib from 'zlib';
import sql from 'mssql';
import { config } from '../db-config.js';

// CC-CEDICT download URL
const CEDICT_URL = 'https://www.mdbg.net/chinese/export/cedict/cedict_1_0_ts_utf-8_mdbg.txt.gz';

// Batch size for database inserts
const BATCH_SIZE = 1000;

interface DictionaryEntry {
    traditional: string;
    simplified: string;
    pinyin: string;
    definitions: string[];
}

/**
 * Convert pinyin with tone numbers to pinyin with tone marks
 * e.g., "ni3 hao3" -> "nǐ hǎo"
 */
function convertPinyinToToneMarks(pinyinWithNumbers: string): string {
    // Mapping of vowels to their tone mark variations
    const toneMarks: { [key: string]: string[] } = {
        'a': ['a', 'ā', 'á', 'ǎ', 'à'],
        'e': ['e', 'ē', 'é', 'ě', 'è'],
        'i': ['i', 'ī', 'í', 'ǐ', 'ì'],
        'o': ['o', 'ō', 'ó', 'ǒ', 'ò'],
        'u': ['u', 'ū', 'ú', 'ǔ', 'ù'],
        'ü': ['ü', 'ǖ', 'ǘ', 'ǚ', 'ǜ'],
        'A': ['A', 'Ā', 'Á', 'Ǎ', 'À'],
        'E': ['E', 'Ē', 'É', 'Ě', 'È'],
        'I': ['I', 'Ī', 'Í', 'Ǐ', 'Ì'],
        'O': ['O', 'Ō', 'Ó', 'Ǒ', 'Ò'],
        'U': ['U', 'Ū', 'Ú', 'Ǔ', 'Ù'],
        'Ü': ['Ü', 'Ǖ', 'Ǘ', 'Ǚ', 'Ǜ']
    };

    // Split into syllables and process each
    const syllables = pinyinWithNumbers.split(' ');
    const converted = syllables.map(syllable => {
        // Extract tone number from end of syllable
        const match = syllable.match(/^([a-züÜ]+)([1-5])$/i);
        if (!match) {
            // No tone number found, return as-is (might be neutral tone or punctuation)
            return syllable;
        }

        let [, letters, toneStr] = match;
        const tone = parseInt(toneStr);

        // Special case: 'v' should be 'ü'
        letters = letters.replace(/v/g, 'ü').replace(/V/g, 'Ü');

        // Find which vowel gets the tone mark (pinyin tone mark rules)
        let vowelIndex = -1;
        
        // Rule 1: 'a' or 'e' gets the tone mark if present
        vowelIndex = letters.search(/[aeAE]/);
        
        // Rule 2: If no 'a' or 'e', the last vowel gets the tone mark
        if (vowelIndex === -1) {
            const vowelMatches = Array.from(letters.matchAll(/[iouüIOUÜ]/g));
            if (vowelMatches.length > 0) {
                vowelIndex = vowelMatches[vowelMatches.length - 1].index!;
            }
        }

        // Apply tone mark
        if (vowelIndex !== -1) {
            const vowel = letters[vowelIndex];
            const toneMarkedVowel = toneMarks[vowel]?.[tone] || vowel;
            letters = letters.substring(0, vowelIndex) + toneMarkedVowel + letters.substring(vowelIndex + 1);
        }

        return letters;
    });

    return converted.join(' ');
}

/**
 * Parse a CC-CEDICT line into a structured entry
 * Format: Traditional Simplified [pinyin] /definition1/definition2/
 */
function parseCEDICTLine(line: string): DictionaryEntry | null {
    // Skip comments and empty lines
    if (line.startsWith('#') || line.trim() === '') {
        return null;
    }

    // Parse the line format
    const match = line.match(/^(\S+)\s+(\S+)\s+\[([^\]]+)\]\s+\/(.+)\/$/);
    if (!match) {
        return null;
    }

    const [, traditional, simplified, pinyinWithNumbers, definitionsStr] = match;

    // Convert pinyin to tone marks
    const pinyin = convertPinyinToToneMarks(pinyinWithNumbers);

    // Split definitions
    const definitions = definitionsStr.split('/').filter(d => d.trim().length > 0);

    return {
        traditional,
        simplified,
        pinyin,
        definitions
    };
}

/**
 * Download and decompress CC-CEDICT file
 */
async function downloadCEDICT(): Promise<string> {
    console.log('📥 Downloading CC-CEDICT from', CEDICT_URL);
    
    return new Promise((resolve, reject) => {
        https.get(CEDICT_URL, (response) => {
            if (response.statusCode !== 200) {
                reject(new Error(`Failed to download: HTTP ${response.statusCode}`));
                return;
            }

            const gunzip = zlib.createGunzip();
            const chunks: Buffer[] = [];

            response.pipe(gunzip);

            gunzip.on('data', (chunk) => {
                chunks.push(chunk);
            });

            gunzip.on('end', () => {
                const content = Buffer.concat(chunks).toString('utf-8');
                console.log('✅ Download complete');
                resolve(content);
            });

            gunzip.on('error', (error) => {
                reject(error);
            });
        }).on('error', (error) => {
            reject(error);
        });
    });
}

/**
 * Insert entries into database in batches
 */
async function insertEntriesBatch(pool: sql.ConnectionPool, entries: DictionaryEntry[]): Promise<number> {
    if (entries.length === 0) {
        return 0;
    }

    const request = pool.request();
    
    // Build the table-valued parameter
    const table = new sql.Table();
    table.columns.add('simplified', sql.NVarChar(100), { nullable: false });
    table.columns.add('traditional', sql.NVarChar(100), { nullable: false });
    table.columns.add('pinyin', sql.NVarChar(200), { nullable: false });
    table.columns.add('definitions', sql.NVarChar(sql.MAX), { nullable: false });

    entries.forEach(entry => {
        table.rows.add(
            entry.simplified,
            entry.traditional,
            entry.pinyin,
            JSON.stringify(entry.definitions)
        );
    });

    const query = `
        INSERT INTO DictionaryEntries (simplified, traditional, pinyin, definitions)
        SELECT simplified, traditional, pinyin, definitions
        FROM @entries
    `;

    request.input('entries', table);
    const result = await request.query(query);
    
    return result.rowsAffected[0] || 0;
}

/**
 * Main import function
 */
async function importCEDICT() {
    const startTime = Date.now();
    let pool: sql.ConnectionPool | null = null;

    try {
        // Download CC-CEDICT
        const content = await downloadCEDICT();
        const lines = content.split('\n');
        console.log(`📄 Processing ${lines.length} lines`);

        // Parse entries
        console.log('🔍 Parsing entries...');
        const entries: DictionaryEntry[] = [];
        let parsed = 0;
        let skipped = 0;

        for (const line of lines) {
            const entry = parseCEDICTLine(line);
            if (entry) {
                entries.push(entry);
                parsed++;
            } else if (line.trim() !== '' && !line.startsWith('#')) {
                skipped++;
            }
        }

        console.log(`✅ Parsed ${parsed} entries (skipped ${skipped} invalid lines)`);

        // Connect to database
        console.log('🔌 Connecting to database...');
        pool = await sql.connect(config);
        console.log('✅ Connected to database');

        // Clear existing dictionary entries
        console.log('🗑️  Clearing existing dictionary entries...');
        await pool.request().query('DELETE FROM DictionaryEntries');
        console.log('✅ Cleared existing entries');

        // Insert entries in batches
        console.log(`💾 Inserting ${entries.length} entries in batches of ${BATCH_SIZE}...`);
        let totalInserted = 0;
        
        for (let i = 0; i < entries.length; i += BATCH_SIZE) {
            const batch = entries.slice(i, i + BATCH_SIZE);
            const inserted = await insertEntriesBatch(pool, batch);
            totalInserted += inserted;
            
            const progress = Math.round((totalInserted / entries.length) * 100);
            console.log(`   Progress: ${totalInserted}/${entries.length} (${progress}%)`);
        }

        const duration = ((Date.now() - startTime) / 1000).toFixed(2);
        console.log(`\n✅ Import complete!`);
        console.log(`   Total entries: ${totalInserted}`);
        console.log(`   Duration: ${duration}s`);
        console.log(`   Speed: ${Math.round(totalInserted / parseFloat(duration))} entries/sec`);

    } catch (error) {
        console.error('❌ Import failed:', error);
        throw error;
    } finally {
        if (pool) {
            await pool.close();
            console.log('🔌 Database connection closed');
        }
    }
}

// Run the import
importCEDICT().catch(error => {
    console.error('Fatal error:', error);
    process.exit(1);
});
