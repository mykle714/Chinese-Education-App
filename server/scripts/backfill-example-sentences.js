/**
 * Backfill Script: AI-powered example sentences for dictionaryentries
 *
 * For each discoverable zh entry with no exampleSentences, uses Claude AI to generate
 * 3 natural, contextually appropriate example sentences using the word in different
 * grammatical roles. Each sentence includes Chinese, English translation, and a usage label.
 *
 * Run the metadata backfill after this script completes:
 *   npx tsx /app/scripts/backfill-example-sentences-metadata.js
 *
 * Usage:
 *   npx tsx /app/scripts/backfill-example-sentences.js             # full backfill
 *   npx tsx /app/scripts/backfill-example-sentences.js --spot-check # test 3 entries
 */

import dotenv from 'dotenv';
import { fileURLToPath } from 'url';
import path from 'path';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
dotenv.config({ path: path.join(__dirname, '../.env.docker') });

import Anthropic from '@anthropic-ai/sdk';
import db from '../db.js';

const anthropic = new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY });

// When --spot-check is passed, process only 3 entries and print full sentence output
const isSpotCheck = process.argv.includes('--spot-check');

/**
 * Ask Claude to generate 3 natural example sentences for a Chinese word.
 * Returns an array of { chinese, english, usage } objects.
 */
async function generateExampleSentences(word, pronunciation, definitions) {
  const definitionText = Array.isArray(definitions) ? definitions.slice(0, 3).join('; ') : definitions;

  const prompt = `You are a Chinese language teacher creating example sentences for a vocabulary app.

Word: ${word} (${pronunciation})
Meaning: ${definitionText}

Write exactly 3 natural example sentences using "${word}". Each sentence should:
- Use the word naturally as a native speaker would
- Be simple enough for an intermediate learner (HSK 3–4 level vocabulary otherwise)
- Show a different grammatical role or context for the word
- Have an accurate English translation

Choose 3 distinct usage labels from: subject, object, verb, modifier, prepositional, question, negation, complement

Respond with ONLY a JSON array in this exact format (no markdown, no explanation):
[
  { "usage": "label", "chinese": "Chinese sentence", "english": "English translation" },
  { "usage": "label", "chinese": "Chinese sentence", "english": "English translation" },
  { "usage": "label", "chinese": "Chinese sentence", "english": "English translation" }
]`;

  const response = await anthropic.messages.create({
    model: 'claude-sonnet-4-6',
    max_tokens: 512,
    temperature: 0.7,
    messages: [{ role: 'user', content: prompt }],
  });

  const text = response.content[0].text.trim();
  // Strip markdown code fences if present
  let cleaned = text.replace(/^```(?:json)?\s*/i, '').replace(/\s*```\s*$/, '').trim();
  // Extract outermost JSON array
  const arrMatch = cleaned.match(/\[[\s\S]*\]/);
  if (arrMatch) cleaned = arrMatch[0];

  const parsed = JSON.parse(cleaned);
  if (!Array.isArray(parsed) || parsed.length === 0) return null;

  // Validate each sentence has required fields
  const valid = parsed.filter(s =>
    s && typeof s.chinese === 'string' && s.chinese.length > 0 &&
    typeof s.english === 'string' && s.english.length > 0 &&
    typeof s.usage === 'string' && s.usage.length > 0
  );

  return valid.length > 0 ? valid : null;
}

async function run() {
  if (isSpotCheck) {
    console.log('🔍 SPOT CHECK MODE — processing 3 entries only\n');
  }
  console.log('🚀 Starting AI-powered example sentences backfill...\n');

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
        AND ("exampleSentences" IS NULL OR "exampleSentences" = '[]'::jsonb)
      ORDER BY id ASC
      ${isSpotCheck ? 'LIMIT 3' : ''}
    `);

    console.log(`📊 Found ${entries.length} entries needing example sentences\n`);

    let updated = 0;
    let failed = 0;

    for (const row of entries) {
      try {
        process.stdout.write(`  ${row.word1} (${row.pronunciation}) ... `);

        const sentences = await generateExampleSentences(row.word1, row.pronunciation, row.definitions);

        if (!sentences) {
          console.log('no valid sentences returned');
          failed++;
          continue;
        }

        await client.query(
          `UPDATE dictionaryentries SET "exampleSentences" = $1::jsonb WHERE id = $2`,
          [JSON.stringify(sentences), row.id]
        );

        updated++;

        if (isSpotCheck) {
          // Print full sentence details in spot-check mode
          console.log(`✓ (${sentences.length} sentences)`);
          for (const s of sentences) {
            console.log(`    [${s.usage}] ${s.chinese}`);
            console.log(`           ${s.english}`);
          }
        } else {
          console.log(`✓`);
          if (updated % 50 === 0) {
            console.log(`\n📈 Progress: ${updated}/${entries.length} (${Math.round(updated / entries.length * 100)}%)\n`);
          }
        }
      } catch (err) {
        console.log(`FAILED: ${err.message}`);
        failed++;
      }

      // Small delay to avoid hammering the API
      await new Promise(r => setTimeout(r, 300));
    }

    console.log('\n' + '='.repeat(60));
    console.log(isSpotCheck ? '📊 Spot Check Complete!' : '📊 Backfill Complete!');
    console.log('='.repeat(60));
    console.log(`Total processed : ${entries.length}`);
    console.log(`Updated         : ${updated}`);
    console.log(`Failed          : ${failed}`);
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
