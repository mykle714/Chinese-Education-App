/**
 * Backfill Script: AI-powered English word forms for dictionaryentries_zh
 *
 * For each discoverable zh entry where "wordForms" IS NULL and partsOfSpeech IS NOT NULL,
 * asks Claude Sonnet to extract the base English word from definitions[0] and produce a map
 * of conjugated/inflected forms keyed by: past, present, future, gerund, adverb, adjective, noun.
 * Only keys relevant to the entry's partsOfSpeech are included.
 *
 * Usage:
 *   docker exec cow-backend-local npx tsx scripts/backfill-word-forms.js               # full backfill
 *   docker exec cow-backend-local npx tsx scripts/backfill-word-forms.js --spot-check  # test 5 entries
 *   docker exec cow-backend-local npx tsx scripts/backfill-word-forms.js --words=跑,快  # specific words
 */

import dotenv from 'dotenv';
import { fileURLToPath } from 'url';
import path from 'path';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
dotenv.config({ path: path.join(__dirname, '../../../.env.docker') });

import Anthropic from '@anthropic-ai/sdk';
import db from '../../../db.js';

const anthropic = new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY });
const isSpotCheck = process.argv.includes('--spot-check');

const wordsArg = process.argv.find(a => a.startsWith('--words='));
const targetWords = wordsArg ? wordsArg.slice('--words='.length).split(',').map(s => s.trim()).filter(Boolean) : null;
const wordsFilter = targetWords?.length
  ? `AND word1 = ANY(ARRAY[${targetWords.map(w => `'${w.replace(/'/g, "''")}'`).join(', ')}])`
  : '';

const ALLOWED_KEYS = new Set(['past', 'present', 'future', 'gerund', 'adverb', 'adjective', 'noun']);

/**
 * Extract the first balanced JSON object from a string.
 * More robust than a greedy regex when the model adds trailing explanation text.
 */
function extractJsonObject(text) {
  const start = text.indexOf('{');
  if (start === -1) return null;
  let depth = 0;
  for (let i = start; i < text.length; i++) {
    if (text[i] === '{') depth++;
    else if (text[i] === '}') {
      depth--;
      if (depth === 0) return text.slice(start, i + 1);
    }
  }
  return null;
}

/**
 * Ask Claude for a wordForms map given the first definition and parts of speech.
 * Returns a Record<string, string> or null on failure.
 */
async function askClaudeForWordForms(word, firstDefinition, partsOfSpeech) {
  const posText = partsOfSpeech.join(', ');

  const prompt = `You are an English linguistics expert helping a Chinese vocabulary app.

Chinese word: ${word}
First English definition: ${firstDefinition}
Parts of speech: ${posText}

Task: Extract the base English word from the definition (strip "to ", articles, and parenthetical notes), then produce a JSON object containing ONLY the forms relevant to the given parts of speech:

- If parts of speech includes "verb" AND the base English word is actually a real English verb (e.g. "run", "learn", "like"): include "past", "present" (3rd person singular), "future" (with "will"), and "gerund" (present participle)
- If parts of speech includes "adverb": include "adverb"
- If parts of speech includes "adjective": include "adjective" (the base adjective form)
- If parts of speech includes "noun": include "noun"

CRITICAL RULE — adjectives tagged as verbs:
If the base English word is an adjective (e.g. "happy", "fast", "good") but the POS includes "verb", do NOT generate verb conjugations for the adjective. Instead, only include the "adjective" key. Chinese adjectives are often tagged as verbs grammatically, but "happy" does not conjugate as an English verb.

Rules:
- Use the actual correctly inflected English word — not a template like "{word}ed"
- Handle irregular verbs (e.g. "run" → past: "ran", not "runned")
- Only include keys that are applicable to the parts of speech given
- Values must be non-empty strings

Examples:
  word=跑, definition="to run", pos=["verb"] → {"past":"ran","present":"runs","future":"will run","gerund":"running"}
  word=快, definition="fast", pos=["adjective","adverb"] → {"adjective":"fast","adverb":"quickly"}
  word=高兴, definition="happy", pos=["adjective","verb"] → {"adjective":"happy"}  ← adjective only, "happy" is not a real English verb
  word=喜欢, definition="to like", pos=["verb"] → {"past":"liked","present":"likes","future":"will like","gerund":"liking"}
  word=书, definition="book", pos=["noun"] → {"noun":"book"}

Respond with ONLY valid JSON, no explanation.`;

  const response = await anthropic.messages.create({
    model: 'claude-sonnet-4-6',
    max_tokens: 256,
    temperature: 0,
    messages: [{ role: 'user', content: prompt }],
  });

  const text = response.content[0].text.trim();
  const cleaned = text.replace(/^```(?:json)?\s*/i, '').replace(/\s*```\s*$/, '').trim();
  const extracted = extractJsonObject(cleaned);
  if (!extracted) return null;

  const parsed = JSON.parse(extracted);
  if (typeof parsed !== 'object' || Array.isArray(parsed)) return null;

  // Validate keys and values
  const result = {};
  for (const [key, val] of Object.entries(parsed)) {
    if (ALLOWED_KEYS.has(key) && typeof val === 'string' && val.trim().length > 0) {
      result[key] = val.trim();
    }
  }
  return Object.keys(result).length > 0 ? result : null;
}

async function run() {
  if (isSpotCheck) console.log('🔍 SPOT CHECK MODE — processing 5 entries only\n');
  if (targetWords?.length) console.log(`🎯 Scoped to: ${targetWords.join(', ')}\n`);
  console.log('🚀 Starting AI-powered word forms backfill...\n');

  if (!process.env.ANTHROPIC_API_KEY) {
    console.error('❌ ANTHROPIC_API_KEY not set');
    process.exit(1);
  }

  const client = await db.getClient();

  try {
    const { rows: entries } = await client.query(`
      SELECT id, word1, pronunciation, definitions, "partsOfSpeech"
      FROM dictionaryentries_zh
      WHERE language = 'zh'
        AND discoverable = TRUE
        AND "wordForms" IS NULL
        AND "partsOfSpeech" IS NOT NULL
        AND jsonb_array_length("partsOfSpeech") > 0
        ${wordsFilter}
      ORDER BY id ASC
      ${isSpotCheck ? 'LIMIT 5' : ''}
    `);

    console.log(`📊 Found ${entries.length} entries needing word forms backfill\n`);
    if (entries.length === 0) {
      console.log('Nothing to process.');
      return;
    }

    let updated = 0;
    let failed = 0;

    for (const row of entries) {
      const firstDefinition = Array.isArray(row.definitions) ? row.definitions[0] : null;
      if (!firstDefinition) {
        console.log(`  ${row.word1}: SKIPPED — no definitions`);
        failed++;
        continue;
      }

      try {
        process.stdout.write(`  ${row.word1} [${row.partsOfSpeech.join(', ')}] ... `);

        const wordForms = await askClaudeForWordForms(row.word1, firstDefinition, row.partsOfSpeech);

        if (!wordForms) {
          // No applicable forms for this POS (e.g. classifier, conjunction) — write {} to mark
          // as processed so it is not retried on future runs. Falls back to base definition at runtime.
          await client.query(
            `UPDATE dictionaryentries_zh SET "wordForms" = '{}'::jsonb WHERE id = $1`,
            [row.id]
          );
          console.log('(no applicable forms — marked as processed)');
          updated++;
          continue;
        }

        await client.query(
          `UPDATE dictionaryentries_zh SET "wordForms" = $1::jsonb WHERE id = $2`,
          [JSON.stringify(wordForms), row.id]
        );

        console.log(JSON.stringify(wordForms));
        updated++;
      } catch (err) {
        console.log(`FAILED: ${err.message}`);
        failed++;
      }

      await new Promise(r => setTimeout(r, 200));
    }

    console.log('\n' + '='.repeat(60));
    console.log('📊 Word Forms Backfill Complete!');
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
