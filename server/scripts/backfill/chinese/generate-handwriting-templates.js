/**
 * Generate the bundled stroke-template asset for the beginner keyboard's
 * handwriting matcher.
 *
 * LAYER: build/asset generation. Reads dictionaryentries_zh for BOTH halves of
 * the inventory — the `components` column (sub-character parts) and every
 * single-character headword (whole characters) — plus
 * node_modules/hanzi-writer-data for the reference strokes; writes one binary
 * blob into the client's asset tree.
 *
 * Spec: docs/BEGINNER_KEYBOARD.md § 6s ("Ink → component — the matcher"), § 6y
 * (the y-axis convention).
 *
 * ─────────────────────────────────────────────────────────────────────────────
 * ⚠️ MEDIANS ARE Y-UP. CAPTURED INK IS Y-DOWN. THIS FILE IS WHERE THEY MEET.
 *
 * hanzi-writer stores strokes in a 1024×1024 box whose origin is at the BOTTOM
 * left — which is why hanzi-writer's own renderer wraps them in
 * `scale(1, -1) translate(0, -900)`. A `<canvas>`, and therefore every stroke the
 * learner draws, has its origin at the TOP left.
 *
 * Until 2026-09-07 this conversion was missing, so every template was stored
 * vertically MIRRORED relative to real ink. The matcher then compared each
 * drawing against a flipped corpus: two real hand-drawn samples of 尔 ranked
 * 1409 and 1670 out of 7,258, and ranked 0 the moment the ink was flipped.
 *
 * ⚠️ THE SYNTHETIC BENCHMARK COULD NOT SEE THIS, and that is the lesson. Test ink
 * was built from these same y-up medians, so both sides were mirrored and the
 * error cancelled exactly — § 6h/§ 6j measured 85–100% top-1 against a corpus
 * that could not read a single real drawing. Tests that build ink from medians
 * MUST flip too (`inkFromMedians` in the suite), or this bug reappears invisible.
 *
 * ─────────────────────────────────────────────────────────────────────────────
 * WHY THIS EXISTS
 *
 * The matcher is a closed-set nearest-neighbour search: it scores the learner's
 * ink against a reference drawing of every component we know about. Those
 * reference drawings must all be resident in the browser BEFORE the learner
 * draws anything — recognition is local, offline and synchronous, with no server
 * call on the drawing path.
 *
 * hanzi-writer-data ships what we need (`medians` — the centreline of each
 * stroke) but in a per-character, per-file form that is useless at runtime:
 * fetching 895 JSON files when the keyboard opens is not a design, and
 * loadCharData.ts falls through to a CDN in production builds. So the medians are
 * resampled + normalized offline into one compact blob.
 *
 * ─────────────────────────────────────────────────────────────────────────────
 * SCOPE: the UNION of components and whole characters
 *
 * The learner may draw a whole character rather than a part of one, and the
 * keyboard has no mode switch to tell the two apart — so both must be scored in
 * the same pass and ranked into the same candidate row. A component-only asset
 * answers 想 with garbage (耤 替 赖 越 彗, measured 2026-09-07).
 *
 * Every template therefore carries a `kind` bitfield saying which roles it plays,
 * because the two roles behave differently on tap: a component APPENDS to the
 * buffer, a character COMMITS to the text field. Most entries are both — 886 of
 * the 895 components are CJK unified ideographs and 781 are det headwords — so
 * one entry with two bits set beats two entries with the same strokes.
 *
 * Within each half the scope stays maximal: ALL components, ALL single-character
 * headwords, not just the discoverable-reachable ones. The keyboard is open
 * recognition (§ 6c) and scope is the ONE dial that can cost a missed recognition
 * rather than a little precision. § 7b also expects the whole det table to become
 * discoverable eventually, which makes the narrower scope a number with no future.
 *
 * Measured cost of the union (2026-09-07): 7,258 templates instead of 895, and it
 * is nonetheless FASTER than the old exhaustive component scan, because the
 * runtime pairs it with a coarse prefilter — see glyphMatcher.ts. Accuracy on
 * ink with a dropped stroke goes UP, 67% → 86% top-1: a component missing a
 * stroke is often another real component, and the character templates give the
 * true answer somewhere better to land.
 *
 * ─────────────────────────────────────────────────────────────────────────────
 * LICENSING
 *
 * The strokes derive from `hanzi-writer-data`, which is under the ARPHIC PUBLIC
 * LICENSE (not OFL — the app's other font asset is a different licence). It is
 * already a bundled client dependency, so shipping it is settled, but this asset
 * is a derivative work: the ARPHIC notice must ship alongside it. This script
 * copies it next to the output for exactly that reason.
 *
 * Unrelated to the makemeahanzi (LGPLv3) question, which concerns the
 * DECOMPOSITIONS in `components`, not the strokes.
 *
 * USAGE
 *   docker exec cow-backend npx tsx \
 *     scripts/backfill/chinese/generate-handwriting-templates.js
 *
 *   --discoverable   narrow to glyphs reachable from discoverable words
 *                    (smaller, and NOT what the client expects — diagnostic only)
 */
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import db from '../../../db.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
// chinese/ is at server/scripts/backfill/chinese → server/ is three levels up.
const SERVER_DIR = path.resolve(__dirname, '..', '..', '..');

// ⚠️ PATHS DIFFER BETWEEN HOST AND CONTAINER. These scripts normally run via
// `docker exec cow-backend`, where server/ is mounted at /app and the REPO
// ROOT is mounted separately at /app/project-root — so /app/.. is `/`, not the
// repo. Probe for the container layout first, fall back to the host layout.
// (Same rule as generate-component-font.js.)
const CONTAINER_REPO_ROOT = '/app/project-root';
const REPO_ROOT = fs.existsSync(CONTAINER_REPO_ROOT)
  ? CONTAINER_REPO_ROOT
  : path.resolve(SERVER_DIR, '..');

const HANZI_DATA_DIR = path.join(REPO_ROOT, 'node_modules', 'hanzi-writer-data');
const OUTPUT_DIR = path.join(REPO_ROOT, 'src', 'assets', 'handwriting');
const OUTPUT_FILE = path.join(OUTPUT_DIR, 'glyph-templates.bin');
const LICENSE_FILE = path.join(OUTPUT_DIR, 'hanzi-writer-data-ARPHICPL.txt');

// The geometry is imported from the CLIENT so the two cannot drift. See the
// header of src/components/handwriting/inkGeometry.ts.
const GEOMETRY_MODULE = path.join(REPO_ROOT, 'src', 'components', 'handwriting', 'inkGeometry.ts');

const discoverableOnly = process.argv.includes('--discoverable');

/** Header magic, so a truncated or wrong file fails loudly at parse rather than silently mis-scoring. */
const MAGIC = 'HWCT';
const FORMAT_VERSION = 2;

/**
 * Role bits stored per template. A glyph is very often BOTH — 木 is a component
 * of 想 and a word in its own right — so this is a bitfield rather than an enum,
 * and such a glyph occupies one template rather than two identical ones.
 *
 * The runtime needs this because the candidate row is mixed (one ranked list of
 * components and characters together): the bits decide whether a tap appends to
 * the component buffer or commits text.
 */
const KIND_COMPONENT = 1;
const KIND_CHARACTER = 2;

/**
 * Collect the glyph inventory: every distinct component, every single-character
 * headword, and the role bits for each.
 *
 * Two queries rather than one UNION so the roles stay separable — a glyph that
 * appears in both gets both bits, and the counts are reportable independently.
 *
 * Multiplicity and ordering are irrelevant: the matcher needs distinct SHAPES.
 */
async function loadGlyphInventory() {
  const client = await db.getClient();
  try {
    // Restricting the candidate pool to words a learner can actually reach.
    // Interpolated, not parameterized, because it is a fixed literal fragment
    // chosen by a local CLI flag — no external input reaches it.
    const reachable = discoverableOnly
      ? `AND EXISTS (
             SELECT 1 FROM dictionaryentries_zh w
              WHERE w.language = 'zh'
                AND w.discoverable = TRUE
                AND position(c.word1 in w.word1) > 0
           )`
      : '';

    const { rows: componentRows } = await client.query(
      `SELECT c.components
         FROM dictionaryentries_zh c
        WHERE c.language = 'zh'
          AND char_length(c.word1) = 1
          AND c.components IS NOT NULL
          AND jsonb_array_length(c.components) > 0
          ${reachable}`,
    );

    const { rows: characterRows } = await client.query(
      `SELECT c.word1
         FROM dictionaryentries_zh c
        WHERE c.language = 'zh'
          AND char_length(c.word1) = 1
          ${discoverableOnly ? 'AND c.discoverable = TRUE' : ''}`,
    );

    /** @type {Map<string, number>} glyph → kind bitfield */
    const inventory = new Map();
    const add = (glyph, kind) => inventory.set(glyph, (inventory.get(glyph) || 0) | kind);

    for (const row of componentRows) {
      // jsonb: the driver may hand back a parsed array or a string depending on
      // how the row was written. Normalize defensively rather than assume.
      const parts = typeof row.components === 'string' ? JSON.parse(row.components) : row.components;
      if (Array.isArray(parts)) for (const part of parts) add(part, KIND_COMPONENT);
    }
    for (const row of characterRows) add(row.word1, KIND_CHARACTER);

    // Sorted so the asset is byte-stable across runs: an unstable order would
    // make every regeneration a spurious binary diff in git.
    return [...inventory.entries()].sort((a, b) => (a[0] < b[0] ? -1 : a[0] > b[0] ? 1 : 0));
  } finally {
    client.release();
  }
}

/**
 * Serialize templates into the blob the client parses.
 *
 * Layout (little-endian throughout):
 *   magic      4 bytes  "HWCT"
 *   version    u8       2
 *   points     u8       points per stroke
 *   quantBits  u8       8
 *   reserved   u8
 *   count      u32      (v1 used u16; the union set is comfortably under 65,535
 *                        today but widening now avoids a v3 the moment the det
 *                        table grows past it — see § 7b)
 *   then, per glyph:
 *     codepoint  u32    (u32 rather than u16 — some radicals sit outside the BMP)
 *     kind       u8     KIND_COMPONENT | KIND_CHARACTER bitfield
 *     strokes    u8
 *     coords     i8 × strokes × points × 2   (x, y interleaved)
 *
 * Coordinates are the normalized values × QUANT_SCALE. The client divides by the
 * same constant; both read it from inkGeometry.ts, and quantBits/points are in
 * the header so a stale asset is detectable rather than silently misread.
 *
 * ⚠️ No coarse descriptor is stored. The runtime's prefilter uses per-stroke
 * centroids, which are DERIVABLE from these coordinates in one cheap pass at
 * load time — storing them would inflate the asset and add a second thing that
 * can drift out of sync with the coordinates it summarizes.
 */
function serialize(templates, pointsPerStroke, quantScale) {
  let size = 12;
  for (const t of templates) size += 4 + 1 + 1 + t.strokes.length * pointsPerStroke * 2;

  const buffer = Buffer.alloc(size);
  let offset = 0;
  buffer.write(MAGIC, offset, 'ascii');
  offset += 4;
  buffer.writeUInt8(FORMAT_VERSION, offset++);
  buffer.writeUInt8(pointsPerStroke, offset++);
  buffer.writeUInt8(8, offset++); // quantBits
  buffer.writeUInt8(0, offset++); // reserved
  buffer.writeUInt32LE(templates.length, offset);
  offset += 4;

  for (const t of templates) {
    buffer.writeUInt32LE(t.codePoint, offset);
    offset += 4;
    buffer.writeUInt8(t.kind, offset++);
    buffer.writeUInt8(t.strokes.length, offset++);
    for (const stroke of t.strokes) {
      for (const [x, y] of stroke) {
        // Clamp rather than wrap: a coordinate outside the byte range means the
        // normalization produced something unexpected, and a wrapped value would
        // score as a wildly wrong shape instead of merely a clipped one.
        buffer.writeInt8(Math.max(-128, Math.min(127, Math.round(x * quantScale))), offset++);
        buffer.writeInt8(Math.max(-128, Math.min(127, Math.round(y * quantScale))), offset++);
      }
    }
  }
  return buffer;
}

async function generateHandwritingTemplates() {
  console.log('Generating handwriting stroke templates...\n');

  if (!fs.existsSync(HANZI_DATA_DIR)) {
    throw new Error(
      `hanzi-writer-data not found at ${HANZI_DATA_DIR}. It is a declared client ` +
        `dependency — run npm install at the repo root.`,
    );
  }

  const { POINTS_PER_STROKE, QUANT_SCALE, fingerprint } = await import(GEOMETRY_MODULE);

  const inventory = await loadGlyphInventory();
  if (inventory.length === 0) {
    throw new Error(
      'No glyphs found in dictionaryentries_zh. Run backfill-character-components.js first.',
    );
  }

  const templates = [];
  const missing = { component: [], character: [] };
  let totalStrokes = 0;
  let componentCount = 0;
  let characterCount = 0;

  for (const [glyph, kind] of inventory) {
    const file = path.join(HANZI_DATA_DIR, `${glyph}.json`);
    let medians = null;
    if (fs.existsSync(file)) {
      ({ medians } = JSON.parse(fs.readFileSync(file, 'utf8')));
    }
    if (!Array.isArray(medians) || medians.length === 0) {
      // hanzi-writer-data is SIMPLIFIED-only, so most misses are traditional
      // headwords. They are unrecognizable rather than merely unranked — a
      // learner writing 語 gets confident nonsense with no signal that the
      // glyph is absent (§ 7d).
      if (kind & KIND_COMPONENT) missing.component.push(glyph);
      else missing.character.push(glyph);
      continue;
    }
    // ⚠️ Convert y-up medians into the y-down space captured ink lives in. The
    // shared `fingerprint` normalizes about the bounding-box centre, so negation
    // commutes with it — flipping here and flipping after normalization give
    // identical templates. It is done HERE because this is the only place the
    // foreign coordinate system enters the app.
    const strokes = fingerprint(medians.map((stroke) => stroke.map(([x, y]) => [x, -y])));
    totalStrokes += strokes.length;
    if (kind & KIND_COMPONENT) componentCount++;
    if (kind & KIND_CHARACTER) characterCount++;
    templates.push({ char: glyph, codePoint: glyph.codePointAt(0), kind, strokes });
  }

  const buffer = serialize(templates, POINTS_PER_STROKE, QUANT_SCALE);

  fs.mkdirSync(OUTPUT_DIR, { recursive: true });
  fs.writeFileSync(OUTPUT_FILE, buffer);

  // ARPHIC PL: the notice ships with the derivative work.
  const sourceLicense = path.join(HANZI_DATA_DIR, 'ARPHICPL.TXT');
  if (fs.existsSync(sourceLicense)) fs.copyFileSync(sourceLicense, LICENSE_FILE);

  console.log(`  scope:         ${discoverableOnly ? 'discoverable-reachable (DIAGNOSTIC)' : 'all glyphs'}`);
  console.log(`  inventory:     ${inventory.length.toLocaleString()}`);
  console.log(`  templates:     ${templates.length.toLocaleString()}`);
  console.log(`    components:  ${componentCount.toLocaleString()}`);
  console.log(`    characters:  ${characterCount.toLocaleString()}`);
  console.log(`  strokes:       ${totalStrokes.toLocaleString()} (avg ${(totalStrokes / templates.length).toFixed(2)})`);
  console.log(`  points/stroke: ${POINTS_PER_STROKE}, quant scale ${QUANT_SCALE}`);
  if (missing.component.length) {
    console.log(`\n  ⚠️ ${missing.component.length} COMPONENT(s) have no stroke data and are UNRECOGNIZABLE:`);
    console.log(`     ${missing.component.join(' ')}`);
  }
  if (missing.character.length) {
    console.log(`\n  ⚠️ ${missing.character.length} character(s) have no stroke data (mostly traditional forms).`);
    console.log(`     ${missing.character.slice(0, 40).join(' ')}${missing.character.length > 40 ? ' …' : ''}`);
  }
  console.log(`\n✅ Wrote ${path.relative(REPO_ROOT, OUTPUT_FILE)} — ${(buffer.length / 1024).toFixed(1)} KB`);
  console.log('   Commit this file and the licence beside it; the client imports it as a URL.');
}

generateHandwritingTemplates()
  .then(() => process.exit(0))
  .catch((err) => {
    console.error('❌ Template generation failed:', err);
    process.exit(1);
  });
