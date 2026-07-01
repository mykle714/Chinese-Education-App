/**
 * Backfill Script: AI-powered vernacular register scoring for dictionaryentries_zh
 *
 * For each discoverable zh entry where "vernacularScore" IS NULL, asks Claude Sonnet
 * to score how vernacular (everyday spoken) vs. literary/formal the word is:
 *
 *   5 = Natural vernacular — everyday spoken Mandarin; sounds completely natural in casual speech
 *   4 = Informal-leaning — more common in speech than writing; slightly colloquial feel
 *   3 = Neutral register — appropriate in both spoken and written contexts; no strong register markedness
 *   2 = Formal/written-leaning — more at home in writing, news, or formal speech than casual conversation
 *   1 = Literary/classical/formal only — archaic, poetic, or restricted to written/formal contexts; sounds unnatural in everyday speech
 *
 * NULL means "not yet scored". After processing, the column holds an integer 1–5.
 *
 * Usage:
 *   docker exec cow-backend-local npx tsx scripts/backfill-vernacular-score.js                          # full backfill
 *   docker exec cow-backend-local npx tsx scripts/backfill-vernacular-score.js --spot-check             # test 5 entries with reasoning
 *   docker exec cow-backend-local npx tsx scripts/backfill-vernacular-score.js --spot-check --random    # random 5 entries
 *   docker exec cow-backend-local npx tsx scripts/backfill-vernacular-score.js --spot-check --random --limit=25
 */

import dotenv from 'dotenv';
import { fileURLToPath } from 'url';
import path from 'path';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
dotenv.config({ path: path.join(__dirname, '../../../.env.docker') });

import Anthropic from '@anthropic-ai/sdk';
import db from '../../../db.js';
import { initRunLog } from '../run-log.js';
import { createVernacularScorer, SCORE_LABELS } from './lib/vernacularScore.js';
const SCRIPT_VERSION = 1; // bump when this script's logic/prompt changes

const anthropic = new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY });

// run-log: track duration, version, words/mode, and token usage/cost
const { stampEntries } = initRunLog({ script: 'chinese/backfill-vernacular-score', version: SCRIPT_VERSION, anthropic: anthropic });

const isSpotCheck = process.argv.includes('--spot-check');
const isRandom = process.argv.includes('--random');
const limitArg = process.argv.find(a => a.startsWith('--limit='));
const spotCheckLimit = limitArg ? parseInt(limitArg.split('=')[1], 10) : 5;

// The rubric + scorer live in the shared lib (./lib/vernacularScore.js) so the
// definition-clustering backfill scores each sense cluster on the identical 1–5
// scale. Spot-check mode asks for one-line reasoning alongside the score.
const { scoreVernacular } = createVernacularScorer({ anthropic });

async function run() {
  if (isSpotCheck) {
    console.log(`SPOT CHECK MODE — processing ${spotCheckLimit} entries with reasoning${isRandom ? ' (random sample)' : ''}\n`);
  }
  console.log('Starting AI-powered vernacularScore backfill...\n');

  if (!process.env.ANTHROPIC_API_KEY) {
    console.error('ANTHROPIC_API_KEY not set');
    process.exit(1);
  }

  const client = await db.getClient();

  try {
    const { rows: entries } = await client.query(`
      SELECT id, word1, pronunciation, definitions
      FROM dictionaryentries_zh
      WHERE language = 'zh'
        AND discoverable = TRUE
        AND "vernacularScore" IS NULL
      ORDER BY ${isRandom ? 'RANDOM()' : 'id ASC'}
      ${isSpotCheck ? `LIMIT ${spotCheckLimit}` : ''}
    `);

    console.log(`Found ${entries.length} entries needing vernacularScore backfill\n`);

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

        const result = await scoreVernacular(row.word1, row.pronunciation, row.definitions, { withReasoning: isSpotCheck });

        if (isSpotCheck) {
          console.log(`${result.score}  |  ${result.reasoning}`);
        } else {
          console.log(`${result.score}`);
        }

        await client.query(
          `UPDATE dictionaryentries_zh SET "vernacularScore" = $1 WHERE id = $2`,
          [result.score, row.id]
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
