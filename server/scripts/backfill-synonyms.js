/**
 * Backfill Script: AI-powered synonyms for dictionaryentries
 *
 * For each discoverable zh entry with no synonyms, uses Claude AI to identify
 * genuine Chinese synonyms, verifies each exists in dictionaryentries, and writes
 * the validated list back to the row. Synonym metadata (pronunciation, definition)
 * is computed at runtime by the server.
 *
 * Usage: docker exec cow-backend-local npx tsx scripts/backfill-synonyms.js
 */

import dotenv from 'dotenv';
import { fileURLToPath } from 'url';
import path from 'path';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
dotenv.config({ path: path.join(__dirname, '../.env.docker') });

import Anthropic from '@anthropic-ai/sdk';
import db from '../db.js';

const anthropic = new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY });

// --words=未来,摸脉 → scope to specific entries only; omit to target all discoverable entries with synonyms IS NULL
const wordsArg = process.argv.find(a => a.startsWith('--words='));
const targetWords = wordsArg ? wordsArg.slice('--words='.length).split(',').map(s => s.trim()).filter(Boolean) : null;
const wordsFilter = targetWords?.length
  ? `AND word1 = ANY(ARRAY[${targetWords.map(w => `'${w.replace(/'/g, "''")}'`).join(', ')}])`
  : '';

/**
 * Ask Claude for synonyms of a Chinese word.
 * Returns an array of Chinese word strings (may be empty).
 */
async function askClaudeForSynonyms(word, pronunciation, definitions) {
  const definitionText = definitions.join('; ');

  const prompt = `You are a Chinese language expert.

Word: ${word} (${pronunciation})
Definitions: ${definitionText}

List up to 4 Chinese words that are genuine, exact synonyms of "${word}".
Only include words that a native speaker would actually consider synonymous or interchangeable in at least some contexts.
Each synonym must be no more than 4 Chinese characters long.
Do NOT include the word itself, antonyms, loosely related words, or any word longer than 4 characters.

Respond with ONLY a JSON array of Chinese word strings, e.g. ["工作", "打工"] or [] if there are no good synonyms.`;

  const response = await anthropic.messages.create({
    model: 'claude-sonnet-4-6',
    max_tokens: 256,
    temperature: 0.2,
    messages: [{ role: 'user', content: prompt }],
  });

  const text = response.content[0].text.trim();
  // Strip markdown code fences if present
  let cleaned = text.replace(/^```(?:json)?\s*/i, '').replace(/\s*```\s*$/, '').trim();
  // Extract JSON array: find outermost [...] block
  const arrMatch = cleaned.match(/\[(?:[^\[\]]|"(?:[^"\\]|\\.)*")*\]/);
  if (arrMatch) cleaned = arrMatch[0];
  const parsed = JSON.parse(cleaned);
  if (!Array.isArray(parsed)) return [];
  return parsed.filter(s => typeof s === 'string' && s.length > 0);
}

/**
 * Given a list of candidate synonym words, return those that exist in dictionaryentries (zh).
 * Note: synonymsMetadata is now computed at runtime by the server, not stored in the DB.
 */
async function validateSynonyms(client, candidates) {
  if (candidates.length === 0) return [];

  const placeholders = candidates.map((_, i) => `$${i + 1}`).join(', ');
  const result = await client.query(
    `SELECT word1
     FROM dictionaryentries
     WHERE language = 'zh' AND word1 = ANY(ARRAY[${placeholders}])`,
    candidates
  );

  const found = new Set(result.rows.map(r => r.word1));
  return candidates.filter(c => found.has(c));
}

async function run() {
  if (targetWords?.length) console.log(`🎯 Scoped to: ${targetWords.join(', ')}\n`);
  console.log('🚀 Starting AI-powered synonyms backfill...\n');

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
        AND (synonyms IS NULL OR synonyms = '[]'::jsonb)
        ${wordsFilter}
      ORDER BY id ASC
    `);

    console.log(`📊 Found ${entries.length} entries needing synonyms\n`);

    let updated = 0;
    let skipped = 0;
    let failed = 0;

    for (const row of entries) {
      try {
        process.stdout.write(`  ${row.word1} (${row.pronunciation}) ... `);

        const candidates = await askClaudeForSynonyms(row.word1, row.pronunciation, row.definitions);

        if (candidates.length === 0) {
          console.log('no synonyms found');
          // Write empty array so we don't reprocess this entry next time
          await client.query(
            `UPDATE dictionaryentries SET synonyms = '[]'::jsonb WHERE id = $1`,
            [row.id]
          );
          skipped++;
          continue;
        }

        const valid = await validateSynonyms(client, candidates);

        console.log(`${valid.length > 0 ? valid.join(', ') : 'none verified in DB'} (candidates: ${candidates.join(', ')})`);

        await client.query(
          `UPDATE dictionaryentries
           SET synonyms = $1::jsonb
           WHERE id = $2`,
          [JSON.stringify(valid), row.id]
        );

        if (valid.length > 0) {
          updated++;
        } else {
          skipped++;
        }
      } catch (err) {
        console.log(`FAILED: ${err.message}`);
        failed++;
      }

      // Small delay to avoid hammering the API
      await new Promise(r => setTimeout(r, 300));
    }

    console.log('\n' + '='.repeat(60));
    console.log('📊 Backfill Complete!');
    console.log('='.repeat(60));
    console.log(`Total processed : ${entries.length}`);
    console.log(`With synonyms   : ${updated}`);
    console.log(`No synonyms     : ${skipped}`);
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
