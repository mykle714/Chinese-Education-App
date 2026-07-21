/**
 * Backfill Script: AI-powered definition-array processing for dictionaryentries_zh
 *
 * Two jobs in one pass over the `definitions` array:
 *   (a) REORDER the glosses from most to least useful for a modern learner.
 *   (b) PRUNE very low-confidence glosses — broken English, or incredibly
 *       rare/archaic senses already covered by another gloss. Exclusively
 *       parenthetical glosses (e.g. "(literary)") are KEPT but may never rank
 *       first. The model may drop but never add or rephrase a string.
 *
 * Two-pass design:
 *   Pass 1 (Sonnet) — first ordering + pruning using a tuned prompt with few-shots.
 *   Pass 2 (Sonnet) — critic that sees the original list + Pass 1's output,
 *     and either confirms, refines with a one-line reason, or flags
 *     low_confidence for human review. The critic may also restore a wrongly
 *     dropped gloss or prune one the junior missed.
 *   On validation failure (added/rephrased element, empty result, JSON), the
 *   prompt is retried on Opus before giving up. A parenthetical-only gloss that
 *   leads is fixed up locally (second entry promoted), not retried.
 *
 * Short leading gloss (post-pass):
 *   After ordering/pruning, if the final leading definition is longer than
 *   MAX_FIRST_GLOSS_LEN (20) chars, a single short (≤20 char) gloss for the word
 *   is synthesized (Sonnet, Opus on retry) and PREPENDED, keeping the long gloss
 *   right behind it. This is the only step that intentionally writes a
 *   NON-source string, so every generated gloss is surfaced in the review log.
 *
 * Disagreements (Pass 2 ≠ Pass 1), low_confidence flags, any pruned glosses, and
 * every generated short gloss are dumped to a timestamped review file in /tmp so
 * the user can skim post-run.
 *
 * Usage:
 *   npx tsx scripts/backfill/chinese/backfill-process-definitions-array.js                # discoverable zh entries
 *   npx tsx scripts/backfill/chinese/backfill-process-definitions-array.js --all          # all zh entries
 *   npx tsx scripts/backfill/chinese/backfill-process-definitions-array.js --spot-check   # 5 entries, no writes
 *   npx tsx scripts/backfill/chinese/backfill-process-definitions-array.js --ids=1,2,3    # target specific IDs
 *   npx tsx scripts/backfill/chinese/backfill-process-definitions-array.js --no-critic    # skip Pass 2
 */

import dotenv from 'dotenv';
import { fileURLToPath } from 'url';
import path from 'path';
import fs from 'fs';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
dotenv.config({ path: path.join(__dirname, '../../../.env.docker') });

import Anthropic from '@anthropic-ai/sdk';
import db from '../../../db.js';
import { initRunLog, cachedSystem } from '../run-log.js';
import { createGlossOrderer, MAX_FIRST_GLOSS_LEN } from './lib/orderGlosses.js';
const SCRIPT_VERSION = 3; // bump when this script's logic/prompt changes

const isSpotCheck = process.argv.includes('--spot-check');
const includeAll  = process.argv.includes('--all');
const skipCritic  = process.argv.includes('--no-critic');

const idsArg = process.argv.find(a => a.startsWith('--ids='));
const targetIds = idsArg ? idsArg.replace('--ids=', '').split(',').map(Number) : null;

// --words=未来,摸脉 → scope to specific entries only
const wordsArg = process.argv.find(a => a.startsWith('--words='));
const targetWords = wordsArg ? wordsArg.slice('--words='.length).split(',').map(s => s.trim()).filter(Boolean) : null;

const anthropic = new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY });

// run-log: track duration, version, words/mode, and token usage/cost
const { stampEntries, validatedClause } = initRunLog({ script: 'chinese/backfill-process-definitions-array', version: SCRIPT_VERSION, anthropic: anthropic });
// Never rewrite the definitions array on an entry whose definitions bundle a
// validator has approved/flagged (migration 104, docs/DATA_VALIDATION_SYSTEM.md).
const validatedFilter = `AND ${validatedClause(['definitions'], 'dictionaryentries_zh')}`;

const PASS1_MODEL = 'claude-sonnet-4-6';
const PASS2_MODEL = 'claude-sonnet-4-6';
const RETRY_MODEL = 'claude-opus-4-8'; // used when a Sonnet response fails validation

const REVIEW_LOG_PATH = `/tmp/process-definitions-array-review-${Date.now()}.log`;

// Ordering primitives (prompts, validation, retry, short-gloss synthesis) live
// in the shared lib (./lib/orderGlosses.js) so the definition-clustering
// backfill reuses the identical Pass-1/Pass-2 pipeline — one source of truth.
// MAX_FIRST_GLOSS_LEN is imported alongside.
const { pass1Sort, pass2Critique, generateShortGloss } = createGlossOrderer({
  anthropic,
  cachedSystem,
  pass1Model: PASS1_MODEL,
  pass2Model: PASS2_MODEL,
  retryModel: RETRY_MODEL,
});

// ─── Review log ─────────────────────────────────────────────────────────────

let reviewEntries = [];

function logReview(entry) {
  reviewEntries.push(entry);
}

function flushReviewLog() {
  if (reviewEntries.length === 0) return;
  const out = reviewEntries.map(e => {
    return [
      `[${e.id}] ${e.word} (${e.action})`,
      `  Original: ${JSON.stringify(e.original)}`,
      `  Pass 1:   ${JSON.stringify(e.pass1)}`,
      `  Final:    ${JSON.stringify(e.final)}`,
      e.dropped && e.dropped.length ? `  Dropped:  ${JSON.stringify(e.dropped)}` : null,
      e.generated ? `  Generated: ${JSON.stringify(e.generated)} (synthetic leading gloss)` : null,
      e.reason ? `  Reason:   ${e.reason}` : null,
    ].filter(Boolean).join('\n');
  }).join('\n\n');
  fs.writeFileSync(REVIEW_LOG_PATH, out + '\n');
  console.log(`\nReview log written to ${REVIEW_LOG_PATH} (${reviewEntries.length} entries)`);
}

// ─── Main ───────────────────────────────────────────────────────────────────

async function run() {
  if (!process.env.ANTHROPIC_API_KEY) {
    console.error('ANTHROPIC_API_KEY not set');
    process.exit(1);
  }

  const modeLabel = isSpotCheck ? 'SPOT CHECK' : targetWords?.length ? `scoped to: ${targetWords.join(', ')}` : includeAll ? 'ALL zh entries' : 'discoverable zh entries';
  const criticLabel = skipCritic ? ' (Pass 1 only)' : ' (Pass 1 + critic)';
  console.log(`Starting AI definition-array processing backfill — ${modeLabel}${criticLabel}\n`);

  const client = await db.getClient();

  try {
    const { rows: entries } = await client.query(
      targetIds
        ? `SELECT id, word1, pronunciation, definitions
           FROM dictionaryentries_zh
           WHERE id = ANY($1)
           ORDER BY id ASC`
        : targetWords?.length
        ? `SELECT id, word1, pronunciation, definitions
           FROM dictionaryentries_zh
           WHERE language = 'zh'
             AND word1 = ANY($1)
             ${validatedFilter}
             AND jsonb_array_length(definitions) > 1
           ORDER BY id ASC`
        : `SELECT id, word1, pronunciation, definitions
           FROM dictionaryentries_zh
           WHERE language = 'zh'
             ${includeAll ? '' : 'AND discoverable = TRUE'}
             ${validatedFilter}
             AND jsonb_array_length(definitions) > 1
           ORDER BY id ASC
           ${isSpotCheck ? 'LIMIT 5' : ''}`,
      targetIds ? [targetIds] : targetWords?.length ? [targetWords] : []
    );

    console.log(`Found ${entries.length} entries to process\n`);

    let updated  = 0;
    let unchanged = 0;
    let failed   = 0;
    let confirmed = 0;
    let refined   = 0;
    let lowConf   = 0;
    let opusRetries = 0;
    let glossesPruned = 0; // total glosses removed across all entries
    let shortGenerated = 0; // total synthetic short leading glosses prepended

    for (const row of entries) {
      const definitions = Array.isArray(row.definitions)
        ? row.definitions
        : JSON.parse(row.definitions || '[]');

      try {
        process.stdout.write(`  [${row.id}] ${row.word1} (${definitions.length} defs) ... `);

        const p1 = await pass1Sort(row.word1, definitions);
        if (p1.error) {
          console.log(`FAIL pass1 (${p1.error})`);
          failed++;
          continue;
        }
        if (p1.retried) opusRetries++;

        let finalOrder = p1.order;
        let action = 'pass1_only';
        let reason = '';

        if (!skipCritic) {
          const p2 = await pass2Critique(row.word1, definitions, p1.order);
          if (p2.retried) opusRetries++;
          if (p2.error) {
            console.log(`pass2 fail (${p2.error}) — using pass1`);
            // Keep p1 result, but log for review
            logReview({
              id: row.id, word: row.word1, action: 'pass2_failed',
              original: definitions, pass1: p1.order, final: p1.order,
              reason: `Critic error: ${p2.error}`,
            });
          } else {
            action = p2.action;
            finalOrder = p2.order;
            reason = p2.reason;
            if (action === 'confirmed') confirmed++;
            else if (action === 'refined') refined++;
            else if (action === 'low_confidence') lowConf++;
          }
        }

        // Short leading-gloss synthesis: if the curated leading definition is too
        // long for the card headline, prepend a freshly generated short gloss
        // (keeping the long one right behind it). This is the one place we write a
        // non-source string, so it is always surfaced for human review.
        let generatedFirst = null;
        if (finalOrder.length && finalOrder[0].length > MAX_FIRST_GLOSS_LEN) {
          const sg = await generateShortGloss(row.word1, finalOrder);
          if (sg.retried) opusRetries++;
          if (sg.error) {
            console.log(`short-gloss fail (${sg.error}) — leaving long gloss first`);
            logReview({
              id: row.id, word: row.word1, action: 'short_gloss_failed',
              original: definitions, pass1: p1.order, final: finalOrder,
              reason: `Short-gloss error: ${sg.error}`,
            });
          } else {
            generatedFirst = sg.gloss;
            // De-dupe: if the model echoed an existing gloss, promote it rather
            // than inserting a duplicate.
            finalOrder = [generatedFirst, ...finalOrder.filter(d => d !== generatedFirst)];
            shortGenerated++;
          }
        }

        const orderChanged = JSON.stringify(finalOrder) !== JSON.stringify(definitions);
        const pass2Disagreed = !skipCritic && JSON.stringify(finalOrder) !== JSON.stringify(p1.order);
        // Glosses present in the original but pruned from the final result.
        const finalSet = new Set(finalOrder);
        const droppedGlosses = definitions.filter(d => !finalSet.has(d));

        // Log entries that need human review:
        // - refined (critic overrode pass1)
        // - low_confidence (critic uncertain)
        // - any pruning (removals are destructive — always surface for review)
        // - any generated short gloss (synthetic non-source string)
        if (action === 'refined' || action === 'low_confidence' || droppedGlosses.length || generatedFirst) {
          logReview({
            id: row.id, word: row.word1, action,
            original: definitions, pass1: p1.order, final: finalOrder,
            dropped: droppedGlosses, generated: generatedFirst, reason,
          });
        }

        if (!orderChanged) {
          console.log(`unchanged${pass2Disagreed ? ' (pass2 differed but matched original)' : ''}`);
          // Stamp even though no UPDATE ran: this version of the prompt genuinely executed
          // and its verdict was "the stored order is already correct". Without the stamp the
          // row stays version-0 forever and is re-selected and re-answered on every run.
          await stampEntries(client, 'dictionaryentries_zh', row.id);
          unchanged++;
          continue;
        }

        if (isSpotCheck) {
          console.log(`[${action}]`);
          console.log(`    Before: ${JSON.stringify(definitions)}`);
          console.log(`    Pass1:  ${JSON.stringify(p1.order)}`);
          if (pass2Disagreed) console.log(`    Final:  ${JSON.stringify(finalOrder)}  ← critic refined`);
          if (droppedGlosses.length) console.log(`    Pruned: ${JSON.stringify(droppedGlosses)}`);
          if (generatedFirst) console.log(`    Short:  ${JSON.stringify(generatedFirst)}  ← generated leading gloss`);
          if (reason) console.log(`    Reason: ${reason}`);
          unchanged++; // not actually written
          continue;
        }

        await client.query(
          `UPDATE dictionaryentries_zh SET definitions = $1::jsonb WHERE id = $2`,
          [JSON.stringify(finalOrder), row.id]
        );
        await stampEntries(client, 'dictionaryentries_zh', row.id);

        updated++;
        glossesPruned += droppedGlosses.length;
        const tag = droppedGlosses.length
          ? `processed [${action}], pruned ${droppedGlosses.length}`
          : `processed [${action}]`;
        console.log(tag);

        if (updated % 100 === 0) {
          const pct = Math.round(updated / entries.length * 100);
          console.log(`\n  Progress: ${updated}/${entries.length} (${pct}%)\n`);
        }

      } catch (err) {
        console.log(`FAILED: ${err.message}`);
        failed++;
      }

      await new Promise(r => setTimeout(r, 200));
    }

    console.log('\n' + '='.repeat(60));
    console.log('BACKFILL SUMMARY');
    console.log('='.repeat(60));
    console.log(`Total processed : ${entries.length}`);
    if (isSpotCheck) {
      console.log(`(Spot check — no writes performed)`);
    } else {
      console.log(`Updated         : ${updated}`);
      console.log(`Unchanged       : ${unchanged}`);
      console.log(`Failed/invalid  : ${failed}`);
      console.log(`Glosses pruned  : ${glossesPruned}`);
    }
    console.log(`Short glosses   : ${shortGenerated} generated`);
    if (!skipCritic) {
      console.log(`Critic confirmed: ${confirmed}`);
      console.log(`Critic refined  : ${refined}`);
      console.log(`Low confidence  : ${lowConf}`);
    }
    console.log(`Opus retries    : ${opusRetries}`);
    console.log('='.repeat(60));

    flushReviewLog();

  } finally {
    client.release();
    await db.pool.end();
  }
}

run().catch(err => {
  console.error('Fatal error:', err);
  process.exit(1);
});
