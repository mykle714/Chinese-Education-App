/**
 * Backfill Script: AI-powered CONVERSATIONAL-COMMONALITY scoring for
 * dictionaryentries_zh
 *
 * For each discoverable zh entry where "frequencyScore" IS NULL, asks Claude Sonnet
 * how much the word would stand out if a friend said it in casual Mandarin:
 *
 *   5 = Everyday — heard or said this week without trying
 *   4 = Common when the topic comes up — normal; nobody would think twice
 *   3 = Unremarkable — you would not be surprised to hear it casually
 *   2 = Odd but forgivable — you would notice; the conversation carries on
 *   1 = Would stop the conversation — classical, archaic, or hyper-technical
 *
 * The rubric itself lives in ./lib/frequencyScore.js, shared with the per-cluster
 * scorer in backfill-cluster-definitions.js so both score on one identical scale.
 *
 * NOTE (SCRIPT_VERSION 4, 2026-08-28): the AXIS changed from frequency-of-occurrence
 * to how-much-it-stands-out — bands 4+5 merged, the old band 1 split into 1 and 2.
 * There is NO migration; the column is still a 1-5 smallint, but every score written
 * before that date means something different. `--stale` re-scores them.
 *
 * NOTE (migration 122, SCRIPT_VERSION 2): this scored REGISTER (colloquial↔literary)
 * until it was renamed and re-pointed at frequency — every consumer (gsa tie-break,
 * search relevance, starter-pack ordering, the quick-mark 3–5 gate, dd's cluster
 * pick) already treated the number as "how common is this word". Rows written by
 * v1 hold register scores; re-run with --stale to re-score them under the new rubric.
 *
 * NULL means "not yet scored". After processing, the column holds an integer 1–5.
 *
 * Usage:
 *   docker exec cow-backend-local npx tsx scripts/backfill/chinese/backfill-frequency-score.js                          # full backfill
 *   docker exec cow-backend-local npx tsx scripts/backfill/chinese/backfill-frequency-score.js --stale                  # also re-score rows stamped below SCRIPT_VERSION
 *   docker exec cow-backend-local npx tsx scripts/backfill/chinese/backfill-frequency-score.js --spot-check             # test 5 entries with reasoning
 *   docker exec cow-backend-local npx tsx scripts/backfill/chinese/backfill-frequency-score.js --spot-check --random    # random 5 entries
 *   docker exec cow-backend-local npx tsx scripts/backfill/chinese/backfill-frequency-score.js --spot-check --random --limit=25
 */

import dotenv from 'dotenv';
import { fileURLToPath } from 'url';
import path from 'path';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
dotenv.config({ path: path.join(__dirname, '../../../.env.docker') });

import Anthropic from '@anthropic-ai/sdk';
import db from '../../../db.js';
import { initRunLog } from '../run-log.js';
import { createFrequencyScorer, SCORE_LABELS } from './lib/frequencyScore.js';
import { reconcileFrequencyScore } from '../shared/lib/senseClusters.js';
const SCRIPT_VERSION = 4; // bump when this script's logic/prompt changes (v4: THE AXIS CHANGED — the scale now asks how much a word would STAND OUT in casual conversation, not how often it occurs. Bands 4+5 merged, old band 1 split into 1 ("would stop the conversation") and 2 ("odd but forgivable"), 目前-class words lifted to 3. All pre-2026-08-28 scores are on the old axis — re-score with --stale; v3: rubric now credits BOUND FORMS through their compounds — 自 is frequent via 自己/自由 — and the write enforces the word/cluster frequency invariant; v2: register rubric → everyday-conversation frequency, migration 122)

const anthropic = new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY });

// run-log: track duration, version, words/mode, and token usage/cost
const { stampEntries, staleClause, validatedClause } = initRunLog({ script: 'chinese/backfill-frequency-score', version: SCRIPT_VERSION, anthropic: anthropic });
// Never overwrite a score a validator has approved/flagged via the card's
// "Commonality" chip (migration 132, docs/DATA_VALIDATION_SYSTEM.md).
const validatedFilter = `AND ${validatedClause(['frequencyScore'], 'dictionaryentries_zh')}`;

const isSpotCheck = process.argv.includes('--spot-check');
const isRandom = process.argv.includes('--random');
const limitArg = process.argv.find(a => a.startsWith('--limit='));
const spotCheckLimit = limitArg ? parseInt(limitArg.split('=')[1], 10) : 5;

// --words=未来,摸脉 → scope to specific entries (needed by the on-first-sort worker).
const wordsArg = process.argv.find(a => a.startsWith('--words='));
const targetWords = wordsArg ? wordsArg.slice('--words='.length).split(',').map(s => s.trim()).filter(Boolean) : null;
const wordsFilter = targetWords?.length
  ? `AND word1 = ANY(ARRAY[${targetWords.map(w => `'${w.replace(/'/g, "''")}'`).join(', ')}])`
  : '';
// Targeted runs enrich the named words regardless of discoverable (worker candidates
// are not-yet-discoverable); untargeted full runs keep the discoverable gate.
const discoverableGate = targetWords?.length ? '' : 'AND discoverable = TRUE';
// --stale: also (re)process rows stamped below SCRIPT_VERSION or never stamped.
const isStale = process.argv.includes('--stale');
const scoreGate = isStale ? `("frequencyScore" IS NULL OR ${staleClause()})` : '"frequencyScore" IS NULL';

// The rubric + scorer live in the shared lib (./lib/frequencyScore.js) so the
// definition-clustering backfill scores each sense cluster on the identical 1–5
// scale. Spot-check mode asks for one-line reasoning alongside the score.
// Guard for the cluster half of the write: a validator's approved per-sense score
// outranks the invariant, so the CASE leaves their clusters untouched.
const senseValidated = validatedClause(['senseFrequencyScore'], 'dictionaryentries_zh');

const { scoreFrequency } = createFrequencyScorer({ anthropic });

async function run() {
  if (isSpotCheck) {
    console.log(`SPOT CHECK MODE — processing ${spotCheckLimit} entries with reasoning${isRandom ? ' (random sample)' : ''}\n`);
  }
  console.log('Starting AI-powered frequencyScore backfill...\n');

  if (!process.env.ANTHROPIC_API_KEY) {
    console.error('ANTHROPIC_API_KEY not set');
    process.exit(1);
  }

  const client = await db.getClient();

  try {
    const { rows: entries } = await client.query(`
      SELECT id, word1, pronunciation, definitions, "definitionClusters"
      FROM dictionaryentries_zh
      WHERE language = 'zh'
        ${discoverableGate}
        ${validatedFilter}
        AND ${scoreGate}
        ${wordsFilter}
      ORDER BY ${isRandom ? 'RANDOM()' : 'id ASC'}
      ${isSpotCheck ? `LIMIT ${spotCheckLimit}` : ''}
    `);

    console.log(`Found ${entries.length} entries needing frequencyScore backfill\n`);

    if (entries.length === 0) {
      console.log('Nothing to process.');
      return;
    }

    let processed = 0;
    let failed = 0;

    // Tally per score value for the final distribution summary
    const scoreCounts = { 1: 0, 2: 0, 3: 0, 4: 0, 5: 0 };

    for (const row of entries) {
      try {
        process.stdout.write(`  ${row.word1} (${row.pronunciation}) ... `);

        const result = await scoreFrequency(row.word1, row.pronunciation, row.definitions, { withReasoning: isSpotCheck });

        if (isSpotCheck) {
          console.log(`${result.score}  |  ${result.reasoning}`);
        } else {
          console.log(`${result.score}`);
        }

        // Enforce the word/cluster frequency invariant on the way in:
        // "frequencyScore" == MAX(cluster scores). A model score BELOW the best
        // cluster is lifted to it; a model score ABOVE every cluster lifts the entry's
        // DEFAULT cluster instead, so the two numbers agree without changing which
        // sense the card shows. See scripts/backfill/shared/lib/senseClusters.js.
        // $3 is NULL unless the clusters actually changed, so an unclustered entry is
        // never handed a jsonb 'null'.
        const reconciled = reconcileFrequencyScore(result.score, row.definitionClusters);
        await client.query(
          `UPDATE dictionaryentries_zh
              SET "frequencyScore" = $1::int,
                  "definitionClusters" = CASE WHEN $3::jsonb IS NOT NULL AND ${senseValidated}
                                              THEN $3::jsonb ELSE "definitionClusters" END
            WHERE id = $2`,
          [
            reconciled.wordScore,
            row.id,
            reconciled.clustersChanged ? JSON.stringify(reconciled.clusters) : null,
          ]
        );
        await stampEntries(client, 'dictionaryentries_zh', row.id);

        scoreCounts[result.score]++;
        processed++;
      } catch (err) {
        console.log(`FAILED: ${err.message}`);
        failed++;
      }

      // Small delay to avoid rate-limiting
      await new Promise(r => setTimeout(r, 200));
    }

    const scoreLabels = SCORE_LABELS;

    console.log('\n' + '='.repeat(60));
    console.log('Backfill Complete!');
    console.log('='.repeat(60));
    console.log(`Total processed  : ${processed + failed}`);
    console.log(`Successfully set : ${processed}`);
    console.log(`Errors           : ${failed}`);
    if (processed > 0) {
      console.log('\nScore distribution:');
      for (const score of [1, 2, 3, 4, 5]) {
        console.log(`  ${score} (${scoreLabels[score]}): ${scoreCounts[score]}`);
      }
    }
    console.log('='.repeat(60) + '\n');
  } finally {
    client.release();
    await db.end?.();
  }
}

run().catch(err => {
  console.error('Script failed:', err);
  process.exit(1);
});
