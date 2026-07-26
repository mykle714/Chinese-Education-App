/**
 * Generate the component subset webfont for the word search No Pinyin hint row.
 *
 * LAYER: build/asset generation for the data-enrichment pipeline. Reads
 * dictionaryentries_zh.components, writes a woff2 into the client's asset tree.
 *
 * ─────────────────────────────────────────────────────────────────────────────
 * WHY THIS EXISTS
 *
 * index.html loads Noto Sans SC from Google Fonts. Google subsets CJK webfonts by
 * CHARACTER FREQUENCY, not by Unicode block — so a meaningful slice of the component
 * glyphs we store is simply not served, and would fall back to whatever CJK face the
 * OS supplies (or render as tofu on Android). Measured against the discoverable set:
 * 20 of 462 components (~4%) are missing, including ⺀ ⺮ ⺼ 㐬 耂 ⺌ 龹 殸 ⺈ 兟 矦 ⺍.
 *
 * A hint whose entire job is "match this SHAPE to a character in the grid" is broken
 * if the shape renders in a different typeface than the grid, and useless if it renders
 * as a box. So we self-host a subset of the SAME typeface (full Noto Sans SC, which does
 * cover every component) containing exactly the glyphs in use.
 *
 * The client puts this font FIRST in the stack and lets the browser fall back per glyph:
 *     font-family: "HanziComponents", "Noto Sans SC", …
 * Because it is the same typeface, the seam is invisible.
 *
 * ─────────────────────────────────────────────────────────────────────────────
 * WHY THE SUBSET IS "ALL COMPONENTS IN USE", NOT "ONLY THE MISSING ONES"
 *
 * Subsetting to just the ~20 glyphs Google omits would produce a ~6 KB file instead of
 * ~91 KB. It was rejected: it silently depends on Google's current subsetting, which is
 * theirs to change at any time, and the failure mode is invisible tofu in production
 * with nothing in our repo having changed. Including every component in use makes the
 * asset correct by construction. It is lazy-loaded by the word search page only.
 *
 * ─────────────────────────────────────────────────────────────────────────────
 * LICENSING
 *
 * Source face is Noto Sans SC, SIL Open Font License 1.1 (server/data/hanzi/
 * NotoSansSC-OFL.txt). OFL explicitly permits subsetting and redistribution. Its
 * Reserved Font Name is 'Source' (the face derives from Source Han Sans), NOT 'Noto',
 * so the generated family name below is unencumbered — but it must never contain
 * "Source". The OFL notice ships alongside the font and must not be removed.
 *
 * USAGE
 *   docker exec cow-backend-local npx tsx scripts/backfill/chinese/generate-component-font.js
 *   ... --all       include components of EVERY single-char row, not just those
 *                   reachable from discoverable words (larger file, future-proof)
 */
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import subsetFont from 'subset-font';
import db from '../../../db.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
// chinese/ is at server/scripts/backfill/chinese → server/ is three levels up.
const SERVER_DIR = path.resolve(__dirname, '..', '..', '..');

// ⚠️ PATHS DIFFER BETWEEN HOST AND CONTAINER. These scripts are normally run via
// `docker exec cow-backend-local`, where server/ is mounted at /app and the REPO ROOT
// is mounted separately at /app/project-root — so /app/.. is `/`, not the repo. Probe
// for the container layout first and fall back to the host layout.
const CONTAINER_REPO_ROOT = '/app/project-root';
const REPO_ROOT = fs.existsSync(CONTAINER_REPO_ROOT)
    ? CONTAINER_REPO_ROOT
    : path.resolve(SERVER_DIR, '..');

// The shared data dir is the REPO-ROOT `data/` (mounted at /app/data in the container),
// alongside chinese-dictionary.txt and dictionaries/ — not a server-local folder.
const SOURCE_FONT = path.join(SERVER_DIR, 'data', 'hanzi', 'NotoSansSC-VF.ttf');
const OUTPUT_FONT = path.join(REPO_ROOT, 'src', 'assets', 'fonts', 'hanzi-components.woff2');

const includeAll = process.argv.includes('--all');

async function generateComponentFont() {
    console.log('Generating component subset webfont...\n');

    if (!fs.existsSync(SOURCE_FONT)) {
        throw new Error(
            `Source font missing: ${SOURCE_FONT}\n` +
            `It is committed to the repo — restore it from git rather than re-downloading, ` +
            `so the generated subset stays byte-reproducible.`
        );
    }

    const client = await db.getClient();
    let componentRows;
    try {
        // Default scope: components of characters that appear in a DISCOVERABLE word —
        // the only characters the word search can ever put on a grid. `--all` widens to
        // every single-char row, trading file size for not needing a rerun later.
        componentRows = await client.query(
            includeAll
                ? `SELECT components FROM dictionaryentries_zh
                   WHERE components IS NOT NULL AND jsonb_array_length(components) > 0`
                : `SELECT c.components
                   FROM dictionaryentries_zh c
                   WHERE c.language = 'zh'
                     AND char_length(c.word1) = 1
                     AND c.components IS NOT NULL
                     AND jsonb_array_length(c.components) > 0
                     AND EXISTS (
                       SELECT 1 FROM dictionaryentries_zh w
                       WHERE w.language = 'zh'
                         AND w.discoverable = TRUE
                         AND position(c.word1 in w.word1) > 0
                     )`
        );
    } finally {
        client.release();
    }

    const glyphs = new Set();
    for (const row of componentRows.rows) {
        // The column is jsonb; the driver may hand back a parsed array or a string
        // depending on how it was written. Normalize defensively rather than assume.
        const parts = typeof row.components === 'string' ? JSON.parse(row.components) : row.components;
        if (Array.isArray(parts)) for (const part of parts) glyphs.add(part);
    }

    if (glyphs.size === 0) {
        throw new Error(
            'No components found in dictionaryentries_zh. Run backfill-character-components.js first.'
        );
    }

    const text = [...glyphs].join('');
    console.log(`  scope:      ${includeAll ? 'all single-char rows' : 'characters in discoverable words'}`);
    console.log(`  rows read:  ${componentRows.rows.length.toLocaleString()}`);
    console.log(`  glyphs:     ${glyphs.size.toLocaleString()}`);

    const subset = await subsetFont(fs.readFileSync(SOURCE_FONT), text, { targetFormat: 'woff2' });

    fs.mkdirSync(path.dirname(OUTPUT_FONT), { recursive: true });
    fs.writeFileSync(OUTPUT_FONT, subset);

    console.log(`\n✅ Wrote ${path.relative(REPO_ROOT, OUTPUT_FONT)} — ${(subset.length / 1024).toFixed(1)} KB`);
    console.log('   Commit this file; the client imports it as a @font-face source.');
}

generateComponentFont()
    .then(() => process.exit(0))
    .catch((err) => {
        console.error('❌ Font generation failed:', err);
        process.exit(1);
    });
