/**
 * Vietnamese Dictionary Import Script for PostgreSQL
 * Imports Vietnamese-English dictionary data into PostgreSQL database
 * 
 * Usage: node --loader ts-node/esm server/scripts/import-vdict.ts [file_path]
 * Default path: /home/cow/data/dictionaries/viet-dict.txt
 */

import fs from 'fs';
import pg from 'pg';

const BATCH_SIZE = 1000;

interface VDictEntry {
    word: string;        // word1 - Vietnamese word
    definitions: string[];
}

/**
 * Parse Vietnamese dictionary line
 * Format varies, but typically: word@definition1;definition2
 * or simpler formats like: word\tdefinition
 */
function parseVDictLine(line: string): VDictEntry | null {
    if (line.startsWith('#') || line.trim() === '') {
        return null;
    }

    let word = '';
    let definitions: string[] = [];

    // Try format: word@def1;def2;def3
    if (line.includes('@')) {
        const parts = line.split('@');
        word = parts[0].trim();
        const defStr = parts[1] || '';
        definitions = defStr.split(';')
            .map(d => d.trim())
            .filter(d => d.length > 0);
    }
    // Try format: word\tdefinition
    else if (line.includes('\t')) {
        const parts = line.split('\t');
        word = parts[0].trim();
        const def = parts[1]?.trim();
        if (def) {
            definitions = [def];
        }
    }
    // Try format: word|definition
    else if (line.includes('|')) {
        const parts = line.split('|');
        word = parts[0].trim();
        const def = parts[1]?.trim();
        if (def) {
            definitions = [def];
        }
    }
    // Try simple space-separated format (word followed by definition)
    else {
        const match = line.match(/^(\S+)\s+(.+)$/);
        if (match) {
            word = match[1];
            definitions = [match[2].trim()];
        }
    }

    if (word && definitions.length > 0) {
        return {
            word,
            definitions
        };
    }

    return null;
}

/**
 * Insert batch into PostgreSQL
 */
async function insertBatch(client: pg.Client, entries: VDictEntry[]): Promise<number> {
    if (entries.length === 0) return 0;

    const values: any[] = [];
    const placeholders: string[] = [];
    
    entries.forEach((entry, i) => {
        const base = i * 3;
        placeholders.push(`($${base + 1}, $${base + 2}, $${base + 3})`);
        values.push(
            'vi',  // language
            entry.word,  // word1
            JSON.stringify(entry.definitions)
        );
    });

    const query = `
        INSERT INTO DictionaryEntries (language, word1, definitions)
        VALUES ${placeholders.join(', ')}
    `;

    const result = await client.query(query, values);
    return result.rowCount || 0;
}

/**
 * Main import
 */
async function importVDict() {
    const filePath = process.argv[2] || '/home/cow/data/dictionaries/viet-dict.txt';
    
    console.log('🇻🇳 Vietnamese Dictionary Import');
    console.log('=================================\n');
    
    console.log('📄 Reading file:', filePath);
    if (!fs.existsSync(filePath)) {
        console.error('❌ File not found.');
        console.error('Vietnamese dictionary may need to be manually downloaded.');
        console.error('Suggested sources:');
        console.error('  - https://github.com/hieuphq/vietnamese-dictionary');
        console.error('  - http://www.informatik.uni-leipzig.de/~duc/Dict/');
        process.exit(1);
    }

    const content = fs.readFileSync(filePath, 'utf-8');
    const lines = content.split('\n');
    console.log(`   Found ${lines.length} lines`);

    console.log('🔍 Parsing entries...');
    const entries: VDictEntry[] = [];
    
    for (const line of lines) {
        const entry = parseVDictLine(line);
        if (entry) {
            entries.push(entry);
        }
    }

    console.log(`✅ Parsed ${entries.length} entries\n`);

    if (entries.length === 0) {
        console.error('❌ No entries parsed. The file format may not be supported.');
        console.error('Please check the file format or provide a different dictionary file.');
        process.exit(1);
    }

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

    console.log('🗑️  Clearing existing Vietnamese entries...');
    await client.query("DELETE FROM DictionaryEntries WHERE language = 'vi'");
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

importVDict().catch(error => {
    console.error('❌ Fatal error:', error);
    process.exit(1);
});
