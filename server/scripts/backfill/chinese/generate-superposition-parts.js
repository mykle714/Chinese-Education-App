/**
 * Generate src/games/superposition/strokeParts.json: { "<character>": [[stroke indices], ...] },
 * the strokes of each character that belong on one Superposition tile because they form a
 * natural part (氵, 口, 宀 ...). Strokes in no part are left out; the game merges them by ink.
 *
 * LAYER: data-enrichment asset generator. Dev-box only, like generate-stroke-counts.js: it
 * reads the client dependency hanzi-writer-data, and its output is COMMITTED. Only derived
 * per-character facts are written, never the decomposition source (decompose.js § licensing).
 *
 * Re-run when a list below changes or hanzi-writer-data is upgraded.
 * Usage (from server/):  node scripts/backfill/chinese/generate-superposition-parts.js
 *
 * Referenced by: docs/SUPERPOSITION_GAME.md § Stroke parts,
 * src/games/superposition/SuperpositionStage.tsx → loadCharacters.
 */
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import { loadDecompositionEntries } from './lib/decompose.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = path.resolve(__dirname, '..', '..', '..', '..');
const HANZI_DATA_DIR = path.join(REPO_ROOT, 'node_modules', 'hanzi-writer-data');
const OUT_FILE = path.join(REPO_ROOT, 'src', 'games', 'superposition', 'strokeParts.json');

/** Parts kept whole wherever they appear. A listed part is never opened: 日 holds 口. */
const WHOLE_PARTS = new Set([
    ...'亻氵讠扌纟刂阝钅忄衤礻彳冫', // side radicals
    ...'艹辶广厂冖囗灬宀', // tops, bottoms and wraps
    ...'木日土⺼月火田贝女王子见目工口', // closed shapes and common blocks
    ...'力又大攵彐夂巾', // smaller blocks
    ...'人几儿亠乂厶卜', // simple shapes kept as units
]);

/** Parts cut into set pieces, by the stroke positions inside the part. */
const SPLIT_PARTS = new Map([
    ['⺮', [[0, 1, 2], [3, 4, 5]]],
    ['门', [[0, 1], [2]]], // dot and vertical / the right frame
    ['心', [[0, 2, 3], [1]]], // three dots / the hook
    ['米', [[0, 1], [2, 3, 4, 5]]], // two dots / 木
]);

/** Radicals left to ink, because they do not read as a unit here. */
const UNGROUPED_RADICALS = new Set([
    ...'十二八丷冂匕丁七',
    ...'戈斤方寸欠白车页禾雨',
    ...'隹青其里各令',
]);

const IDS_OPERATOR = /[⿰-⿻]/;
const TERNARY_OPERATORS = new Set(['⿲', '⿳']);

/** An IDS string as a tree; each node keeps its path, the prefix `matches` entries use. */
function parseIds(ids) {
    const symbols = [...ids];
    let position = 0;
    const read = (treePath) => {
        const symbol = symbols[position++];
        if (symbol === undefined) throw new Error('truncated IDS');
        if (!IDS_OPERATOR.test(symbol)) return { part: symbol, treePath, children: [] };
        const arity = TERNARY_OPERATORS.has(symbol) ? 3 : 2;
        const children = [];
        for (let k = 0; k < arity; k++) children.push(read([...treePath, k]));
        return { part: null, treePath, children };
    };
    return read([]);
}

/** Positions in `matches` whose path runs through `treePath`. */
function strokesUnder(matches, treePath) {
    const positions = [];
    matches.forEach((match, position) => {
        if (match && treePath.every((step, depth) => match[depth] === step)) positions.push(position);
    });
    return positions;
}

/**
 * Collect the parts under `char`. `strokes` maps its local stroke positions to the top
 * character's stroke indices. Walking down: a listed part is taken and not opened, and an
 * unlisted one opens, so 语 yields 讠 then 口 inside 吾.
 */
function collectParts(char, strokes, entries, isPart, parts, isRoot) {
    const split = SPLIT_PARTS.get(char);
    if (split && split.flat().length === strokes.length) {
        for (const piece of split) parts.push(piece.map((position) => strokes[position]));
        return;
    }
    if (isPart(char)) {
        // A whole character is not a part of itself: its strokes go to ink.
        if (!isRoot && strokes.length >= 2) parts.push(strokes);
        return;
    }
    const entry = entries.get(char);
    if (!entry?.matches || entry.matches.length !== strokes.length) return;
    let tree;
    try {
        tree = parseIds(entry.ids);
    } catch {
        return;
    }
    const walk = (node) => {
        if (node.part === null) {
            node.children.forEach(walk);
            return;
        }
        if (node.part === '？') return;
        const local = strokesUnder(entry.matches, node.treePath);
        if (local.length > 0) {
            collectParts(node.part, local.map((position) => strokes[position]), entries, isPart, parts, false);
        }
    };
    walk(tree);
}

const entries = await loadDecompositionEntries();
const output = {};
for (const file of fs.readdirSync(HANZI_DATA_DIR).sort()) {
    const char = path.basename(file, '.json');
    if (!file.endsWith('.json') || [...char].length !== 1) continue;
    const glyph = JSON.parse(fs.readFileSync(path.join(HANZI_DATA_DIR, file), 'utf8'));
    const allStrokes = glyph.strokes.map((_, index) => index);
    const radical = entries.get(char)?.radical;
    const isRadical = (part) => part === radical && !UNGROUPED_RADICALS.has(part);
    const parts = [];
    collectParts(char, allStrokes, entries, (part) => WHOLE_PARTS.has(part) || isRadical(part), parts, true);

    // A radical the tree does not name (a variant, or an unmatched part) still comes from
    // radStrokes, unless its strokes are already spoken for.
    const radStrokes = glyph.radStrokes ?? [];
    const claimed = new Set(parts.flat());
    if (
        radical && !UNGROUPED_RADICALS.has(radical) &&
        radStrokes.length >= 2 && radStrokes.length < allStrokes.length &&
        !radStrokes.some((stroke) => claimed.has(stroke))
    ) {
        parts.push(radStrokes);
    }
    // One part holding every stroke would deal as a finished stack, so it goes to ink.
    const collapsed = parts.length === 1 && parts[0].length === allStrokes.length;
    if (parts.length > 0 && !collapsed) output[char] = parts;
}

fs.writeFileSync(OUT_FILE, JSON.stringify(output));
console.log(`✅ ${Object.keys(output).length} characters → ${path.relative(REPO_ROOT, OUT_FILE)} (${fs.statSync(OUT_FILE).size} bytes)`);
