/**
 * CC-KEDICT Korean Dictionary Import Script for PostgreSQL
 * Imports CC-KEDICT Korean-English dictionary data into PostgreSQL database
 * 
 * Usage: node --loader ts-node/esm server/scripts/import-kedict.ts [file_path]
 * Default path: /home/cow/data/dictionaries/cc-kedict.txt
 */

import fs from 'fs';
import pg from 'pg';

const BATCH_SIZE = 1000;

interface KEdictEntry {
    hangul: string;      // word1 - Korean hangul
    hanja: string;       // word2 - Chinese characters (hanja)
    romanization: string; // pronunciation - romanization
    definitions: string[];
}

/**
 * Parse a CC-KEDICT line
 * Format: 한국어 韓國語 [hangugeo] /Korean language/
 */
function parseKEDICTLine(line: string): KEdictEntry | null {
    if (line.startsWith('#') || line.trim() === '') {
        return null;
    }

    // Match: hangul hanja [romanization] /definition1/definition2/
    const match = line.match(/^(\S+)\s+(\S+)\s+\[([^\]]+)\]\s+\/(.+)/);
    if (!match) {
        return null;
    }

    const [, hangul, hanja, romanization, definitionsStr] = match;
    
    // Remove trailing / if present and split
    const cleanDefs = definitionsStr.replace(/\/\s*$/, '');
    const definitions = cleanDefs.split('/').filter(d => d.trim().length > 0);

    return {
        hangul,
        hanja,
        romanization,
        definitions
    };
}

/**
 * Insert batch into PostgreSQL
 */
async function insertBatch(client: pg.Client, entries: KEdictEntry[]): Promise<number> {
    if (entries.length === 0) return 0;

    const values: any[] = [];
    const placeholders: string[] = [];
    
    entries.forEach((entry, i) => {
        const base = i * 5;
        placeholders.push(`($${base + 1}, $${base + 2}, $${base + 3}, $${base + 4}, $${base + 5})`);
        values.push(
            'ko',  // language
            entry.hangul,
            entry.hanja,
            entry.romanization,
            JSON.stringify(entry.definitions)
        );
    });

    const query = `
        INSERT INTO dictionaryentries (language, word1, word2, pronunciation, definitions)
        VALUES ${placeholders.join(', ')}
    `;

    const result = await client.query(query, values);
    return result.rowCount || 0;
}

/**
 * Main import
 */
async function importKEDICT() {
    const filePath = process.argv[2] || '/home/cow/data/dictionaries/cc-kedict.txt';
    
    console.log('🇰🇷 CC-KEDICT Korean Dictionary Import');
    console.log('=======================================\n');
    
    console.log('📄 Reading file:', filePath);
    if (!fs.existsSync(filePath)) {
        console.error('❌ File not found. Please run the download script first.');
        process.exit(1);
    }

    const content = fs.readFileSync(filePath, 'utf-8');
    console.log(`   File size: ${(content.length / 1024 / 1024).toFixed(2)} MB`);
    
    // Try to detect line endings and split appropriately
    let lines: string[];
    if (content.includes('\r\n')) {
        lines = content.split('\r\n');
        console.log('   Detected Windows line endings (\\r\\n)');
    } else if (content.includes('\n')) {
        lines = content.split('\n');
        console.log('   Detected Unix line endings (\\n)');
    } else if (content.includes('\r')) {
        lines = content.split('\r');
        console.log('   Detected Mac line endings (\\r)');
    } else {
        lines = [content];
        console.log('   No line endings detected');
    }
    
    console.log(`   Found ${lines.length} lines`);
    
    // Debug: Show first few lines
    if (lines.length > 0) {
        console.log('\n🔍 Debug: First 3 lines:');
        for (let i = 0; i < Math.min(3, lines.length); i++) {
            console.log(`   Line ${i + 1}: ${lines[i].substring(0, 100)}${lines[i].length > 100 ? '...' : ''}`);
        }
        console.log('');
    }

    console.log('🔍 Parsing entries...');
    const entries: KEdictEntry[] = [];
    
    for (const line of lines) {
        const entry = parseKEDICTLine(line);
        if (entry) {
            entries.push(entry);
        }
    }

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

    console.log('🗑️  Clearing existing Korean entries...');
    await client.query("DELETE FROM dictionaryentries WHERE language = 'ko'");
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

importKEDICT().catch(error => {
    console.error('❌ Fatal error:', error);
    process.exit(1);
});
