/**
 * Backfill dictionaryentries_zh."superpositionGroups" (migration 180): each single
 * character's Superposition tile groups, computed by the client's own rule
 * (server/contracts/superpositionGroups.ts → groupStrokes) from hanzi-writer-data and
 * src/games/superposition/strokeParts.json.
 *
 * ⚠️ GATED. It refuses to write while `FEATURE_FLAGS.superpositionStoredGroups` is off,
 * because stored groups would freeze a rule that is still being tuned
 * (docs/DEFERRED_WORK.md, "Store Superposition's stroke groups on det"). `--dry-run` always
 * runs: it computes everything and reports what a write would change.
 *
 * RECOMPUTE, NOT STAMP. Every run recomputes every single-character zh row and writes only
 * the rows whose value differs (`IS DISTINCT FROM`), so a later change to the rule, the
 * threshold, strokeParts.json or hanzi-writer-data is caught by re-running it. No enrichment
 * stamp: the column is a pure function of committed inputs, so it is never "done".
 * Rows whose character has no hanzi-writer-data file are left NULL (the client then has
 * nothing to draw either).
 *
 * Deterministic, no API calls, idempotent. It needs the REPO-ROOT node_modules
 * (hanzi-writer-data is a client dependency), as generate-superposition-parts.js does.
 *
 * Usage (from server/):
 *   npx tsx scripts/backfill/chinese/backfill-superposition-groups.ts --dry-run [--words=照,国]
 *   scripts/backfill/run-ppe.sh scripts/backfill/chinese/backfill-superposition-groups.ts --dry-run
 *
 * Referenced by: docs/SUPERPOSITION_GAME.md § Stored groups, docs/DEFERRED_WORK.md,
 * server/contracts/featureFlags.ts → superpositionStoredGroups, database/migrations/180-add-zh-superposition-groups.sql.
 */
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import db from '../../../db.js';
import { isFeatureEnabled } from '../../../contracts/featureFlags.js';
import { groupStrokes } from '../../../contracts/superpositionGroups.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = path.resolve(__dirname, '..', '..', '..', '..');
const HANZI_DATA_DIR = path.join(REPO_ROOT, 'node_modules', 'hanzi-writer-data');
const PARTS_FILE = path.join(REPO_ROOT, 'src', 'games', 'superposition', 'strokeParts.json');
const BATCH_SIZE = 1000;

const dryRun = process.argv.includes('--dry-run');
// --words=照,国 → scope to these characters; omit for every single-character zh row.
const wordsArg = process.argv.find((arg) => arg.startsWith('--words='));
const targetWords = wordsArg ? wordsArg.slice('--words='.length).split(',').map((w) => w.trim()).filter(Boolean) : null;

/** The character's groups, or null when hanzi-writer-data has no file for it. */
function groupsFor(char: string, parts: Record<string, number[][]>): number[][] | null {
  const file = path.join(HANZI_DATA_DIR, `${char}.json`);
  if (!fs.existsSync(file)) return null;
  let strokes: unknown;
  try {
    strokes = JSON.parse(fs.readFileSync(file, 'utf8')).strokes;
  } catch (error) {
    console.warn(`⚠️  ${char}: unreadable glyph file (${(error as Error).message}); left NULL`);
    return null;
  }
  if (!Array.isArray(strokes) || strokes.length === 0) return null;
  return groupStrokes(strokes as string[], parts[char] ?? []);
}

async function backfillSuperpositionGroups(): Promise<void> {
  if (!dryRun && !isFeatureEnabled('superpositionStoredGroups')) {
    throw new Error(
      'FEATURE_FLAGS.superpositionStoredGroups is off: stored groups are on hold. Run with --dry-run to preview.'
    );
  }
  if (!fs.existsSync(HANZI_DATA_DIR)) {
    throw new Error(`${HANZI_DATA_DIR} not found: run \`npm install\` at the repo root first.`);
  }
  const parts = JSON.parse(fs.readFileSync(PARTS_FILE, 'utf8')) as Record<string, number[][]>;
  console.log(`🧩 Superposition groups backfill${dryRun ? ' (DRY RUN — nothing is written)' : ''}\n`);

  const client = await db.getClient();
  try {
    let lastId = 0;
    let scanned = 0;
    let changed = 0;
    let missing = 0;
    const samples: string[] = [];
    for (;;) {
      const params: unknown[] = [lastId, BATCH_SIZE];
      if (targetWords) params.push(targetWords);
      // Single-character rows only (char_length counts code points, so 𠮷 counts as one).
      const { rows } = await client.query(
        `SELECT id, word1, "superpositionGroups"
           FROM dictionaryentries_zh
          WHERE language = 'zh' AND char_length(word1) = 1 AND id > $1
                ${targetWords ? 'AND word1 = ANY($3::text[])' : ''}
          ORDER BY id ASC
          LIMIT $2`,
        params
      );
      if (rows.length === 0) break;

      const updates = rows.flatMap((row: { id: number; word1: string; superpositionGroups: number[][] | null }) => {
        const groups = groupsFor(row.word1, parts);
        if (groups === null) missing++;
        // Compare as JSON text: both sides are arrays of sorted int arrays in a fixed order.
        return JSON.stringify(groups) === JSON.stringify(row.superpositionGroups ?? null)
          ? []
          : [{ id: row.id, word1: row.word1, groups }];
      });
      updates.slice(0, Math.max(0, 10 - samples.length)).forEach((u) => samples.push(`${u.word1} → ${JSON.stringify(u.groups)}`));

      if (!dryRun && updates.length > 0) {
        await client.query(
          `UPDATE dictionaryentries_zh AS de
              SET "superpositionGroups" = v.groups
             FROM (SELECT unnest($1::int[]) AS id, unnest($2::text[])::jsonb AS groups) AS v
            WHERE de.id = v.id AND de."superpositionGroups" IS DISTINCT FROM v.groups`,
          [updates.map((u) => u.id), updates.map((u) => JSON.stringify(u.groups))]
        );
      }
      scanned += rows.length;
      changed += updates.length;
      lastId = rows[rows.length - 1].id;
      console.log(`📈 Scanned ${scanned} rows, ${changed} ${dryRun ? 'would change' : 'updated'}`);
    }
    if (samples.length > 0) console.log(`\nSample:\n  ${samples.join('\n  ')}`);
    console.log(
      `\n✅ ${scanned} single-character rows, ${changed} ${dryRun ? 'would change' : 'updated'}, ${missing} without hanzi-writer-data (NULL)`
    );
  } finally {
    client.release();
    await db.pool.end();
  }
}

backfillSuperpositionGroups()
  .then(() => process.exit(0))
  .catch((error) => {
    console.error('❌ Superposition groups backfill failed:', error);
    process.exit(1);
  });
