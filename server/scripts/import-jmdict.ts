/**
 * JMdict (Japanese Dictionary) Import Script for PostgreSQL
 * Imports JMdict Japanese-English dictionary data into PostgreSQL database
 * 
 * Usage: node --loader ts-node/esm server/scripts/import-jmdict.ts [file_path]
 * Default path: /home/cow/data/dictionaries/JMdict_e
 */

import fs from 'fs';
import pg from 'pg';
import { parseStringPromise } from 'xml2js';

const BATCH_SIZE = 1000;

interface JMdictEntry {
    kanji: string;       // word1 - kanji form (can be empty)
    kana: string;        // word2 - kana reading
    romaji: string;      // pronunciation - romanization
    definitions: string[];
}

/**
 * Convert kana to romaji (simplified version)
 * For production, consider using a library like 'wanakana'
 */
function kanaToRomaji(kana: string): string {
    // Basic hiragana to romaji mapping
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
        'きゃ': 'kya', 'きゅ': 'kyu', 'きょ': 'kyo',
        'しゃ': 'sha', 'しゅ': 'shu', 'しょ': 'sho',
        'ちゃ': 'cha', 'ちゅ': 'chu', 'ちょ': 'cho',
        'にゃ': 'nya', 'にゅ': 'nyu', 'にょ': 'nyo',
        'ひゃ': 'hya', 'ひゅ': 'hyu', 'ひょ': 'hyo',
        'みゃ': 'mya', 'みゅ': 'myu', 'みょ': 'myo',
        'りゃ': 'rya', 'りゅ': 'ryu', 'りょ': 'ryo',
        'ぎゃ': 'gya', 'ぎゅ': 'gyu', 'ぎょ': 'gyo',
        'じゃ': 'ja', 'じゅ': 'ju', 'じょ': 'jo',
        'びゃ': 'bya', 'びゅ': 'byu', 'びょ': 'byo',
        'ぴゃ': 'pya', 'ぴゅ': 'pyu', 'ぴょ': 'pyo',
        'っ': ''
    };

    let romaji = '';
    let i = 0;
    while (i < kana.length) {
        // Try two-character combinations first
        const twoChar = kana.substring(i, i + 2);
        if (hiraganaMap[twoChar]) {
            romaji += hiraganaMap[twoChar];
            i += 2;
        } else {
            // Try single character
            const oneChar = kana[i];
            romaji += hiraganaMap[oneChar] || oneChar;
            i += 1;
        }
    }
    return romaji;
}

/**
 * Parse JMdict XML and extract entries
 */
async function parseJMdict(xmlContent: string): Promise<JMdictEntry[]> {
    console.log('📖 Parsing JMdict XML...');
    
    // Configure parser to handle entities and DOCTYPE
    const result = await parseStringPromise(xmlContent, {
        strict: false,
        trim: true,
        explicitArray: true,
        mergeAttrs: false
    });
    const entries: JMdictEntry[] = [];

    // Debug: Check the structure
    const jmdictEntries = result?.JMDICT?.entry || [];
    if (jmdictEntries.length === 0) {
        console.error('No entries found. Result structure:', Object.keys(result || {}));
        throw new Error('Failed to parse JMdict entries');
    }
    console.log(`   Found ${jmdictEntries.length} entries in XML`);

    for (const entry of jmdictEntries) {
        try {
            // Extract kanji (word1) - may not exist for kana-only words
            const kanji = entry.k_ele?.[0]?.keb?.[0] || '';

            // Extract kana reading (word2) - always exists
            const kana = entry.r_ele?.[0]?.reb?.[0] || '';
            if (!kana) continue; // Skip if no kana

            // Generate romaji (pronunciation)
            const romaji = kanaToRomaji(kana);

            // Extract definitions
            const definitions: string[] = [];
            const senses = entry.sense || [];
            for (const sense of senses) {
                const glosses = sense.gloss || [];
                for (const gloss of glosses) {
                    const glossText = typeof gloss === 'string' ? gloss : gloss._;
                    if (glossText) {
                        definitions.push(glossText);
                    }
                }
            }

            if (definitions.length > 0) {
                entries.push({
                    kanji: kanji,
                    kana: kana,
                    romaji: romaji,
                    definitions: definitions
                });
            }
        } catch (err) {
            console.error('Error parsing entry:', err);
        }
    }

    return entries;
}

/**
 * Insert batch into PostgreSQL
 */
async function insertBatch(client: pg.Client, entries: JMdictEntry[]): Promise<number> {
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
async function importJMdict() {
    const filePath = process.argv[2] || '/home/cow/data/dictionaries/JMdict_e';
    
    console.log('🇯🇵 JMdict Japanese Dictionary Import');
    console.log('=====================================\n');
    
    console.log('📄 Reading file:', filePath);
    if (!fs.existsSync(filePath)) {
        console.error('❌ File not found. Please run: gunzip /home/cow/data/dictionaries/JMdict_e.gz');
        process.exit(1);
    }

    const content = fs.readFileSync(filePath, 'utf-8');
    console.log(`   File size: ${(content.length / 1024 / 1024).toFixed(2)} MB`);

    const entries = await parseJMdict(content);
    console.log(`✅ Parsed ${entries.length} entries\n`);

    console.log('🔌 Connecting to PostgreSQL...');
    const client = new pg.Client({
        host: process.env.DB_HOST || 'cow-postgres-local',
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

importJMdict().catch(error => {
    console.error('❌ Fatal error:', error);
    process.exit(1);
});
