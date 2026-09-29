/**
 * Character decomposition — turns one Chinese character into its sub-character
 * VISUAL PARTS (想 → 相 + 心).
 *
 * LAYER: data-enrichment (backfill) utility. Pure computation + a cached file
 * fetch; no DB access, no AI, no network at read time once the cache is warm.
 *
 * Consumed by:
 *   - backfill-character-components.js  (writes dictionaryentries_zh.components)
 *   - generate-component-font.js        (subsets the webfont to the components in use)
 *   - generate-handwriting-templates.js (componentStrokesOf → in-context variants, § 6z-5)
 *
 * ─────────────────────────────────────────────────────────────────────────────
 * SOURCE DATA & LICENSING — read before changing this file
 *
 * Decompositions come from makemeahanzi's `dictionary.txt`, whose `decomposition`
 * field is an Ideographic Description Sequence (IDS): 江 → "⿰氵工", where ⿰ is a
 * structural operator (U+2FF0..U+2FFF) and the rest are the actual parts.
 *
 * That file is **LGPLv3** (derived from Unihan + CJKlib). It is a BUILD-TIME INPUT
 * ONLY: fetched on demand into a gitignored cache, never committed, never bundled,
 * never served to a client. Only derived per-character facts reach the database.
 *
 * The obvious alternative, cjkvi-ids `ids.txt`, is **GPLv2** (derived from CHISE) and
 * was rejected for that reason. It also measured WORSE: 91.5% vs 97.6% of the
 * characters in discoverable words yielded at least one usable component.
 *
 * ─────────────────────────────────────────────────────────────────────────────
 * HOW DEEP TO DECOMPOSE — the two rules
 *
 * Neither "always level 1" nor "recurse to the bottom" works. Raw level-1 output is
 * wrong in BOTH directions at once:
 *
 *   口 → [冂 一]      OVER-decomposed: 口 is itself an atomic building block
 *   月 → [冂 二]      likewise 月, 木, 目, 日, 大, 行 …
 *   想 → [相 心]      UNDER-decomposed: 相 is a compound and should open up
 *
 * ...while unrestricted recursion collapses into stroke noise:
 *   行 → [彳 一 一]    议 → [讠 丶 丿]    典 → [曰 丨 丨 八]
 *
 * So the policy is:
 *
 *   RULE 1 — A character that IS a radical is ATOMIC. It has no sub-hint worth
 *            revealing, so it yields []. Fixes 口 月 木 目 日 大 行.
 *
 *   RULE 2 — Expand a part only when its expansion is a CLEAN RADICAL COMPOUND:
 *            at least two pieces, every piece a SOLID (non-stroke) radical.
 *            Otherwise keep the part whole.
 *              相 → 木 + 目   both solid radicals → expand, so 想 → [木 目 心]
 *              义 → 丶 + 乂   丶 is a stroke, 乂 is no radical → keep 义 whole
 *              曲 → 曰 + 丨丨 strokes → keep 曲 whole, so 典 → [曲 八]
 *
 * The stroke carve-out matters because six Kangxi radicals (一 丨 丶 丿 乙 亅) are
 * single strokes: without excluding them, "is a radical" would wave through exactly
 * the stroke-noise expansions we are trying to prevent.
 *
 * Result over the 784 characters in discoverable words (re-measured 2026-09-07):
 * average 2.09 components, max 6, only 6 characters exceeding 4 components.
 *
 * ─────────────────────────────────────────────────────────────────────────────
 * WHY THE BOUND FORM IS KEPT (氵 not 水, ⺮ not 竹)
 *
 * The hint's job is "find the character in the grid containing THIS SHAPE". So the
 * shape as it actually appears is what we want — 江 shows 氵, not 水.
 *
 * We deliberately do NOT apply Unicode's EquivalentUnifiedIdeograph.txt mapping here.
 * That table is SEMANTIC, not visual, and gets the important cases wrong for us:
 *   ⺼ → 肉   right meaning, completely wrong shape (the player sees 月)
 *   ⺮ → 𥫗   maps to a rare Ext-B ideograph that is itself unrenderable
 * Keeping the source's own bound form avoids both problems. The cost is that ~4% of
 * components are missing from the Google-hosted Noto Sans SC webfont — which is what
 * generate-component-font.js exists to fix.
 */
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
// lib/ is at server/scripts/backfill/chinese/lib → server/ is four levels up.
// NOTE: `<server>/data` is the REPO-ROOT `data/` directory — the container mounts
// /home/cow/data at /app/data, alongside chinese-dictionary.txt and dictionaries/.
// The vendored source font lives beside this cache at data/hanzi/NotoSansSC-VF.ttf.
const SERVER_DIR = path.resolve(__dirname, '..', '..', '..', '..');
const CACHE_DIR = path.join(SERVER_DIR, 'data', 'hanzi', 'cache');
const CACHE_PATH = path.join(CACHE_DIR, 'makemeahanzi-dictionary.txt');
const SOURCE_URL =
  'https://raw.githubusercontent.com/skishore/makemeahanzi/master/dictionary.txt';

// Ideographic Description Characters — structural operators (⿰ ⿱ ⿲ ⿳ ⿴ …), not parts.
const IDC = /[⿰-⿿]/;
// makemeahanzi writes '？' for a part it cannot express as a codepoint at all.
const UNKNOWN_PART = '？';

// The 214 Kangxi radicals in their UNIFIED ideograph forms. Derived once from the
// Kangxi Radicals block (U+2F00..U+2FD5) via Unicode's EquivalentUnifiedIdeograph.txt
// and embedded here so the pipeline needs no second data download. Order is radical
// number 1..214; nothing depends on the order, only on membership.
const KANGXI_RADICALS =
    '一丨丶丿乙亅二亠人儿入八冂冖冫几凵刀力勹匕匚匸十卜卩厂厶又口囗土士夂夊夕大女子宀寸小尢尸屮山巛工己巾干幺广' +
    '廴廾弋弓彐彡彳心戈戶手支攴文斗斤方无日曰月木欠止歹殳毋比毛氏气水火爪父爻爿片牙牛犬玄玉瓜瓦甘生用田疋疒癶白' +
    '皮皿目矛矢石示禸禾穴立竹米糸缶网羊羽老而耒耳聿肉臣自至臼舌舛舟艮色艸虍虫血行衣襾見角言谷豆豕豸貝赤走足身車' +
    '辛辰辵邑酉釆里金長門阜隶隹雨靑非面革韋韭音頁風飛食首香馬骨高髟鬥鬯鬲鬼魚鳥鹵鹿麥麻黃黍黑黹黽鼎鼓鼠鼻齊齒龍龜龠';

// A component counts as a "unit" — something worth showing as a hint and a valid place
// to stop recursing — if it is a radical in any of these guises:
//   * one of the 214 above (the traditional/unified form),
//   * anything in the CJK Radicals Supplement block (⺮ ⺼ ⺈ …), which is where the
//     bound positional forms live,
//   * a simplified or bound variant that happens to sit in CJK Unified (氵 亻 钅 讠 …)
//     and therefore appears in neither of the first two sets.
const RADICALS = new Set([
    ...KANGXI_RADICALS,
    ...Array.from({ length: 0x2ef3 - 0x2e80 + 1 }, (_, i) => String.fromCodePoint(0x2e80 + i)),
    ...'氵亻忄扌艹辶讠钅阝彳纟饣犭牜礻衤月覀罒爫',
]);

// Kangxi radicals 1-6 (一 丨 丶 丿 乙 亅) and their variants are single STROKES. They
// are legitimate PARTS — 尽 really does contain 丶 — but an expansion that yields only
// strokes is noise, so they never justify expanding a part (see RULE 2 in the header).
const STROKES = new Set([...'一丨丶丿乙亅乚乛乀乁㇀㇉丷']);
const isSolidRadical = (char) => RADICALS.has(char) && !STROKES.has(char);

/**
 * Fetch (and cache) the decomposition source and parse every entry. Network is
 * only touched on a cold cache; every later run reads the local file.
 *
 * @param {{ refresh?: boolean }} [opts] refresh: re-download even if cached.
 * @returns {Promise<Map<string, { ids: string, matches: Array<number[] | null> | null }>>}
 */
export async function loadDecompositionEntries({ refresh = false } = {}) {
    if (refresh || !fs.existsSync(CACHE_PATH)) {
        fs.mkdirSync(CACHE_DIR, { recursive: true });
        console.log(`⬇️  Fetching decomposition data → ${path.relative(SERVER_DIR, CACHE_PATH)}`);
        const res = await fetch(SOURCE_URL);
        if (!res.ok) {
            throw new Error(
                `Failed to fetch decomposition data (HTTP ${res.status}) from ${SOURCE_URL}. ` +
                `This is a build-time input; check network access or supply the file manually.`
            );
        }
        fs.writeFileSync(CACHE_PATH, Buffer.from(await res.arrayBuffer()));
    }

    const map = new Map();
    let malformed = 0;
    // One JSON object per line. A single bad line must not abort a 9k-row backfill,
    // so parse defensively and report the count rather than throwing.
    for (const line of fs.readFileSync(CACHE_PATH, 'utf8').split('\n')) {
        if (!line.trim()) continue;
        try {
            const entry = JSON.parse(line);
            if (entry?.character && entry?.decomposition) {
                map.set(entry.character, {
                    ids: entry.decomposition,
                    matches: Array.isArray(entry.matches) ? entry.matches : null,
                });
            }
        } catch {
            malformed++;
        }
    }
    if (malformed) console.warn(`⚠️  Skipped ${malformed} malformed line(s) in the decomposition cache.`);
    if (map.size === 0) {
        throw new Error(`Decomposition cache at ${CACHE_PATH} yielded no entries — delete it and re-run to re-fetch.`);
    }
    return map;
}

/**
 * The decomposition source as character → raw IDS string — the shape
 * `componentsOf` takes.
 *
 * @param {{ refresh?: boolean }} [opts] refresh: re-download even if cached.
 * @returns {Promise<Map<string, string>>} character → raw IDS string
 */
export async function loadDecompositions(opts) {
    const entries = await loadDecompositionEntries(opts);
    return new Map([...entries].map(([char, entry]) => [char, entry.ids]));
}

/** Immediate parts of one character straight from its IDS, structure stripped. */
function rawParts(char, idsOf) {
    const seq = idsOf(char);
    if (!seq) return [];
    return [...seq].filter(
        (part) => !IDC.test(part) && part !== UNKNOWN_PART && part !== char
    );
}

// ⿲ and ⿳ describe three side-by-side / stacked parts; every other operator two.
const TERNARY_IDC = new Set(['⿲', '⿳']);

/**
 * Parse an IDS string into a tree, so a makemeahanzi `matches` PATH ([1, 0] =
 * "child 0 of child 1") can be resolved to the leaf it names.
 *
 * Leaves are numbered in PREORDER, which is also their order in the IDS string —
 * so the kept leaves line up one-for-one with `rawParts`.
 *
 * @returns {{ resolve: (path: number[]) => number | null, leaves: string[] } | null}
 *          null when the string is not a single well-formed IDS expression.
 */
function parseIdsTree(seq) {
    const chars = [...seq];
    const leaves = [];
    let pos = 0;
    function node() {
        const c = chars[pos++];
        if (c === undefined) throw new Error('truncated IDS');
        if (!IDC.test(c)) {
            leaves.push(c);
            return { leaf: leaves.length - 1 };
        }
        const arity = TERNARY_IDC.has(c) ? 3 : 2;
        const children = [];
        for (let k = 0; k < arity; k++) children.push(node());
        return { children };
    }
    let root;
    try {
        root = node();
    } catch {
        return null;
    }
    if (pos !== chars.length) return null;
    return {
        leaves,
        resolve(path) {
            let current = root;
            for (const step of path) {
                current = current.children?.[step];
                if (!current) return null;
            }
            // A path that stops at an operator names several leaves at once —
            // no single part owns the stroke.
            return current.leaf ?? null;
        },
    };
}

/**
 * The one recursion behind both `componentsOf` and `componentStrokesOf`, so the
 * parts a character decomposes to and the parts its strokes are labelled with
 * can never disagree.
 *
 * Returns the parts (RULE 1 / RULE 2 in this file's header) and, when `matchesOf`
 * knows the character, a per-stroke array of indices INTO `parts` (null for a
 * stroke no single part owns). Labels are indices rather than glyphs so the two
 * 人 of 从 stay distinguishable.
 */
function decompose(char, idsOf, matchesOf) {
    return expand(char, 0, new Set([char]));

    function expand(current, depth, seen) {
        const partsHere = rawParts(current, idsOf);
        const parts = [];
        // Per raw part: where its output starts in `parts`, and its sub-labels when
        // it was opened up.
        const placements = [];
        for (const part of partsHere) {
            // Stop at radicals, at the depth cap, and on the self-referential cycles a
            // few source entries contain (X decomposes to Y which decomposes back to X).
            if (RADICALS.has(part) || depth >= 3 || seen.has(part)) {
                placements.push({ start: parts.length, sub: null });
                parts.push(part);
                continue;
            }
            // RULE 2: only accept the expansion if it is a clean compound of solid
            // radicals; otherwise this part is more recognisable left whole.
            const sub = expand(part, depth + 1, new Set([...seen, part]));
            if (sub.parts.length >= 2 && sub.parts.every(isSolidRadical)) {
                placements.push({ start: parts.length, sub });
                parts.push(...sub.parts);
            } else {
                placements.push({ start: parts.length, sub: null });
                parts.push(part);
            }
        }
        return { parts, labels: matchesOf ? labelStrokes(current, partsHere, placements) : null };
    }

    /**
     * Project `current`'s makemeahanzi `matches` onto the parts `expand` chose.
     * A stroke inside a part that was opened up takes that part's OWN label for
     * it — its k-th stroke within the part is the part's k-th stroke, because the
     * two files index strokes in the same order (§ 3e). If the stroke counts do
     * not line up, the part's strokes are left unlabelled rather than guessed.
     */
    function labelStrokes(current, partsHere, placements) {
        const matches = matchesOf(current);
        const seq = idsOf(current);
        if (!matches || !seq) return null;
        const tree = parseIdsTree(seq);
        if (!tree) return null;

        // Map every tree leaf to its raw-part index; ？ and self-references were
        // dropped from rawParts, so they map to nothing.
        const leafToPart = new Map();
        let rawIndex = 0;
        tree.leaves.forEach((leaf, leafIndex) => {
            if (leaf === UNKNOWN_PART || leaf === current) return;
            leafToPart.set(leafIndex, rawIndex++);
        });
        // Defensive: the preorder leaves must BE rawParts, or indices would skew.
        if (rawIndex !== partsHere.length) return null;

        const strokePart = matches.map((pathOrNull) => {
            if (!Array.isArray(pathOrNull)) return null;
            const leaf = tree.resolve(pathOrNull);
            return leaf === null ? null : leafToPart.get(leaf) ?? null;
        });
        const strokesPerPart = new Map();
        for (const part of strokePart) {
            if (part !== null) strokesPerPart.set(part, (strokesPerPart.get(part) || 0) + 1);
        }

        const seenInPart = new Map();
        return strokePart.map((part) => {
            if (part === null) return null;
            const k = seenInPart.get(part) || 0;
            seenInPart.set(part, k + 1);
            const { start, sub } = placements[part];
            if (!sub) return start;
            if (!sub.labels || sub.labels.length !== strokesPerPart.get(part)) return null;
            const inner = sub.labels[k];
            return inner === null ? null : start + inner;
        });
    }
}

/**
 * The visual parts of one character, in the source's own (visual) order and WITH
 * MULTIPLICITY (从 → ["人","人"]), decomposed to the depth described by RULE 1 and
 * RULE 2 in this file's header.
 *
 * @param {string} char        the character to decompose
 * @param {Map<string,string>} ids  character → IDS, from loadDecompositions()
 * @returns {string[]} parts; EMPTY for an atomic character (人, 口, 木, 行 …)
 */
export function componentsOf(char, ids) {
    // RULE 1: a radical is already the smallest unit a learner recognises. Revealing
    // "the parts of 口" would be revealing strokes, so it has no hint to give.
    if (RADICALS.has(char)) return [];
    return decompose(char, (c) => ids.get(c), null).parts;
}

/**
 * `componentsOf`, plus which of those parts each of the character's strokes
 * belongs to (§ 3e's "bridge", § 6z-5's variant source).
 *
 * `labels[s]` is an index into `parts` for stroke s (same stroke order as
 * hanzi-writer-data), or null when the source cannot attribute that stroke to a
 * single part. `labels` itself is null when the character has no `matches`.
 *
 * Consumed by generate-handwriting-templates.js, which cuts each component's
 * strokes out of every character that contains it.
 *
 * @param {string} char
 * @param {Map<string, { ids: string, matches: Array<number[] | null> | null }>} entries
 *        from loadDecompositionEntries()
 * @returns {{ parts: string[], labels: Array<number | null> | null }}
 */
export function componentStrokesOf(char, entries) {
    if (RADICALS.has(char)) return { parts: [], labels: null };
    return decompose(
        char,
        (c) => entries.get(c)?.ids,
        (c) => entries.get(c)?.matches ?? null,
    );
}

/**
 * Order each character's components MOST-COMMON-FIRST so hints escalate from weak
 * to decisive: the first (cheapest) hint is a part shared by hundreds of characters
 * and barely narrows a grid scan; the last is nearly identifying.
 *
 * Frequency is counted across the WHOLE corpus passed in — deliberately the entire
 * single-character det table rather than only the discoverable subset, so the order
 * stays stable as words are marked discoverable over time.
 *
 * @param {Map<string, string[]>} byChar  character → its components (multiplicity kept)
 * @returns {Map<string, string[]>} same map, each list reordered (input is not mutated)
 */
export function orderByFrequency(byChar) {
    // How many distinct characters use each component. Counting DISTINCT characters
    // (not raw occurrences) keeps 从's doubled 人 from inflating 人's own frequency.
    const frequency = new Map();
    for (const parts of byChar.values()) {
        for (const part of new Set(parts)) {
            frequency.set(part, (frequency.get(part) || 0) + 1);
        }
    }

    const ordered = new Map();
    for (const [char, parts] of byChar) {
        // Stable, deterministic sort: frequency desc, then codepoint asc as a
        // tie-break so re-runs on unchanged data always produce identical arrays
        // (an unstable order would churn the column and dirty every data deploy).
        ordered.set(
            char,
            [...parts].sort((a, b) => {
                const diff = (frequency.get(b) || 0) - (frequency.get(a) || 0);
                return diff !== 0 ? diff : a.codePointAt(0) - b.codePointAt(0);
            })
        );
    }
    return ordered;
}
