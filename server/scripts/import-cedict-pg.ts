/**
 * CC-CEDICT Import Script for PostgreSQL
 * Imports CC-CEDICT Chinese-English dictionary data into PostgreSQL database
 * 
 * Usage: node --loader ts-node/esm server/scripts/import-cedict-pg.ts [file_path]
 * Default path: /home/cow/cedict_ts.u8
 */

import fs from 'fs';
import pg from 'pg';

const BATCH_SIZE = 1000;

const TONE_MARK_MAP: Record<string, number> = {
    'ā': 1, 'á': 2, 'ǎ': 3, 'à': 4,
    'ē': 1, 'é': 2, 'ě': 3, 'è': 4,
    'ī': 1, 'í': 2, 'ǐ': 3, 'ì': 4,
    'ō': 1, 'ó': 2, 'ǒ': 3, 'ò': 4,
    'ū': 1, 'ú': 2, 'ǔ': 3, 'ù': 4,
    'ǖ': 1, 'ǘ': 2, 'ǚ': 3, 'ǜ': 4,
};

function extractTones(pronunciation: string): string {
    return pronunciation.split(' ').map(syllable => {
        for (const char of syllable) {
            if (TONE_MARK_MAP[char] !== undefined) return TONE_MARK_MAP[char];
        }
        return 0;
    }).join('');
}

interface DictionaryEntry {
    word1: string;      // simplified Chinese
    word2: string;      // traditional Chinese
    pronunciation: string; // pinyin with tone marks
    tone: string;       // tone digits derived from pronunciation (e.g. "12")
    definitions: string[];
}

/**
 * Convert pinyin with tone numbers to pinyin with tone marks
 */
function convertPinyinToToneMarks(pinyinWithNumbers: string): string {
    const toneMarks: { [key: string]: string[] } = {
        'a': ['a', 'ā', 'á', 'ǎ', 'à'],
        'e': ['e', 'ē', 'é', 'ě', 'è'],
        'i': ['i', 'ī', 'í', 'ǐ', 'ì'],
        'o': ['o', 'ō', 'ó', 'ǒ', 'ò'],
        'u': ['u', 'ū', 'ú', 'ǔ', 'ù'],
        'ü': ['ü', 'ǖ', 'ǘ', 'ǚ', 'ǜ']
    };

    const syllables = pinyinWithNumbers.split(' ');
    const converted = syllables.map(syllable => {
        const match = syllable.match(/^([a-züÜ]+)([1-5])$/i);
        if (!match) return syllable;

        let [, letters, toneStr] = match;
        const tone = parseInt(toneStr);

        letters = letters.replace(/v/g, 'ü').replace(/V/g, 'Ü');

        let vowelIndex = letters.search(/[aeAE]/);
        if (vowelIndex === -1) {
            const vowelMatches = Array.from(letters.matchAll(/[iouüIOUÜ]/g));
            if (vowelMatches.length > 0) {
                vowelIndex = vowelMatches[vowelMatches.length - 1].index!;
            }
        }

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
 * Parse a CC-CEDICT line
 */
function parseCEDICTLine(line: string): DictionaryEntry | null {
    if (line.startsWith('#') || line.trim() === '') {
        return null;
    }

    // More flexible regex that handles trailing whitespace and optional ending /
    const match = line.match(/^(\S+)\s+(\S+)\s+\[([^\]]+)\]\s+\/(.+)/);
    if (!match) {
        return null;
    }

    const [, traditional, simplified, pinyinWithNumbers, definitionsStr] = match;
    const pinyin = convertPinyinToToneMarks(pinyinWithNumbers);
    
    // Remove trailing / if present and split
    const cleanDefs = definitionsStr.replace(/\/\s*$/, '');
    const definitions = cleanDefs.split('/').filter(d => d.trim().length > 0);

    return {
        word1: simplified,
        word2: traditional,
        pronunciation: pinyin,
        tone: extractTones(pinyin),
        definitions
    };
}

/**
 * Insert batch into PostgreSQL
 */
async function insertBatch(client: pg.Client, entries: DictionaryEntry[]): Promise<number> {
    if (entries.length === 0) return 0;

    const values: any[] = [];
    const placeholders: string[] = [];
    
    entries.forEach((entry, i) => {
        const base = i * 6;
        placeholders.push(`($${base + 1}, $${base + 2}, $${base + 3}, $${base + 4}, $${base + 5}, $${base + 6})`);
        values.push(
            'zh',  // language
            entry.word1,
            entry.word2,
            entry.pronunciation,
            entry.tone,
            JSON.stringify(entry.definitions)
        );
    });

    const query = `
        INSERT INTO DictionaryEntries (language, word1, word2, pronunciation, tone, definitions)
        VALUES ${placeholders.join(', ')}
    `;

    const result = await client.query(query, values);
    return result.rowCount || 0;
}

/**
 * Main import
 */
async function importCEDICT() {
    const filePath = process.argv[2] || '/home/cow/cedict_ts.u8';
    
    console.log('🇨🇳 CC-CEDICT Chinese Dictionary Import');
    console.log('========================================\n');
    
    console.log('📄 Reading file:', filePath);
    const content = fs.readFileSync(filePath, 'utf-8');
    const lines = content.split('\n');
    console.log(`   Found ${lines.length} lines`);

    console.log('🔍 Parsing entries...');
    const entries: DictionaryEntry[] = [];
    
    for (const line of lines) {
        const entry = parseCEDICTLine(line);
        if (entry) {
            entries.push(entry);
        }
    }

    console.log(`✅ Parsed ${entries.length} entries`);

    console.log('🔌 Connecting to PostgreSQL...');
    const client = new pg.Client({
        host: process.env.DB_HOST || 'cow-postgres-local',
        port: parseInt(process.env.DB_PORT || '5432'),
        database: process.env.DB_NAME || 'cow_db',
        user: process.env.DB_USER || 'cow_user',
        password: process.env.DB_PASSWORD || 'cow_password_local'
    });

    await client.connect();
    console.log('✅ Connected');

    console.log('🗑️  Clearing existing Chinese entries...');
    await client.query("DELETE FROM DictionaryEntries WHERE language = 'zh'");
    console.log('✅ Cleared');

    console.log(`💾 Inserting ${entries.length} entries in batches of ${BATCH_SIZE}...`);
    let totalInserted = 0;
    const startTime = Date.now();

    for (let i = 0; i < entries.length; i += BATCH_SIZE) {
        const batch = entries.slice(i, i + BATCH_SIZE);
        const inserted = await insertBatch(client, batch);
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

importCEDICT().catch(error => {
    console.error('❌ Fatal error:', error);
    process.exit(1);
});
