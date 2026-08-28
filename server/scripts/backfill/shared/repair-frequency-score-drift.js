/**
 * Repair Script: enforce the word/cluster FREQUENCY INVARIANT on det.
 *
 *     det."frequencyScore"  ==  MAX(definitionClusters[*].frequencyScore)
 *
 * The rule, why it drifted, why it is user-visible, and why the repair ratchets UP
 * rather than trusting one side all live in ONE place — the header of
 * ./lib/senseClusters.js. Read that first; this file is only the driver.
 *
 * LAYER: data-enrichment (backfill). Language-generic — it is pure arithmetic over
 * two columns that both det tables share, so it lives in backfill/shared/ rather
 * than being copy-pasted into chinese/ and spanish/. It makes NO API calls.
 *
 * SAFETY
 *   - Skips any entry a validator has approved/flagged on `frequencyScore` or
 *     `senseFrequencyScore` (docs/DATA_VALIDATION_SYSTEM.md) — a human decision
 *     outranks the invariant.
 *   - Only ever RAISES a score, so it cannot demote a sense out of view.
 *   - Never changes which cluster is the default sense: when the clusters need
 *     lifting it lifts the one that is already the default.
 *   - Leaves one-sided nulls alone; filling them is the owning backfill's job.
 *
 * Usage (from the backend container, so it sees .env.docker):
 *   docker exec cow-backend-local npx tsx scripts/backfill/shared/repair-frequency-score-drift.js --dry-run
 *   docker exec cow-backend-local npx tsx scripts/backfill/shared/repair-frequency-score-drift.js
 *   ... --language=zh            # default: both zh and es
 *   ... --discoverable-only      # only rows that actually ship
 *   ... --words=自,讨论           # scope to specific headwords
 *   ... --limit=50
 */

import dotenv from 'dotenv';
import { fileURLToPath } from 'url';
import path from 'path';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
dotenv.config({ path: path.join(__dirname, '../../../.env.docker') });

import db from '../../../db.js';
import { initRunLog } from '../run-log.js';
import { parseBackfillArgs, wordsWhereClause } from './lib/cli.js';
import { reconcileFrequencyScore } from './lib/senseClusters.js';

const SCRIPT_VERSION = 1; // bump when this script's logic changes

// No Anthropic client: this pass is deterministic arithmetic, not a model call.
const { validatedClause } = initRunLog({ script: 'shared/repair-frequency-score-drift', version: SCRIPT_VERSION });

const { targetWords } = parseBackfillArgs();
const DRY_RUN = process.argv.includes('--dry-run');
const DISCOVERABLE_ONLY = process.argv.includes('--discoverable-only');
const limitArg = process.argv.find((a) => a.startsWith('--limit='));
const LIMIT = limitArg ? parseInt(limitArg.split('=')[1], 10) : null;
const langArg = process.argv.find((a) => a.startsWith('--language='));
const LANGUAGES = langArg ? [langArg.split('=')[1]] : ['zh', 'es'];

const TABLES = { zh: 'dictionaryentries_zh', es: 'dictionaryentries_es' };

async function repairLanguage(client, language) {
  const table = TABLES[language];
  if (!table) throw new Error(`Unknown language '${language}' — expected zh or es`);

  // Both fields are guarded: the pass may write either side of the invariant.
  const validatedFilter = `AND ${validatedClause(['frequencyScore', 'senseFrequencyScore'], table)}`;
  const params = [];
  const wordsFilter = wordsWhereClause('word1', targetWords, params);

  const { rows } = await client.query(
    `SELECT id, word1, "frequencyScore", "definitionClusters"
       FROM ${table}
      WHERE language = $${params.push(language)}
        AND "definitionClusters" IS NOT NULL
        AND jsonb_array_length("definitionClusters") > 0
        ${DISCOVERABLE_ONLY ? 'AND discoverable = TRUE' : ''}
        ${validatedFilter}
        ${wordsFilter}
      ORDER BY id ASC
      ${LIMIT ? `LIMIT ${LIMIT}` : ''}`,
    params
  );

  console.log(`\n[${language}] ${rows.length} clustered entries examined`);

  const stats = { wordRaised: 0, clusterRaised: 0, both: 0, unchanged: 0, failed: 0 };
  const samples = [];

  for (const row of rows) {
    const before = row.frequencyScore;
    const result = reconcileFrequencyScore(row.frequencyScore, row.definitionClusters);
    if (!result.wordChanged && !result.clustersChanged) { stats.unchanged++; continue; }

    if (result.wordChanged && result.clustersChanged) stats.both++;
    else if (result.wordChanged) stats.wordRaised++;
    else stats.clusterRaised++;

    if (samples.length < 15) {
      samples.push(
        `  ${row.word1}: word ${before} → ${result.wordScore}` +
        (result.raisedSense ? `; sense "${result.raisedSense}" → ${result.wordScore}` : '')
      );
    }

    if (DRY_RUN) continue;
    try {
      // One statement per entry, both columns together — the invariant must never be
      // observable as half-applied by a concurrent read.
      await client.query(
        `UPDATE ${table}
            SET "frequencyScore" = $1,
                "definitionClusters" = $2::jsonb
          WHERE id = $3`,
        [result.wordScore, JSON.stringify(result.clusters), row.id]
      );
    } catch (err) {
      stats.failed++;
      console.error(`  ✖ ${row.word1} (id ${row.id}): ${err.message}`);
    }
  }

  console.log(`[${language}] word raised: ${stats.wordRaised}, default sense raised: ${stats.clusterRaised}, both: ${stats.both}, already consistent: ${stats.unchanged}, failed: ${stats.failed}`);
  if (samples.length) console.log(`[${language}] sample changes:\n${samples.join('\n')}`);
  return stats;
}

async function run() {
  console.log(`Frequency-score drift repair${DRY_RUN ? ' — DRY RUN, no writes' : ''}`);
  const client = await db.getClient();
  try {
    for (const language of LANGUAGES) await repairLanguage(client, language);
  } finally {
    client.release();
  }
  await db.pool.end();
}

run().catch((err) => {
  console.error(err);
  process.exit(1);
});
