/**
 * Spanish Dictionary Import — STAGING TABLE
 *
 * Parses doozan/spanish_data `es-en.data` (enwiktionary_wordlist block format)
 * and loads it into a *temporary* staging table `dictionaryentries_es_temp`
 * for inspection / manipulation BEFORE merging into the real `dictionaryentries_zh` (det).
 *
 * The staging table is a structural clone of `dictionaryentries_zh` (so a later
 * merge lines up column-for-column) plus one extra `raw` jsonb column that
 * preserves the full parsed structure (pos → gender/etymology/glosses → syn/q/usage)
 * so nothing from the source is lost during staging.
 *
 * Source format (blocks separated by a line "_____"):
 *   <headword>
 *   pos: <tag>
 *     meta: {{...}}
 *     g: <gender>
 *     etymology: <text>
 *     gloss: <english def>
 *       syn: <synonym>
 *       q: <qualifier>
 *     gloss: <english def>
 *   pos: <tag2>
 *     ...
 *
 * Usage: node --loader ts-node/esm server/scripts/import-esdict-temp.ts [file_path]
 * Default path: /home/cow/data/dictionaries/spanish_data/es-en.data
 */

import fs from 'fs';
import pg from 'pg';

const BATCH_SIZE = 1000;
const DEFAULT_PATH = '/home/cow/data/dictionaries/spanish_data/es-en.data';
const TEMP_TABLE = 'dictionaryentries_es_temp';

interface Gloss {
    text: string;
    syn?: string[];
    q?: string[];
    usage?: string[];
}

interface PosBlock {
    pos: string;
    gender?: string;       // from `g:` (m / f / mf / ...)
    meta?: string;
    etymology?: string;
    glosses: Gloss[];
}

interface EsEntry {
    word: string;
    pos: PosBlock[];
}

/** Count leading spaces to determine nesting depth. */
function indentOf(line: string): number {
    let n = 0;
    while (n < line.length && line[n] === ' ') n++;
    return n;
}

/** Split a "key: value" line into [key, value]; returns null if not a key line. */
function splitKeyValue(trimmed: string): [string, string] | null {
    const idx = trimmed.indexOf(':');
    if (idx === -1) return null;
    const key = trimmed.slice(0, idx);
    // Reject if the "key" has spaces — it's not a real key line, just prose with a colon.
    if (/\s/.test(key)) return null;
    let value = trimmed.slice(idx + 1);
    if (value.startsWith(' ')) value = value.slice(1);
    return [key, value];
}

/**
 * Parse the whole es-en.data file into structured entries.
 * State machine tracks the current entry, current pos block, and current gloss
 * (so doubly-indented syn/q/usage lines attach to the right gloss).
 */
function parseEsData(content: string): EsEntry[] {
    const entries: EsEntry[] = [];
    const lines = content.split('\n');

    let current: EsEntry | null = null;
    let currentPos: PosBlock | null = null;
    let currentGloss: Gloss | null = null;
    let expectHeadword = false;

    const flush = () => {
        if (current && current.pos.length > 0) entries.push(current);
        current = null;
        currentPos = null;
        currentGloss = null;
    };

    for (const rawLine of lines) {
        if (rawLine === '_____') {
            flush();
            expectHeadword = true;
            continue;
        }
        if (rawLine.trim() === '') continue;

        if (expectHeadword) {
            current = { word: rawLine.trim(), pos: [] };
            currentPos = null;
            currentGloss = null;
            expectHeadword = false;
            continue;
        }

        if (!current) continue; // defensive: stray lines before first headword

        const indent = indentOf(rawLine);
        const kv = splitKeyValue(rawLine.trim());
        if (!kv) continue;
        const [key, value] = kv;

        if (indent === 0 && key === 'pos') {
            currentPos = { pos: value.trim(), glosses: [] };
            current.pos.push(currentPos);
            currentGloss = null;
            continue;
        }

        if (!currentPos) continue;

        if (indent <= 2) {
            // pos-level attributes
            switch (key) {
                case 'meta': currentPos.meta = value; break;
                case 'g': currentPos.gender = value.trim(); break;
                case 'etymology': currentPos.etymology = value; break;
                case 'gloss':
                    currentGloss = { text: value.trim() };
                    currentPos.glosses.push(currentGloss);
                    break;
                // usage/q at pos level — attach to pos via a synthetic note on the
                // most recent gloss if present, else ignore (rare).
                case 'usage':
                case 'q':
                    if (currentGloss) {
                        (currentGloss[key] ||= []).push(value.trim());
                    }
                    break;
            }
        } else {
            // gloss-level attributes (syn / q / usage), indent >= 4
            if (currentGloss && (key === 'syn' || key === 'q' || key === 'usage')) {
                (currentGloss[key] ||= []).push(value.trim());
            }
        }
    }
    flush();
    return entries;
}

/** Flatten a parsed entry into the det-aligned staging columns. */
function toRow(entry: EsEntry) {
    const partsOfSpeech = [...new Set(entry.pos.map(p => p.pos))];
    const definitions: string[] = [];
    for (const p of entry.pos) {
        for (const g of p.glosses) {
            if (g.text) definitions.push(g.text);
        }
    }
    // Etymologies (deduped) → etymology column (NOT longDefinition; longDefinition
    // is reserved for the AI-generated definition elaboration backfill). See
    // migration 59-add-etymology-to-dictionaryentries-es.sql.
    const etys = [...new Set(entry.pos.map(p => p.etymology).filter(Boolean) as string[])];
    const etymology = etys.length ? etys.join('\n\n') : null;

    return {
        word1: entry.word,
        partsOfSpeech,
        definitions,
        etymology,
        raw: entry.pos, // full lossless structure
    };
}

async function ensureTempTable(client: pg.Client) {
    // Clone the structure of det so a future merge lines up column-for-column,
    // give the staging table its own id sequence (don't advance det's sequence),
    // and add a `raw` jsonb column to preserve the full parsed structure.
    await client.query(`DROP TABLE IF EXISTS ${TEMP_TABLE}`);
    await client.query(`CREATE TABLE ${TEMP_TABLE} (LIKE dictionaryentries_zh INCLUDING DEFAULTS)`);
    await client.query(`ALTER TABLE ${TEMP_TABLE} ALTER COLUMN id DROP DEFAULT`);
    await client.query(`DROP SEQUENCE IF EXISTS ${TEMP_TABLE}_id_seq`);
    await client.query(`CREATE SEQUENCE ${TEMP_TABLE}_id_seq OWNED BY ${TEMP_TABLE}.id`);
    await client.query(`ALTER TABLE ${TEMP_TABLE} ALTER COLUMN id SET DEFAULT nextval('${TEMP_TABLE}_id_seq')`);
    await client.query(`ALTER TABLE ${TEMP_TABLE} ADD COLUMN raw jsonb`);
    // The temp table clones dictionaryentries_zh, which has no `etymology` column
    // (etymology is Spanish-only, added by migration 59). Add it here so staged
    // rows line up with dictionaryentries_es on merge.
    await client.query(`ALTER TABLE ${TEMP_TABLE} ADD COLUMN IF NOT EXISTS etymology text`);
}

async function insertBatch(client: pg.Client, rows: ReturnType<typeof toRow>[]): Promise<number> {
    if (rows.length === 0) return 0;
    const values: any[] = [];
    const placeholders: string[] = [];
    const COLS = 6; // language, word1, partsOfSpeech, definitions, etymology, raw
    rows.forEach((row, i) => {
        const b = i * COLS;
        placeholders.push(`($${b + 1}, $${b + 2}, $${b + 3}, $${b + 4}, $${b + 5}, $${b + 6})`);
        values.push(
            'es',
            row.word1,
            JSON.stringify(row.partsOfSpeech),
            JSON.stringify(row.definitions),
            row.etymology,
            JSON.stringify(row.raw),
        );
    });
    const query = `
        INSERT INTO ${TEMP_TABLE} (language, word1, "partsOfSpeech", definitions, etymology, raw)
        VALUES ${placeholders.join(', ')}
    `;
    const result = await client.query(query, values);
    return result.rowCount || 0;
}

async function main() {
    const filePath = process.argv[2] || DEFAULT_PATH;

    console.log('🇪🇸 Spanish Dictionary Import → STAGING TABLE');
    console.log('=============================================\n');
    console.log('📄 Reading file:', filePath);
    if (!fs.existsSync(filePath)) {
        console.error('❌ File not found:', filePath);
        process.exit(1);
    }

    const content = fs.readFileSync(filePath, 'utf-8');
    console.log('🔍 Parsing entries...');
    const entries = parseEsData(content);
    console.log(`✅ Parsed ${entries.length} headwords`);

    const rows = entries.map(toRow).filter(r => r.definitions.length > 0);
    console.log(`✅ ${rows.length} headwords have at least one gloss\n`);

    const client = new pg.Client({
        host: process.env.DB_HOST || 'cow-postgres-local',
        port: parseInt(process.env.DB_PORT || '5432'),
        database: process.env.DB_NAME || 'cow_db',
        user: process.env.DB_USER || 'cow_user',
        password: process.env.DB_PASSWORD || 'cow_password_local',
    });
    await client.connect();
    console.log('✅ Connected to PostgreSQL');

    console.log(`🛠️  (Re)creating staging table ${TEMP_TABLE}...`);
    await ensureTempTable(client);
    console.log('✅ Staging table ready\n');

    console.log(`💾 Inserting ${rows.length} rows in batches of ${BATCH_SIZE}...`);
    let total = 0;
    const start = Date.now();
    for (let i = 0; i < rows.length; i += BATCH_SIZE) {
        total += await insertBatch(client, rows.slice(i, i + BATCH_SIZE));
        if (i % (BATCH_SIZE * 10) === 0) {
            console.log(`   Progress: ${total}/${rows.length} (${Math.round((total / rows.length) * 100)}%)`);
        }
    }
    const duration = ((Date.now() - start) / 1000).toFixed(2);
    console.log(`\n✅ Import complete! ${total} rows in ${duration}s`);

    await client.end();
    console.log('🔌 Connection closed');
}

main().catch(err => {
    console.error('❌ Fatal error:', err);
    process.exit(1);
});
