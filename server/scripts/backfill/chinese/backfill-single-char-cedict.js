/**
 * Backfill Script: Populate barebones single-char det rows from local CC-CEDICT
 *
 * LAYER: data-enrichment (backfill) layer — offline maintenance script, not app runtime.
 *
 * CONTEXT
 * -------
 * 560 common-Han single-character rows were created barebones (definitions = '[]',
 * everything else NULL) so that every character appearing inside a multi-char det
 * entry also has a standalone row. This script fills the four fields that every
 * *other* undiscoverable single-char entry carries — and ONLY those four:
 *
 *     pronunciation   (accented pinyin, e.g. "nǚ")
 *     numberedPinyin  (numbered pinyin, ü→v, neutral tone unnumbered, e.g. "nv3")
 *     tone            (concatenated per-syllable tone digits, neutral = 0, e.g. "3")
 *     definitions     (jsonb array of English glosses, semicolon-split)
 *
 * It does NOT touch `discoverable` (stays false) or any enrichment column
 * (partsOfSpeech, breakdown, longDefinition, classifier, …) — those are NULL on
 * undiscoverable entries by design.
 *
 * SOURCE OF TRUTH
 * ---------------
 * The bundled CC-CEDICT dump at server/cedict_ts.u8. The transform chain below is
 * copied VERBATIM from the scripts that produced the existing rows so the output
 * is byte-identical to the live pipeline:
 *   - convertPinyinToToneMarks  ← scripts/import-cedict-pg.ts
 *   - fixUColon / extractTones  ← backfill/chinese/backfill-pinyin-ucolon.js
 *   - toNumberedPinyin          ← backfill/chinese/backfill-numbered-pinyin.js
 *   - expandDefinitions         ← backfill/chinese/backfill-split-semicolon-definitions.js
 *
 * POLYPHONIC CHARS: CC-CEDICT lists one line per reading. Matching the existing
 * rows (verified against 行/长/的/女/重/了), the PRIMARY reading = the FIRST
 * CEDICT line, and its pinyin drives pronunciation/numberedPinyin/tone.
 * `definitions` is the semicolon-split union of ALL readings' glosses, primary
 * reading first. (The live rows for a few polyphonic chars were later AI-reordered;
 * we do not attempt to reproduce that — a faithful CEDICT union is the baseline.)
 *
 * CACHING: the parse of cedict_ts.u8 → { simplifiedChar: [readings] } is written
 * to .cache/single-char-cedict.json next to this script and reused on re-runs.
 * Pass --refresh to rebuild it.
 *
 * USAGE (run from project root):
 *   node server/scripts/backfill/chinese/backfill-single-char-cedict.js            # dry run (default)
 *   node server/scripts/backfill/chinese/backfill-single-char-cedict.js --verify   # recompute existing rows, report match rate
 *   node server/scripts/backfill/chinese/backfill-single-char-cedict.js --apply    # write to DB
 *   node server/scripts/backfill/chinese/backfill-single-char-cedict.js --refresh  # rebuild parse cache first
 *
 * Referenced by: docs/DEFINITION_MAPPING.md (definition forms), POSTGRES_QUERY_GUIDE.md.
 */

import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import dotenv from 'dotenv';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
dotenv.config({ path: path.join(__dirname, '../../../.env.docker') });

import db from '../../../db.js';
import { initRunLog } from '../run-log.js';

const SCRIPT_VERSION = 1; // bump when this script's logic changes
const { stampEntries } = initRunLog({ script: 'chinese/backfill-single-char-cedict', version: SCRIPT_VERSION });

const CEDICT_PATH = path.join(__dirname, '../../../cedict_ts.u8');
const CACHE_DIR = path.join(__dirname, '.cache');
const CACHE_PATH = path.join(CACHE_DIR, 'single-char-cedict.json');
const BATCH_SIZE = 500;

const APPLY = process.argv.includes('--apply');
const VERIFY = process.argv.includes('--verify');
const REFRESH = process.argv.includes('--refresh');

// ─────────────────────────────────────────────────────────────────────────────
// Transform chain — copied verbatim from the existing pipeline scripts.
// ─────────────────────────────────────────────────────────────────────────────

/**
 * import-cedict-pg.ts: numbered pinyin ("nu:3") → tone-marked ("nǚ").
 *
 * DIVERGENCE FROM import-cedict-pg.ts (verified against live rows):
 *   1. The tone mark on an "ou" final belongs on the 'o' (sǒu, not soǔ). The
 *      importer's "last vowel" fallback gets this wrong; we special-case "ou".
 *   2. CEDICT capitalizes proper-noun readings (Jiāo, Tán); the live table is
 *      uniformly lowercase, so callers lowercase rawPinyin before this runs.
 */
function convertPinyinToToneMarks(pinyinWithNumbers) {
  const toneMarks = {
    a: ['a', 'ā', 'á', 'ǎ', 'à'],
    e: ['e', 'ē', 'é', 'ě', 'è'],
    i: ['i', 'ī', 'í', 'ǐ', 'ì'],
    o: ['o', 'ō', 'ó', 'ǒ', 'ò'],
    u: ['u', 'ū', 'ú', 'ǔ', 'ù'],
    ü: ['ü', 'ǖ', 'ǘ', 'ǚ', 'ǜ'],
  };
  return pinyinWithNumbers
    .split(' ')
    .map(syllable => {
      const match = syllable.match(/^([a-züÜ]+)([1-5])$/i);
      if (!match) return syllable; // e.g. "nu:3" (has ':') passes through to fixUColon
      let [, letters, toneStr] = match;
      const tone = parseInt(toneStr, 10);
      letters = letters.replace(/v/g, 'ü').replace(/V/g, 'Ü');
      let vowelIndex = letters.search(/[aeAE]/);
      if (vowelIndex === -1) {
        const ouIndex = letters.search(/ou/i); // "ou" final → mark the o
        if (ouIndex !== -1) {
          vowelIndex = ouIndex;
        } else {
          const vowelMatches = Array.from(letters.matchAll(/[iouüIOUÜ]/g));
          if (vowelMatches.length > 0) vowelIndex = vowelMatches[vowelMatches.length - 1].index;
        }
      }
      if (vowelIndex !== -1) {
        const vowel = letters[vowelIndex];
        const toneMarkedVowel = toneMarks[vowel]?.[tone] || vowel;
        letters = letters.substring(0, vowelIndex) + toneMarkedVowel + letters.substring(vowelIndex + 1);
      }
      return letters;
    })
    .join(' ');
}

/** backfill-pinyin-ucolon.js: CEDICT "u:" ASCII stand-in → proper ü tone marks. */
const U_COLON_REPLACEMENTS = [
  ['u:e1', 'üē'], ['u:e2', 'üé'], ['u:e3', 'üě'], ['u:e4', 'üè'],
  ['u:1', 'ǖ'], ['u:2', 'ǘ'], ['u:3', 'ǚ'], ['u:4', 'ǜ'], ['u:5', 'ü'],
];
function fixUColon(pronunciation) {
  let result = pronunciation;
  for (const [from, to] of U_COLON_REPLACEMENTS) result = result.replaceAll(from, to);
  return result;
}

const TONE_MARK_MAP = {
  ā: 1, á: 2, ǎ: 3, à: 4, ē: 1, é: 2, ě: 3, è: 4, ī: 1, í: 2, ǐ: 3, ì: 4,
  ō: 1, ó: 2, ǒ: 3, ò: 4, ū: 1, ú: 2, ǔ: 3, ù: 4, ǖ: 1, ǘ: 2, ǚ: 3, ǜ: 4,
};
/** backfill-pinyin-ucolon.js: per-syllable tone digits, neutral = 0. */
function extractTones(pronunciation) {
  return pronunciation
    .split(' ')
    .map(syllable => {
      for (const char of syllable) if (TONE_MARK_MAP[char] !== undefined) return TONE_MARK_MAP[char];
      return 0;
    })
    .join('');
}

/** backfill-numbered-pinyin.js: tone-marked pronunciation → numbered pinyin (ü→v). */
const DIACRITIC_MAP = {
  ā: ['a', 1], á: ['a', 2], ǎ: ['a', 3], à: ['a', 4],
  ē: ['e', 1], é: ['e', 2], ě: ['e', 3], è: ['e', 4],
  ī: ['i', 1], í: ['i', 2], ǐ: ['i', 3], ì: ['i', 4],
  ō: ['o', 1], ó: ['o', 2], ǒ: ['o', 3], ò: ['o', 4],
  ū: ['u', 1], ú: ['u', 2], ǔ: ['u', 3], ù: ['u', 4],
  ǖ: ['v', 1], ǘ: ['v', 2], ǚ: ['v', 3], ǜ: ['v', 4],
};
function toNumberedPinyin(pronunciation) {
  return pronunciation
    .split(' ')
    .map(syllable => {
      let result = '';
      let tone = null;
      for (const char of syllable) {
        if (DIACRITIC_MAP[char]) {
          const [base, toneNum] = DIACRITIC_MAP[char];
          result += base;
          tone = toneNum;
        } else if (char === 'ü') {
          result += 'v';
        } else {
          result += char;
        }
      }
      if (tone !== null) result += tone;
      return result;
    })
    .join(' ');
}

/** backfill-split-semicolon-definitions.js: split "a; b" glosses into separate entries. */
function expandDefinitions(definitions) {
  const result = [];
  for (const def of definitions) {
    if (def.includes(';')) result.push(...def.split(';').map(p => p.trim()).filter(Boolean));
    else result.push(def);
  }
  return result;
}

// ─────────────────────────────────────────────────────────────────────────────
// CC-CEDICT parse (cached)
// ─────────────────────────────────────────────────────────────────────────────

/** Parse a CEDICT line → { simplified, rawPinyin, glosses[] } (import-cedict-pg.ts regex). */
function parseCEDICTLine(line) {
  if (line.startsWith('#') || line.trim() === '') return null;
  const match = line.match(/^(\S+)\s+(\S+)\s+\[([^\]]+)\]\s+\/(.+)/);
  if (!match) return null;
  const [, , simplified, rawPinyin, defsStr] = match;
  const glosses = defsStr.replace(/\/\s*$/, '').split('/').filter(d => d.trim().length > 0);
  return { simplified, rawPinyin, glosses };
}

/**
 * Build (or load) a map of single-character simplified headword → ordered readings.
 * Only CEDICT entries whose simplified form is exactly ONE code point are kept.
 * Each reading: { pronunciation, numberedPinyin, tone, glosses }.
 */
function buildSingleCharMap() {
  if (!REFRESH && fs.existsSync(CACHE_PATH)) {
    console.log(`📦 Loading parsed CEDICT from cache: ${path.relative(process.cwd(), CACHE_PATH)}`);
    return JSON.parse(fs.readFileSync(CACHE_PATH, 'utf-8'));
  }

  console.log(`🔍 Parsing ${path.relative(process.cwd(), CEDICT_PATH)} …`);
  const lines = fs.readFileSync(CEDICT_PATH, 'utf-8').split('\n');
  /** @type {Record<string, Array<{pronunciation:string,numberedPinyin:string,tone:string,glosses:string[]}>>} */
  const map = {};
  for (const line of lines) {
    const parsed = parseCEDICTLine(line);
    if (!parsed) continue;
    if (Array.from(parsed.simplified).length !== 1) continue; // single code point only
    // Lowercase first: CEDICT capitalizes proper-noun readings, but the live table is all-lowercase.
    const pronunciation = fixUColon(convertPinyinToToneMarks(parsed.rawPinyin.toLowerCase()));
    const reading = {
      pronunciation,
      numberedPinyin: toNumberedPinyin(pronunciation),
      tone: extractTones(pronunciation),
      glosses: parsed.glosses,
    };
    (map[parsed.simplified] ||= []).push(reading);
  }

  fs.mkdirSync(CACHE_DIR, { recursive: true });
  fs.writeFileSync(CACHE_PATH, JSON.stringify(map));
  console.log(`💾 Cached ${Object.keys(map).length} single-char headwords → ${path.relative(process.cwd(), CACHE_PATH)}`);
  return map;
}

/** Combine a char's readings into the 4 target field values (primary reading = first). */
function computeFields(readings) {
  const primary = readings[0];
  const definitions = expandDefinitions(readings.flatMap(r => r.glosses));
  return {
    pronunciation: primary.pronunciation,
    numberedPinyin: primary.numberedPinyin,
    tone: primary.tone,
    definitions,
  };
}

// ─────────────────────────────────────────────────────────────────────────────
// Modes
// ─────────────────────────────────────────────────────────────────────────────

/**
 * --verify: recompute the deterministic pinyin fields for already-populated
 * single-char rows and report how often they match. Proves the transform chain
 * reproduces the live pipeline before we trust it on the barebones rows.
 * (definitions are NOT compared — some live rows were later AI-edited.)
 */
async function verify(client, charMap) {
  const { rows } = await client.query(`
    SELECT word1, pronunciation, "numberedPinyin", tone
    FROM dictionaryentries_zh
    WHERE language = 'zh' AND char_length(word1) = 1 AND definitions <> '[]'::jsonb
      AND pronunciation IS NOT NULL
  `);
  let checked = 0, matchAll = 0;
  const mism = { pronunciation: [], numberedPinyin: [], tone: [] };
  for (const row of rows) {
    const readings = charMap[row.word1];
    if (!readings) continue; // char not in CEDICT single-char set — skip
    checked++;
    const f = computeFields(readings);
    let ok = true;
    for (const field of ['pronunciation', 'numberedPinyin', 'tone']) {
      if (String(row[field]) !== String(f[field])) {
        ok = false;
        if (mism[field].length < 12) mism[field].push(`${row.word1}: db=${JSON.stringify(row[field])} vs computed=${JSON.stringify(f[field])}`);
      }
    }
    if (ok) matchAll++;
  }
  console.log(`\n🔎 VERIFY — recomputed ${checked} existing single-char rows found in CEDICT`);
  console.log(`   Exact match on pronunciation+numberedPinyin+tone: ${matchAll}/${checked} (${((matchAll / checked) * 100).toFixed(2)}%)`);
  for (const field of ['pronunciation', 'numberedPinyin', 'tone']) {
    console.log(`   ${field} mismatches (${mism[field].length} shown): ${mism[field].join(' | ') || 'none'}`);
  }
}

/** --apply / dry-run: fill the barebones rows (definitions = '[]'). */
async function backfill(client, charMap) {
  const { rows } = await client.query(`
    SELECT id, word1
    FROM dictionaryentries_zh
    WHERE language = 'zh' AND char_length(word1) = 1 AND definitions = '[]'::jsonb
    ORDER BY id
  `);
  console.log(`\n📊 ${rows.length} barebones single-char rows to backfill ${APPLY ? '' : '(DRY RUN — no writes)'}\n`);

  const updates = [];
  const notInCedict = [];
  for (const row of rows) {
    const readings = charMap[row.word1];
    if (!readings) { notInCedict.push(row.word1); continue; }
    updates.push({ id: row.id, word1: row.word1, ...computeFields(readings) });
  }

  // Sample preview
  for (const u of updates.slice(0, 12)) {
    console.log(`   ${u.word1}  pron=${u.pronunciation}  num=${u.numberedPinyin}  tone=${u.tone}  defs=${JSON.stringify(u.definitions).slice(0, 80)}`);
  }
  console.log(`\n   → ${updates.length} will be filled; ${notInCedict.length} have NO CEDICT single-char entry (left barebones): ${notInCedict.join(' ')}`);

  if (!APPLY) {
    console.log('\n(DRY RUN — re-run with --apply to write)');
    return;
  }

  let written = 0;
  for (let i = 0; i < updates.length; i += BATCH_SIZE) {
    const batch = updates.slice(i, i + BATCH_SIZE);
    const ids = batch.map(u => u.id);
    await client.query(
      `UPDATE dictionaryentries_zh AS d
       SET pronunciation = v.pron, "numberedPinyin" = v.num, tone = v.tone, definitions = v.defs::jsonb
       FROM (
         SELECT unnest($1::int[]) AS id, unnest($2::text[]) AS pron,
                unnest($3::text[]) AS num, unnest($4::text[]) AS tone, unnest($5::text[]) AS defs
       ) AS v
       WHERE d.id = v.id`,
      [ids, batch.map(u => u.pronunciation), batch.map(u => u.numberedPinyin),
       batch.map(u => u.tone), batch.map(u => JSON.stringify(u.definitions))]
    );
    await stampEntries(client, 'dictionaryentries_zh', ids);
    written += batch.length;
    console.log(`📈 Wrote ${written}/${updates.length}`);
  }
  console.log(`\n✅ Backfilled ${written} rows (discoverable untouched — still false).`);
}

async function main() {
  console.log('🈶 Single-char CC-CEDICT backfill');
  console.log('='.repeat(60));
  const charMap = buildSingleCharMap();
  const client = await db.getClient();
  try {
    if (VERIFY) await verify(client, charMap);
    else await backfill(client, charMap);
  } finally {
    client.release();
    await db.pool.end();
  }
}

main()
  .then(() => { console.log('\n✅ Done'); process.exit(0); })
  .catch(err => { console.error('❌ Failed:', err); process.exit(1); });
