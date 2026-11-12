/**
 * CLI: reconcile orphaned sense labels in stored zh example sentences.
 *
 * LAYER: data-enrichment (backfill) script — a thin argument wrapper. The engine, and the
 * explanation of the problem and the three passes, live in ./lib/reconcileSenses.js. The
 * same engine runs from backfill-example-sentences.js --reconcile, which is what the
 * oracle planner schedules when DRIFT_PROBES.sentenceSenseOrphan fires.
 *
 * Usage (from server/, on PPE via run-ppe.sh):
 *   npx tsx scripts/backfill/chinese/reconcile-sentence-senses.js --estimate          # counts + cost, NO model calls, NO writes
 *   npx tsx scripts/backfill/chinese/reconcile-sentence-senses.js --dry-run --pass=A  # real pair-mapper calls, NO writes
 *   npx tsx scripts/backfill/chinese/reconcile-sentence-senses.js                     # full run
 *   … --words=就,了      scope HOST rows (the sentences' owners)
 *   … --segments=过,为   scope to orphans of these SEGMENTS only (what the clusterer's
 *                        "⚠ SENSE SPLIT" line tells you to run)
 *   … --pass=0           deterministic only (free); --pass=A skips B
 *   … --limit-pairs=N    only the N largest pairs (⚠ does NOT bound pass B: one big split
 *                        pair can send thousands of sentences to it)
 *   … --concurrency=8    model calls in flight (default 8); DB writes are always serialized
 *   … --replay=<log>     reuse pass-B answers from an earlier decisions log (no re-spend)
 *   … --long-definitions reconcile orphaned longDefinition sense KEYS instead of sentence
 *                        tags (engine: ./lib/reconcileLongDefs.js; honors --words, --estimate,
 *                        --dry-run, --concurrency)
 *
 * Re-runnable: API failures leave their orphans in place, so running again picks up
 * exactly what is left. Done ⟺ a run reports 0 pairs. Every decision is appended to
 * server/logs/reconcile-sentence-senses-<ts>.jsonl for review.
 *
 * Referenced by: docs/EXAMPLE_SENTENCES.md § "Stale sense labels".
 */

import dotenv from 'dotenv';
import { fileURLToPath } from 'url';
import path from 'path';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
dotenv.config({ path: path.join(__dirname, '../../../.env.docker') });

import Anthropic from '@anthropic-ai/sdk';
import db from '../../../db.js';
import { initRunLog } from '../run-log.js';
import { runSenseReconcile } from './lib/reconcileSenses.js';
import { runLongDefReconcile } from './lib/reconcileLongDefs.js';

const SCRIPT_VERSION = 1;
const anthropic = new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY || 'estimate-only' });
initRunLog({ script: 'chinese/reconcile-sentence-senses', version: SCRIPT_VERSION, anthropic });

const args = process.argv.slice(2);
const hasFlag = (f) => args.includes(f);
const getArg = (name) => args.find((x) => x.startsWith(`${name}=`))?.slice(name.length + 1) ?? null;
const listArg = (name) => getArg(name)?.split(',').map((s) => s.trim()).filter(Boolean) ?? null;

async function main() {
  const estimate = hasFlag('--estimate');
  if (!estimate && !process.env.ANTHROPIC_API_KEY && !process.env.BACKFILL_ORACLE) {
    console.error('❌ ANTHROPIC_API_KEY not set (use --estimate for a no-call count)');
    process.exit(1);
  }
  const client = await db.getClient();
  try {
    if (hasFlag('--long-definitions')) {
      await runLongDefReconcile(client, {
        anthropic,
        estimate,
        dryRun: hasFlag('--dry-run'),
        hostWords: listArg('--words'),
        concurrency: getArg('--concurrency') ? parseInt(getArg('--concurrency'), 10) : 8,
      });
      return;
    }
    await runSenseReconcile(client, {
      anthropic,
      estimate,
      dryRun: hasFlag('--dry-run'),
      hostWords: listArg('--words'),
      segments: listArg('--segments'),
      lastPass: getArg('--pass') ?? 'B',
      limitPairs: getArg('--limit-pairs') ? parseInt(getArg('--limit-pairs'), 10) : null,
      concurrency: getArg('--concurrency') ? parseInt(getArg('--concurrency'), 10) : 8,
      replayPath: getArg('--replay'),
    });
  } finally {
    client.release();
    await db.end?.();
  }
}

main().catch((err) => {
  console.error('❌ Script failed:', err);
  process.exit(1);
});
