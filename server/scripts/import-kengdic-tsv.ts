/**
 * KENGDIC Korean Dictionary Import Script for PostgreSQL (TSV format)
 * Imports KENGDIC Korean-English dictionary data into PostgreSQL database
 * 
 * Usage: npx tsx server/scripts/import-kengdic-tsv.ts [file_path]
 * Default path: /home/cow/data/dictionaries/kengdic.tsv
 */

import fs from 'fs';
import pg from 'pg';

const BATCH_SIZE = 1000;

interface KEngDicEntry {
    hangul: string;       // word1 - Korean hangul (surface)
    hanja: string;        // word2 - Chinese characters (hanja)
    romanization: string; // pronunciation - romanization (generated)
    definitions: string[];
}

/**
 * Simple Korean romanization (Revised Romanization)
 * This is a basic implementation - for production, consider using a proper library
 */
function romanizeHangul(hangul: string): string {
    // For now, return empty string - romanization can be added later or via library
    // A proper implementation would use a Korean romanization library like 'hangul-romanization'
    return '';
}

/**
 * Parse a TSV line from KENGDIC
 * Format: id\tsurface\thanja\tgloss\tlevel\tcreated\tsource
 */
function parseKEngDicLine(line: string, lineNumber: number): KEngDicEntry | null {
    const parts = line.split('\t');
    
    // Skip header line
    if (lineNumber === 1 || parts.length < 4) {
        return null;
    }

    const hangul = parts[1]?.trim();
    const hanja = parts[2]?.trim();
    const gloss = parts[3]?.trim();

    // Skip if no hangul or no gloss
    if (!hangul || !gloss) {
        return null;
    }

    // romanization from hangul (basic implementation)
    const romanization = romanizeHangul(hangul);

    return {
        hangul,
        hanja: hanja || '',
        romanization,
        definitions: [gloss] // Single definition from gloss column
    };
}

/**
 * Insert batch into PostgreSQL
 */
async function insertBatch(client: pg.Client, entries: KEngDicEntry[]): Promise<number> {
    if (entries.length === 0) return 0;

    const values: any[] = [];
    const placeholders: string[] = [];
    
    entries.forEach((entry, i) => {
        const base = i * 5;
        placeholders.push(`($${base + 1}, $${base + 2}, $${base + 3}, $${base + 4}, $${base + 5})`);
        values.push(
            'ko',  // language
            entry.hangul,
            entry.hanja || null,
            entry.romanization || null,
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
async function importKEngDic() {
    const filePath = process.argv[2] || '/home/cow/data/dictionaries/kengdic.tsv';
    
    console.log('🇰🇷 KENGDIC Korean Dictionary Import (TSV format)');
    console.log('================================================\n');
    
    console.log('📄 Reading file:', filePath);
    if (!fs.existsSync(filePath)) {
        console.error('❌ File not found.');
        process.exit(1);
    }

    const content = fs.readFileSync(filePath, 'utf-8');
    const lines = content.split('\n');
    console.log(`   Found ${lines.length} lines`);

    console.log('🔍 Parsing entries...');
    const entries: KEngDicEntry[] = [];
    
    for (let i = 0; i < lines.length; i++) {
        const entry = parseKEngDicLine(lines[i], i + 1);
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

    console.log('🗑️  Clearing existing Korean entries...');
    await client.query("DELETE FROM DictionaryEntries WHERE language = 'ko'");
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

importKEngDic().catch(error => {
    console.error('❌ Fatal error:', error);
    process.exit(1);
});
