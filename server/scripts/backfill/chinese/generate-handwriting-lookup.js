/**
 * Generate the bundled REVERSE-LOOKUP assets for the beginner keyboard: the
 * component-bag index that turns a buffer of components into candidate
 * characters, and the word list behind the multi-character fallback.
 *
 * LAYER: build/asset generation. Reads dictionaryentries_zh; writes two binary
 * blobs into the client's asset tree. Sibling of
 * generate-handwriting-templates.js, which handles the ink→glyph half.
 *
 * Spec: docs/BEGINNER_KEYBOARD.md § 6e/§ 6h (containment), § 6k (ranking),
 * § 6q (the 2–4 character word fallback).
 *
 * ─────────────────────────────────────────────────────────────────────────────
 * ⚠️ THIS SUPERSEDES § 6g's "server service" ROW
 *
 * § 6g originally put the components→characters lookup on the SERVER as a thin
 * read over a boot-time in-memory inverted index. It is bundled to the CLIENT
 * instead, because the lookup re-runs on every component tap and every removal
 * (§ 6r) — a network round-trip per tap is not a keyboard, it is a search box.
 * The keyboard is fully offline: no request is made on any interaction path.
 *
 * The cost is asset size, which is the trade the design already accepted for the
 * templates (§ 7b: storage is not the constraint; latency is).
 *
 * ─────────────────────────────────────────────────────────────────────────────
 * WHY TWO FILES
 *
 * The character index is needed before the keyboard can show anything. The word
 * list is ~6× larger and is needed only when a search comes back EMPTY (§ 6q),
 * which is a minority of buffers. Splitting them lets the keyboard become usable
 * without waiting on the larger half; both are fetched in parallel, and the
 * fallback simply does not fire until its asset lands.
 *
 * ─────────────────────────────────────────────────────────────────────────────
 * WHAT IS PRECOMPUTED HERE VS. DERIVED AT RUNTIME
 *
 * Precomputed: the component id table, each character's component bag, and the
 * two ranking signals (§ 6k) — `frequencyScore` and in-corpus usage count.
 *
 * NOT precomputed: a word's component bag. It is the multiset union of its
 * characters' bags (§ 6q), so storing it would duplicate data already in the
 * character index and add something that can drift from it. The runtime derives
 * it in one cheap pass.
 *
 * USAGE
 *   docker exec cow-backend npx tsx \
 *     scripts/backfill/chinese/generate-handwriting-lookup.js
 */
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import db from '../../../db.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const SERVER_DIR = path.resolve(__dirname, '..', '..', '..');

// ⚠️ PATHS DIFFER BETWEEN HOST AND CONTAINER — same probe as its sibling
// generator; see that file's note for why.
const CONTAINER_REPO_ROOT = '/app/project-root';
const REPO_ROOT = fs.existsSync(CONTAINER_REPO_ROOT)
  ? CONTAINER_REPO_ROOT
  : path.resolve(SERVER_DIR, '..');

const OUTPUT_DIR = path.join(REPO_ROOT, 'src', 'assets', 'handwriting');
const INDEX_FILE = path.join(OUTPUT_DIR, 'glyph-lookup.bin');
const WORDS_FILE = path.join(OUTPUT_DIR, 'glyph-words.bin');

const INDEX_MAGIC = 'HWLK';
const WORDS_MAGIC = 'HWWD';
const FORMAT_VERSION = 1;

/** Longest word the fallback pool admits (§ 6q: 2, 3 and 4 characters). */
const MAX_WORD_LENGTH = 4;

/**
 * Load every single-character headword, its component bag (possibly empty), and
 * the two ranking signals § 6k specifies.
 *
 * ⚠️ ATOMIC CHARACTERS ARE INCLUDED ON PURPOSE. A character with no components
 * can never satisfy containment — its bag contains nothing — so 人 口 木 大 子
 * would be structurally absent from every candidate list (§ 6n). They are here
 * to serve the buffer-equals-itself rescue: a one-component buffer whose
 * component is itself a headword enters that headword at distance 0. Carrying
 * them costs ~26 KB and rescues 199 of the most common characters in the
 * language, so it is not close.
 *
 * `usage` is the in-corpus usage count: how many multi-character dictionary words
 * contain the character. It is the level-3 tie-break, and it is NOT a stopgap —
 * `frequencyScore` is a 1–5 integer even when fully backfilled, so it will always
 * leave large tie groups that need an ordering underneath it.
 */
async function loadCharacters(client) {
  const { rows } = await client.query(`
    WITH usage AS (
      SELECT ch, count(*)::int AS n
        FROM (
          SELECT regexp_split_to_table(word1, '') AS ch
            FROM dictionaryentries_zh
           WHERE language = 'zh' AND char_length(word1) > 1
        ) x
       GROUP BY ch
    )
    SELECT d.word1,
           d.components,
           d."frequencyScore" AS freq,
           d.discoverable,
           COALESCE(u.n, 0) AS usage
      FROM dictionaryentries_zh d
      LEFT JOIN usage u ON u.ch = d.word1
     WHERE d.language = 'zh'
       AND char_length(d.word1) = 1
     ORDER BY d.word1
  `);

  return rows.map((row) => {
    // jsonb: the driver may hand back a parsed array or a string depending on
    // how the row was written. Normalize defensively rather than assume — a NULL
    // column and an empty array are both "atomic" here.
    const parsed = typeof row.components === 'string' ? JSON.parse(row.components) : row.components;
    return {
      char: row.word1,
      components: Array.isArray(parsed) ? parsed : [],
    // 0 is the sentinel for NULL. frequencyScore is 1–5, so 0 is unambiguous —
    // and it sorts last under a descending sort, which is exactly the NULLS LAST
    // behaviour § 6k warns is load-bearing.
      freq: row.freq == null ? 0 : Math.max(0, Math.min(255, row.freq)),
      usage: Math.min(65535, row.usage),
      discoverable: row.discoverable === true,
    };
  });
}

/** Load the 2–4 character word pool for the § 6q fallback. */
async function loadWords(client) {
  const { rows } = await client.query(
    `SELECT word1, "frequencyScore" AS freq
       FROM dictionaryentries_zh
      WHERE language = 'zh'
        AND char_length(word1) BETWEEN 2 AND ${MAX_WORD_LENGTH}
      ORDER BY word1`,
  );
  return rows.map((row) => ({
    word: row.word1,
    freq: row.freq == null ? 0 : Math.max(0, Math.min(255, row.freq)),
  }));
}

/**
 * Serialize the character index.
 *
 * Layout (little-endian):
 *   magic          4    "HWLK"
 *   version        u8
 *   reserved       u8 × 3
 *   componentCount u32
 *   charCount      u32
 *   then componentCount × u32 codepoint   (sorted; array index IS the component id)
 *   then, per character:
 *     codepoint    u32
 *     freq         u8   (0 = NULL, else 1–5)
 *     flags        u8   (bit 0 = discoverable)
 *     usage        u16
 *     nComponents  u8
 *     componentIds u16 × nComponents
 *
 * Components are stored as IDs into the table rather than as codepoints: the
 * runtime compares bags by counting, and small dense integers let it use a typed
 * count array instead of a Map.
 */
function serializeIndex(components, characters) {
  let size = 4 + 1 + 3 + 4 + 4 + components.length * 4;
  for (const c of characters) size += 4 + 1 + 1 + 2 + 1 + c.components.length * 2;

  const buffer = Buffer.alloc(size);
  let offset = 0;
  buffer.write(INDEX_MAGIC, offset, 'ascii');
  offset += 4;
  buffer.writeUInt8(FORMAT_VERSION, offset++);
  buffer.writeUInt8(0, offset++);
  buffer.writeUInt8(0, offset++);
  buffer.writeUInt8(0, offset++);
  buffer.writeUInt32LE(components.length, offset);
  offset += 4;
  buffer.writeUInt32LE(characters.length, offset);
  offset += 4;

  const componentId = new Map();
  components.forEach((component, i) => {
    componentId.set(component, i);
    buffer.writeUInt32LE(component.codePointAt(0), offset);
    offset += 4;
  });

  for (const c of characters) {
    buffer.writeUInt32LE(c.char.codePointAt(0), offset);
    offset += 4;
    buffer.writeUInt8(c.freq, offset++);
    buffer.writeUInt8(c.discoverable ? 1 : 0, offset++);
    buffer.writeUInt16LE(c.usage, offset);
    offset += 2;
    buffer.writeUInt8(c.components.length, offset++);
    for (const component of c.components) {
      buffer.writeUInt16LE(componentId.get(component), offset);
      offset += 2;
    }
  }
  return buffer;
}

/**
 * Serialize the word pool.
 *
 * Layout (little-endian):
 *   magic      4    "HWWD"
 *   version    u8
 *   reserved   u8 × 3
 *   wordCount  u32
 *   then, per word:
 *     freq       u8
 *     unitCount  u8
 *     units      u16 × unitCount   (UTF-16 code units)
 *
 * UTF-16 units rather than u32 codepoints: it halves the file, and unlike a
 * BMP-only u16-codepoint scheme it is exact for every character, because a
 * non-BMP character simply occupies two units and reassembles correctly.
 */
function serializeWords(words) {
  let size = 4 + 1 + 3 + 4;
  for (const w of words) size += 1 + 1 + w.word.length * 2;

  const buffer = Buffer.alloc(size);
  let offset = 0;
  buffer.write(WORDS_MAGIC, offset, 'ascii');
  offset += 4;
  buffer.writeUInt8(FORMAT_VERSION, offset++);
  buffer.writeUInt8(0, offset++);
  buffer.writeUInt8(0, offset++);
  buffer.writeUInt8(0, offset++);
  buffer.writeUInt32LE(words.length, offset);
  offset += 4;

  for (const w of words) {
    buffer.writeUInt8(w.freq, offset++);
    // `.length` is the UTF-16 unit count, which is what we serialize.
    buffer.writeUInt8(w.word.length, offset++);
    for (let i = 0; i < w.word.length; i++) {
      buffer.writeUInt16LE(w.word.charCodeAt(i), offset);
      offset += 2;
    }
  }
  return buffer;
}

async function generateHandwritingLookup() {
  console.log('Generating handwriting reverse-lookup assets...\n');

  const client = await db.getClient();
  let characters;
  let words;
  try {
    characters = await loadCharacters(client);
    words = await loadWords(client);
  } finally {
    client.release();
  }

  if (characters.length === 0) {
    throw new Error('No single-character rows in dictionaryentries_zh.');
  }
  const decomposable = characters.filter((c) => c.components.length > 0);
  if (decomposable.length === 0) {
    throw new Error(
      'No characters carry components. Run backfill-character-components.js first.',
    );
  }

  // Sorted so ids are stable across runs — an unstable id assignment would make
  // every regeneration a spurious binary diff, and would silently invalidate any
  // cached copy of the asset that outlived a rebuild.
  const components = [...new Set(characters.flatMap((c) => c.components))].sort();
  if (components.length > 65535) {
    throw new Error(`${components.length} components exceeds the u16 id space; widen the format.`);
  }

  // A word whose characters are ALL outside the index can never be matched — its
  // derived bag would be empty and containment would admit it for any buffer.
  // Counting them here is the honest coverage number for § 6q.
  const indexed = new Set(characters.map((c) => c.char));
  let derivable = 0;
  for (const w of words) if ([...w.word].some((ch) => indexed.has(ch))) derivable++;

  const indexBuffer = serializeIndex(components, characters);
  const wordsBuffer = serializeWords(words);

  fs.mkdirSync(OUTPUT_DIR, { recursive: true });
  fs.writeFileSync(INDEX_FILE, indexBuffer);
  fs.writeFileSync(WORDS_FILE, wordsBuffer);

  const slots = characters.reduce((sum, c) => sum + c.components.length, 0);
  const atomic = characters.length - decomposable.length;
  const scored = characters.filter((c) => c.freq > 0).length;
  const used = characters.filter((c) => c.usage > 0).length;

  console.log(`  components:    ${components.length.toLocaleString()}`);
  console.log(`  characters:    ${characters.length.toLocaleString()}`);
  console.log(`    decomposable:${decomposable.length.toLocaleString().padStart(7)}`);
  console.log(`    atomic:      ${atomic.toLocaleString().padStart(6)} (§ 6n rescue only)`);
  console.log(`    comp slots:  ${slots.toLocaleString()} (avg ${(slots / decomposable.length).toFixed(2)} over decomposable)`);
  console.log(`    freqScore:   ${scored.toLocaleString()} scored, ${(characters.length - scored).toLocaleString()} NULL`);
  console.log(`    usage > 0:   ${used.toLocaleString()} (${((used / characters.length) * 100).toFixed(1)}%)`);
  console.log(`  words (2-${MAX_WORD_LENGTH}):   ${words.length.toLocaleString()}`);
  console.log(`    bag derivable: ${derivable.toLocaleString()} (${((derivable / words.length) * 100).toFixed(1)}%)`);
  console.log(`\n✅ ${path.relative(REPO_ROOT, INDEX_FILE)} — ${(indexBuffer.length / 1024).toFixed(1)} KB`);
  console.log(`✅ ${path.relative(REPO_ROOT, WORDS_FILE)} — ${(wordsBuffer.length / 1024).toFixed(1)} KB`);
  console.log('   Commit both; the client imports them as URLs.');
}

generateHandwritingLookup()
  .then(() => process.exit(0))
  .catch((err) => {
    console.error('❌ Lookup generation failed:', err);
    process.exit(1);
  });
