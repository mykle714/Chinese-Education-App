/**
 * Backfill dictionaryentries_zh.components — the sub-character VISUAL PARTS of every
 * single-character entry (想 → ["相","心"]).
 *
 * LAYER: data-enrichment (backfill). Deterministic — no AI, no API spend, free to
 * re-run. The only external input is the cached decomposition file (see lib/decompose.js).
 *
 * Feeds the word search **No Pinyin** hint ladder: reveal a character's parts one at a
 * time, then the character itself, then its grid location. See docs/WORD_SEARCH_GAME.md.
 *
 * ⚠️ NOT the same as backfill-dictionary-breakdown.js. That one decomposes a WORD into
 * its characters and glosses each; this one decomposes a CHARACTER into the shapes it
 * is written from. Different column, different rows, one level apart. See migration 125.
 *
 * ─────────────────────────────────────────────────────────────────────────────
 * SCOPE — why there is NO `discoverable` gate
 *
 * Most backfills gate on `discoverable = TRUE` because they cost API money. This one is
 * free, and a discoverable gate would be actively WRONG here: the characters that need
 * components are the ones appearing INSIDE discoverable multi-character words, and those
 * single-character rows are frequently not discoverable in their own right. Gating would
 * silently skip most of the set. So the default target is every single-character zh row.
 *
 * ─────────────────────────────────────────────────────────────────────────────
 * ⚠️ AFTER RUNNING THIS, REGENERATE THE COMPONENT WEBFONT:
 *     docker exec cow-backend-local npx tsx scripts/backfill/chinese/generate-component-font.js
 * ~4% of components are absent from the Google-hosted Noto Sans SC webfont, so without
 * that step newly-introduced components render as tofu on the client.
 *
 * USAGE
 *   docker exec cow-backend-local npx tsx scripts/backfill/chinese/backfill-character-components.js
 *   ... --words=想,从,江     scope to specific characters
 *   ... --force              recompute rows that already have components
 *   ... --stale              also reprocess rows stamped below SCRIPT_VERSION
 *   ... --limit=100          cap the number of rows written
 *   ... --spot-check         decompose 20 rows, print them, write NOTHING
 *   ... --refresh-source     re-download the decomposition data before running
 */
import db from '../../../db.js';
import { initRunLog } from '../run-log.js';
import { loadDecompositions, componentsOf, orderByFrequency } from './lib/decompose.js';

// v2: replaced flat level-1 decomposition with the radical-stop policy (RULE 1/RULE 2
// in lib/decompose.js) — radicals became atomic ([]) and compound parts like 相 now
// expand, so every row written by v1 is stale.
const SCRIPT_VERSION = 2;
const { stampEntries, staleClause } = initRunLog({
    script: 'chinese/backfill-character-components',
    version: SCRIPT_VERSION,
});

// ── flags ────────────────────────────────────────────────────────────────────
const argOf = (name) => {
    const arg = process.argv.find((a) => a.startsWith(`--${name}=`));
    return arg ? arg.slice(name.length + 3) : null;
};
const targetWords = (argOf('words') || '').split(',').map((s) => s.trim()).filter(Boolean);
const isForce = process.argv.includes('--force');
const isStale = process.argv.includes('--stale');
const isSpotCheck = process.argv.includes('--spot-check');
const refreshSource = process.argv.includes('--refresh-source');
const limit = Number.parseInt(argOf('limit') || '', 10) || null;

const wordsFilter = targetWords.length
    ? `AND word1 = ANY(ARRAY[${targetWords.map((w) => `'${w.replace(/'/g, "''")}'`).join(', ')}])`
    : '';
// --force/--words recompute regardless; --stale adds version-stamped rows; default is
// "never computed". An explicitly-targeted run always recomputes what it was pointed at.
const componentsGate =
    isForce || targetWords.length
        ? 'TRUE'
        : isStale
          ? `(components IS NULL OR ${staleClause()})`
          : 'components IS NULL';

async function backfillCharacterComponents() {
    console.log('Starting character components backfill...\n');
    if (targetWords.length) console.log(`🎯 Scoped to: ${targetWords.join(', ')}`);
    if (isSpotCheck) console.log('🔍 SPOT CHECK — no writes will be made.\n');

    const ids = await loadDecompositions({ refresh: refreshSource });
    console.log(`📖 Decomposition source: ${ids.size.toLocaleString()} characters\n`);

    const client = await db.getClient();
    try {
        // ── Pass 1: component FREQUENCY is computed over the WHOLE single-char table,
        // independent of which rows this run happens to write. Ordering must not shift
        // just because the run was scoped with --words or --limit.
        const corpus = await client.query(`
            SELECT word1 FROM dictionaryentries_zh
            WHERE language = 'zh' AND char_length(word1) = 1
        `);
        const byChar = new Map();
        for (const { word1 } of corpus.rows) {
            const parts = componentsOf(word1, ids);
            if (parts.length) byChar.set(word1, parts);
        }
        const ordered = orderByFrequency(byChar);
        console.log(
            `🔢 Frequency corpus: ${corpus.rows.length.toLocaleString()} single-char rows, ` +
            `${byChar.size.toLocaleString()} decomposable\n`
        );

        // ── Pass 2: the rows this run actually writes.
        const targets = await client.query(`
            SELECT id, word1 FROM dictionaryentries_zh
            WHERE language = 'zh'
              AND char_length(word1) = 1
              AND ${componentsGate}
              ${wordsFilter}
            ORDER BY id
            ${limit && !isSpotCheck ? `LIMIT ${limit}` : ''}
        `);
        const rows = isSpotCheck ? targets.rows.slice(0, 20) : targets.rows;
        console.log(`Found ${targets.rows.length.toLocaleString()} single-character rows to process\n`);
        if (rows.length === 0) {
            console.log('No entries to process.');
            return;
        }

        let written = 0;
        let atomic = 0;
        let noSource = 0;

        for (const row of rows) {
            // ordered.get() is absent for atomic characters (人, 口, 一) AND for
            // characters the source simply doesn't cover. We distinguish them so the
            // second group can be reported rather than silently recorded as "atomic".
            const parts = ordered.get(row.word1) ?? [];
            if (parts.length === 0) {
                if (ids.has(row.word1)) atomic++;
                else noSource++;
            }

            if (isSpotCheck) {
                const label = parts.length ? parts.join(' ') : ids.has(row.word1) ? '(atomic)' : '(no source data)';
                console.log(`  ${row.word1}  →  ${label}`);
                continue;
            }

            await client.query('UPDATE dictionaryentries_zh SET components = $1 WHERE id = $2', [
                JSON.stringify(parts),
                row.id,
            ]);
            // Stamp every examined row, including the empty ones, so a plain re-run
            // does not keep rediscovering characters that legitimately have no parts.
            await stampEntries(client, 'dictionaryentries_zh', row.id);
            written++;

            if (written % 500 === 0) console.log(`  … ${written.toLocaleString()} written`);
        }

        console.log('\n─────────────────────────────────────');
        if (isSpotCheck) {
            console.log('Spot check complete — nothing written.');
        } else {
            console.log(`✅ Written:            ${written.toLocaleString()}`);
            console.log(`   … with components:  ${(written - atomic - noSource).toLocaleString()}`);
            console.log(`   … atomic ([]):      ${atomic.toLocaleString()}`);
            console.log(`   … no source data:   ${noSource.toLocaleString()}`);
            console.log('\n⚠️  Regenerate the component webfont so new components render:');
            console.log('    npx tsx scripts/backfill/chinese/generate-component-font.js');
        }
    } finally {
        // Released in all branches — an early return or a throw above must not leak the client.
        client.release();
    }
}

backfillCharacterComponents()
    .then(() => process.exit(0))
    .catch((err) => {
        console.error('❌ Backfill failed:', err);
        process.exit(1);
    });
