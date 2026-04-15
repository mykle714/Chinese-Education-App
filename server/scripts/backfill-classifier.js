/**
 * Backfill Script: AI-powered measure word (量词) classifier for dictionaryentries
 *
 * For each discoverable zh entry where classifier IS NULL, asks Claude Sonnet to:
 *   1. Determine whether the word is a count noun that takes a measure word in Chinese
 *   2. If yes, return the standard measure word(s) as Chinese characters
 *   3. If no (verb, adjective, abstract noun without measure word, etc.), return []
 *
 * The column is left NULL for entries Claude has not yet processed.
 * After processing, it is set to either a non-empty array (e.g. ["辆"]) or an empty
 * array [] — both are "done". NULL means "not yet run".
 *
 * Usage:
 *   docker exec cow-backend-local npx tsx scripts/backfill-classifier.js             # full backfill
 *   docker exec cow-backend-local npx tsx scripts/backfill-classifier.js --spot-check # test 5 entries
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

// --words=未来,摸脉 → scope to specific entries only; omit to target all discoverable entries with classifier IS NULL
const wordsArg = process.argv.find(a => a.startsWith('--words='));
const targetWords = wordsArg ? wordsArg.slice('--words='.length).split(',').map(s => s.trim()).filter(Boolean) : null;
const wordsFilter = targetWords?.length
  ? `AND word1 = ANY(ARRAY[${targetWords.map(w => `'${w.replace(/'/g, "''")}'`).join(', ')}])`
  : '';

/**
 * Ask Claude Sonnet whether a Chinese word takes a measure word (量词), and if so which ones.
 *
 * Returns an array of measure word characters (e.g. ["辆"]) if classifiers exist,
 * or an empty array [] if the word does not take a measure word.
 */
async function askClaudeForClassifiers(word, pronunciation, definitions) {
  const definitionText = Array.isArray(definitions)
    ? definitions.slice(0, 4).join('; ')
    : definitions;

  const prompt = `You are a Chinese linguistics expert.

Word: ${word} (${pronunciation})
Definitions: ${definitionText}

Task: Determine whether "${word}" is a count noun that takes a Chinese measure word (量词/liàngcí).

Rules:
- If it is a concrete or animate noun that Chinese speakers count with a specific measure word, list all standard measure words used with it (most common first).
- Only include measure words that are genuinely standard and natural for this word — not edge-case or poetic usage.
- If it is a verb, adjective, adverb, conjunction, abstract concept that simply uses 个 generically (not as its own dedicated classifier), pronoun, or a word that does not typically take a specific measure word, return an empty array.
- 个 should only be included when it is the dedicated, natural measure word for that specific word — not as a catch-all fallback.

Respond with ONLY a JSON array of Chinese measure word characters, e.g. ["辆"] or ["只", "条"] or [].
No markdown, no explanation.`;

  const response = await anthropic.messages.create({
    model: 'claude-sonnet-4-6',
    max_tokens: 128,
    temperature: 0.1,
    messages: [{ role: 'user', content: prompt }],
  });

  const text = response.content[0].text.trim();
  // Strip markdown code fences if present
  let cleaned = text.replace(/^```(?:json)?\s*/i, '').replace(/\s*```\s*$/, '').trim();
  // Extract outermost JSON array
  const arrMatch = cleaned.match(/\[(?:[^\[\]]|"(?:[^"\\]|\\.)*")*\]/);
  if (arrMatch) cleaned = arrMatch[0];

  const parsed = JSON.parse(cleaned);
  if (!Array.isArray(parsed)) return [];
  return parsed.filter(s => typeof s === 'string' && s.length > 0);
}

async function run() {
  if (isSpotCheck) {
    console.log('🔍 SPOT CHECK MODE — processing 5 entries only\n');
  }
  if (targetWords?.length) console.log(`🎯 Scoped to: ${targetWords.join(', ')}\n`);
  console.log('🚀 Starting AI-powered classifier (量词) backfill...\n');

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
        AND classifier IS NULL
        ${wordsFilter}
      ORDER BY id ASC
      ${isSpotCheck ? 'LIMIT 5' : ''}
    `);

    console.log(`📊 Found ${entries.length} entries needing classifier backfill\n`);

    if (entries.length === 0) {
      console.log('Nothing to process.');
      return;
    }

    let withClassifier = 0;
    let noClassifier = 0;
    let failed = 0;

    for (const row of entries) {
      try {
        process.stdout.write(`  ${row.word1} (${row.pronunciation}) ... `);

        const classifiers = await askClaudeForClassifiers(row.word1, row.pronunciation, row.definitions);

        if (classifiers.length > 0) {
          console.log(`[${classifiers.join(', ')}]`);
          // Store the array; non-empty means this word has dedicated classifiers
          await client.query(
            `UPDATE dictionaryentries SET classifier = $1::jsonb WHERE id = $2`,
            [JSON.stringify(classifiers), row.id]
          );
          withClassifier++;
        } else {
          console.log('no classifier');
          // Store empty array to mark as processed — NULL means "not yet run"
          await client.query(
            `UPDATE dictionaryentries SET classifier = '[]'::jsonb WHERE id = $1`,
            [row.id]
          );
          noClassifier++;
        }
      } catch (err) {
        console.log(`FAILED: ${err.message}`);
        failed++;
      }

      // Small delay to avoid rate-limiting
      await new Promise(r => setTimeout(r, 200));
    }

    console.log('\n' + '='.repeat(60));
    console.log('📊 Backfill Complete!');
    console.log('='.repeat(60));
    console.log(`Total processed  : ${entries.length}`);
    console.log(`With classifier  : ${withClassifier}`);
    console.log(`No classifier    : ${noClassifier}`);
    console.log(`Errors           : ${failed}`);
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
