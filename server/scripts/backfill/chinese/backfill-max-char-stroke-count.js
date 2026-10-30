/**
 * Backfill dictionaryentries_zh."maxCharStrokeCount" (migration 179): the stroke count
 * of the word's HARDEST character, from the committed hanzi-writer-data table
 * (lib/hanziStrokeCounts.json via lib/strokeCounts.js).
 *
 * WHY. It is the writing bar's ease key — the flp queue's stale tier serves the
 * easiest-to-write words first (server/services/cardQueueRanking.ts → rankCardQueue,
 * docs/MASTERY_REWORK.md § 6 "Ordering"). Migration 179 filled every row that existed
 * when it ran and stamped this script's id at v1; this script covers rows imported
 * after that, and is the mark-discoverable §A3 step that guarantees it per word.
 *
 * DONE-NESS LIVES IN THE STAMP, not in `"maxCharStrokeCount" IS NULL`: NULL is a
 * legitimate decided answer (a character outside hanzi-writer-data, e.g. 卡拉OK), the
 * same rule backfill-breakdown-elaboration follows. So the gate is staleClause() alone,
 * and every decided row — NULL included — is stamped.
 *
 * Deterministic, no API calls, idempotent.
 *
 * Usage (from server/):
 *   node scripts/backfill/chinese/backfill-max-char-stroke-count.js [--words=未来,摸脉]
 *   scripts/backfill/run-ppe.sh scripts/backfill/chinese/backfill-max-char-stroke-count.js --words=未来
 *
 * Referenced by: .claude/commands/mark-discoverable.md §A3,
 * scripts/backfill/shared/lib/requiredScripts.js (REQUIRED_SCRIPTS_ZH).
 */

import db from '../../../db.js';
import { initRunLog } from '../run-log.js';
import { maxCharStrokeCount } from './lib/strokeCounts.js';

const SCRIPT_VERSION = 1; // bump when this script's logic or lib/hanziStrokeCounts.json changes
const { stampEntries, staleClause } = initRunLog({ script: 'chinese/backfill-max-char-stroke-count', version: SCRIPT_VERSION });

const BATCH_SIZE = 1000;

// --words=未来,摸脉 → scope to specific entries only; omit to target every unstamped zh row.
const wordsArg = process.argv.find(a => a.startsWith('--words='));
const targetWords = wordsArg ? wordsArg.slice('--words='.length).split(',').map(s => s.trim()).filter(Boolean) : null;
const wordsFilter = targetWords?.length ? 'AND word1 = ANY($3::text[])' : '';

// Stamp-only gate (see header). --stale is accepted for callers that pass it
// (run-lazy-enrichment always does) but changes nothing: staleness IS the gate.
const doneGate = staleClause();

async function backfillMaxCharStrokeCount() {
  console.log('✍️  Starting maxCharStrokeCount backfill...\n');
  if (targetWords?.length) console.log(`🎯 Scoped to: ${targetWords.join(', ')}\n`);

  const client = await db.getClient();
  try {
    // Cursor pagination (id > lastId): stamped rows leave the gate, so OFFSET would skip.
    let lastId = 0;
    let totalUpdated = 0;
    let totalNull = 0;

    while (true) {
      const params = [lastId, BATCH_SIZE];
      if (targetWords?.length) params.push(targetWords);
      const { rows } = await client.query(`
        SELECT id, word1
        FROM dictionaryentries_zh
        WHERE language = 'zh' AND ${doneGate} AND id > $1 ${wordsFilter}
        ORDER BY id ASC
        LIMIT $2
      `, params);
      if (rows.length === 0) break;

      const ids = rows.map(r => r.id);
      const counts = rows.map(r => maxCharStrokeCount(r.word1));
      totalNull += counts.filter(c => c === null).length;

      await client.query(`
        UPDATE dictionaryentries_zh
        SET "maxCharStrokeCount" = v.n
        FROM (SELECT unnest($1::int[]) AS id, unnest($2::smallint[]) AS n) AS v
        WHERE dictionaryentries_zh.id = v.id
      `, [ids, counts]);
      await stampEntries(client, 'dictionaryentries_zh', ids);

      totalUpdated += rows.length;
      lastId = ids[ids.length - 1];
      console.log(`📈 Updated ${totalUpdated} rows`);
    }

    console.log(`\n✅ maxCharStrokeCount backfill complete: ${totalUpdated} rows (${totalNull} NULL — a character outside hanzi-writer-data)`);
  } finally {
    client.release();
    await db.pool.end();
  }
}

backfillMaxCharStrokeCount()
  .then(() => process.exit(0))
  .catch((error) => {
    console.error('❌ maxCharStrokeCount backfill failed:', error);
    process.exit(1);
  });
