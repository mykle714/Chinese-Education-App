/**
 * Backfill Script: AI-powered HSK level assignment for dictionaryentries
 *
 * For each discoverable zh entry where hskLevel IS NULL, asks Claude Sonnet
 * to assign a single HSK level from HSK1..HSK6 based on common learner-level usage.
 *
 * Usage:
 *   docker exec cow-backend-local npx tsx scripts/backfill-hsk-level.js               # full backfill
 *   docker exec cow-backend-local npx tsx scripts/backfill-hsk-level.js --spot-check  # test 5 entries
 */

import dotenv from 'dotenv';
import { fileURLToPath } from 'url';
import path from 'path';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
dotenv.config({ path: path.join(__dirname, '../.env.docker') });

import Anthropic from '@anthropic-ai/sdk';
import db from '../db.js';

const anthropic = new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY });
const isSpotCheck = process.argv.includes('--spot-check');

// --words=未来,摸脉 → scope to specific entries only; omit to target all discoverable entries with hskLevel IS NULL
const wordsArg = process.argv.find(a => a.startsWith('--words='));
const targetWords = wordsArg ? wordsArg.slice('--words='.length).split(',').map(s => s.trim()).filter(Boolean) : null;
const wordsFilter = targetWords?.length
  ? `AND word1 = ANY(ARRAY[${targetWords.map(w => `'${w.replace(/'/g, "''")}'`).join(', ')}])`
  : '';

/**
 * Ask Claude for the best-fit HSK level for a Chinese word.
 * Returns one of HSK1..HSK6, or null if parsing fails.
 */
async function askClaudeForHskLevel(word, pronunciation, definitions) {
  const definitionText = Array.isArray(definitions)
    ? definitions.slice(0, 5).join('; ')
    : String(definitions ?? '');

  const prompt = `You are a Chinese pedagogy expert.

Word: ${word}
Pronunciation: ${pronunciation || 'N/A'}
Definitions: ${definitionText}

Task: Assign exactly one HSK level for this word.

Rules:
- Return one label only: HSK1, HSK2, HSK3, HSK4, HSK5, or HSK6.
- Choose the level where this word is most appropriate for typical learners.
- If the word is uncommon, literary, technical, or proper-noun-like, still choose the closest higher level (usually HSK6).
- Do not include explanation.

Respond with ONLY the level token.`;

  const response = await anthropic.messages.create({
    model: 'claude-sonnet-4-6',
    max_tokens: 16,
    temperature: 0,
    messages: [{ role: 'user', content: prompt }],
  });

  const text = response.content[0].text.trim().toUpperCase();
  const match = text.match(/HSK[1-6]/);
  return match ? match[0] : null;
}

async function run() {
  if (isSpotCheck) {
    console.log('🔍 SPOT CHECK MODE — processing 5 entries only\n');
  }
  if (targetWords?.length) console.log(`🎯 Scoped to: ${targetWords.join(', ')}\n`);
  console.log('🚀 Starting AI-powered HSK level backfill...\n');

  if (!process.env.ANTHROPIC_API_KEY) {
    console.error('❌ ANTHROPIC_API_KEY not set');
    process.exit(1);
  }

  const client = await db.getClient();

  try {
    const { rows: entries } = await client.query(`
      SELECT id, word1, pronunciation, definitions
      FROM dictionaryentries
      WHERE language = 'zh'
        AND discoverable = TRUE
        AND "hskLevel" IS NULL
        ${wordsFilter}
      ORDER BY id ASC
      ${isSpotCheck ? 'LIMIT 5' : ''}
    `);

    console.log(`📊 Found ${entries.length} entries needing HSK level backfill\n`);

    if (entries.length === 0) {
      console.log('Nothing to process.');
      return;
    }

    let updated = 0;
    let failed = 0;

    for (const row of entries) {
      try {
        process.stdout.write(`  ${row.word1} (${row.pronunciation || 'N/A'}) ... `);

        const hskLevel = await askClaudeForHskLevel(row.word1, row.pronunciation, row.definitions);

        if (!hskLevel) {
          console.log('FAILED: could not parse HSK level');
          failed++;
          continue;
        }

        await client.query(
          `UPDATE dictionaryentries SET "hskLevel" = $1 WHERE id = $2`,
          [hskLevel, row.id]
        );

        console.log(hskLevel);
        updated++;
      } catch (err) {
        console.log(`FAILED: ${err.message}`);
        failed++;
      }

      await new Promise(r => setTimeout(r, 200));
    }

    console.log('\n' + '='.repeat(60));
    console.log('📊 Backfill Complete!');
    console.log('='.repeat(60));
    console.log(`Total processed : ${entries.length}`);
    console.log(`Updated         : ${updated}`);
    console.log(`Errors          : ${failed}`);
    console.log('='.repeat(60) + '\n');
  } finally {
    client.release();
    await db.end?.();
  }
}

run().catch(err => {
  console.error('❌ Script failed:', err);
  process.exit(1);
});
