/**
 * EDICT2 (Japanese Dictionary) Import Script for PostgreSQL
 * Imports EDICT2 Japanese-English dictionary data into PostgreSQL database
 * 
 * Usage: node --loader ts-node/esm server/scripts/import-edict2.ts [file_path]
 * Default path: /home/cow/data/dictionaries/edict2
 */

import fs from 'fs';
import pg from 'pg';
import iconv from 'iconv-lite';

const BATCH_SIZE = 1000;

interface EdictEntry {
    kanji: string;       // word1 - kanji form (can be empty for kana-only words)
    kana: string;        // word2 - kana reading
    romaji: string;      // pronunciation - romanization
    definitions: string[];
}

/**
 * Convert kana to romaji (simplified version)
 */
function kanaToRomaji(kana: string): string {
    const hiraganaMap: { [key: string]: string } = {
        'あ': 'a', 'い': 'i', 'う': 'u', 'え': 'e', 'お': 'o',
        'か': 'ka', 'き': 'ki', 'く': 'ku', 'け': 'ke', 'こ': 'ko',
        'さ': 'sa', 'し': 'shi', 'す': 'su', 'せ': 'se', 'そ': 'so',
        'た': 'ta', 'ち': 'chi', 'つ': 'tsu', 'て': 'te', 'と': 'to',
        'な': 'na', 'に': 'ni', 'ぬ': 'nu', 'ね': 'ne', 'の': 'no',
        'は': 'ha', 'ひ': 'hi', 'ふ': 'fu', 'へ': 'he', 'ほ': 'ho',
        'ま': 'ma', 'み': 'mi', 'む': 'mu', 'め': 'me', 'も': 'mo',
        'や': 'ya', 'ゆ': 'yu', 'よ': 'yo',
        'ら': 'ra', 'り': 'ri', 'る': 'ru', 'れ': 're', 'ろ': 'ro',
        'わ': 'wa', 'を': 'wo', 'ん': 'n',
        'が': 'ga', 'ぎ': 'gi', 'ぐ': 'gu', 'げ': 'ge', 'ご': 'go',
        'ざ': 'za', 'じ': 'ji', 'ず': 'zu', 'ぜ': 'ze', 'ぞ': 'zo',
        'だ': 'da', 'ぢ': 'ji', 'づ': 'zu', 'で': 'de', 'ど': 'do',
        'ば': 'ba', 'び': 'bi', 'ぶ': 'bu', 'べ': 'be', 'ぼ': 'bo',
        'ぱ': 'pa', 'ぴ': 'pi', 'ぷ': 'pu', 'ぺ': 'pe', 'ぽ': 'po',
        'っ': ''
    };

    let romaji = '';
    let i = 0;
    while (i < kana.length) {
        const twoChar = kana.substring(i, i + 2);
        if (hiraganaMap[twoChar]) {
            romaji += hiraganaMap[twoChar];
            i += 2;
        } else {
            const oneChar = kana[i];
            romaji += hiraganaMap[oneChar] || oneChar;
            i += 1;
        }
    }
    return romaji;
}

/**
 * Parse an EDICT2 line
 * Format: KANJI [KANA] /(definition)/(definition)/EntryID/
 */
function parseEdictLine(line: string): EdictEntry | null {
    // Skip header and empty lines
    if (line.startsWith('/EDICT') || line.trim() === '') {
        return null;
    }

    // Match: kanji [kana] /definitions.../EntLxxxxx/
    // Some entries may not have kanji, just [kana]
    const match = line.match(/^(.+?)\s*\[(.+?)\]\s*\/(.+)/);
    if (!match) {
        return null;
    }

    let [, kanjiPart, kana, defsPart] = match;
    
    // Clean up kanji part (may have multiple forms separated by semicolons, take first)
    const kanji = kanjiPart.split(';')[0].trim();
    
    // Clean kana (may have multiple forms separated by semicolons, take first)
    kana = kana.split(';')[0].trim();
    
    // Parse definitions (remove EntL ID at end, split by /)
    const defsStr = defsPart.replace(/EntL\d+X?\/$/, '').replace(/\/$/, '');
    const definitions = defsStr.split('/')
        .map(d => d.trim())
        .filter(d => d.length > 0)
        .map(d => {
            // Remove part of speech tags like (n), (v1), etc. for cleaner definitions
            return d.replace(/^\([^)]+\)\s*/, '');
        })
        .filter(d => d.length > 0);

    if (definitions.length === 0) {
        return null;
    }

    const romaji = kanaToRomaji(kana);

    return {
        kanji,
        kana,
        romaji,
        definitions
    };
}

/**
 * Insert batch into PostgreSQL
 */
async function insertBatch(client: pg.Client, entries: EdictEntry[]): Promise<number> {
    if (entries.length === 0) return 0;

    const values: any[] = [];
    const placeholders: string[] = [];
    
    entries.forEach((entry, i) => {
        const base = i * 5;
        placeholders.push(`($${base + 1}, $${base + 2}, $${base + 3}, $${base + 4}, $${base + 5})`);
        values.push(
            'ja',  // language
            entry.kanji || entry.kana,  // word1 - prefer kanji, fallback to kana
            entry.kana,  // word2
            entry.romaji,  // pronunciation
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
 * Main import
 */
async function importEdict2() {
    const filePath = process.argv[2] || '/home/cow/data/dictionaries/edict2';
    
    console.log('🇯🇵 EDICT2 Japanese Dictionary Import');
    console.log('======================================\n');
    
    console.log('📄 Reading file:', filePath);
    if (!fs.existsSync(filePath)) {
        console.error('❌ File not found.');
        process.exit(1);
    }

    // EDICT2 files are encoded in EUC-JP, not UTF-8
    console.log('📝 Reading as EUC-JP encoding...');
    const buffer = fs.readFileSync(filePath);
    const content = iconv.decode(buffer, 'euc-jp');
    const lines = content.split('\n');
    console.log(`   Found ${lines.length} lines`);

    console.log('🔍 Parsing entries...');
    const entries: EdictEntry[] = [];
    
    for (const line of lines) {
        const entry = parseEdictLine(line);
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

    console.log('🗑️  Clearing existing Japanese entries...');
    await client.query("DELETE FROM DictionaryEntries WHERE language = 'ja'");
    console.log('✅ Cleared\n');

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

importEdict2().catch(error => {
    console.error('❌ Fatal error:', error);
    process.exit(1);
});
