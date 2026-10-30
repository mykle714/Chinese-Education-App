/**
 * Generate lib/hanziStrokeCounts.json — { "<character>": <stroke count>, ... } for every
 * one-character file in hanzi-writer-data (the count is `strokes.length`).
 *
 * LAYER: data-enrichment (backfill) asset generator. Dev-box only: it reads the
 * repo-root node_modules/hanzi-writer-data (a CLIENT dependency — the server image does
 * not ship it), and its output is COMMITTED so backfill-max-char-stroke-count.js runs
 * anywhere (PPE host, lazy-enrichment spawns) without that package. Same split as
 * generate-handwriting-templates.js.
 *
 * Re-run only when hanzi-writer-data is upgraded; then re-run
 * backfill-max-char-stroke-count.js with a bumped SCRIPT_VERSION so the det follows.
 * Migration 179 inlines the same data (v2.0.1) as its VALUES table.
 *
 * Usage (from server/):  node scripts/backfill/chinese/generate-stroke-counts.js
 *
 * Referenced by: scripts/backfill/chinese/lib/strokeCounts.js,
 * database/migrations/179-add-zh-max-char-stroke-count.sql.
 */
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = path.resolve(__dirname, '..', '..', '..', '..');
const HANZI_DATA_DIR = path.join(REPO_ROOT, 'node_modules', 'hanzi-writer-data');
const OUT_FILE = path.join(__dirname, 'lib', 'hanziStrokeCounts.json');

const counts = {};
for (const file of fs.readdirSync(HANZI_DATA_DIR).sort()) {
  if (!file.endsWith('.json') || file === 'package.json') continue;
  const char = file.slice(0, -'.json'.length);
  if ([...char].length !== 1) continue;
  const data = JSON.parse(fs.readFileSync(path.join(HANZI_DATA_DIR, file), 'utf8'));
  if (Array.isArray(data.strokes)) counts[char] = data.strokes.length;
}

fs.writeFileSync(OUT_FILE, JSON.stringify(counts) + '\n');
console.log(`✅ Wrote ${Object.keys(counts).length} characters to ${path.relative(REPO_ROOT, OUT_FILE)}`);
