/**
 * Backfill Script: AI-powered expansion for dictionaryentries using Claude.
 *
 * Uses the refined Anthropic prompt + post-processing validator to generate
 * the `expansion` field for all discoverable zh entries that are missing it.
 *
 * Usage:
 *   docker exec cow-backend-local npx tsx scripts/backfill-expansion-claude.js
 *   docker exec cow-backend-local npx tsx scripts/backfill-expansion-claude.js --dry-run
 *   docker exec cow-backend-local npx tsx scripts/backfill-expansion-claude.js --concurrency 8
 */

import dotenv from 'dotenv';
import { fileURLToPath } from 'url';
import path from 'path';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
dotenv.config({ path: path.join(__dirname, '../.env.docker') });

import Anthropic from '@anthropic-ai/sdk';
import db from '../db.js';

const DRY_RUN = process.argv.includes('--dry-run');
const CONCURRENCY = parseInt(process.argv.find(a => a.startsWith('--concurrency='))?.split('=')[1] || '5', 10);

const anthropic = new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY });

/**
 * Post-processing validator — mirrors DictionaryService.validateExpansion().
 * Returns null if the expansion fails any sanity check.
 */
function validateExpansion(original, expansion) {
  if (!expansion || typeof expansion !== 'string') return null;
  // Must add characters
  if (expansion.length <= original.length) return null;
  // Must not be identical
  if (expansion === original) return null;
  // Must not contain the original as a contiguous substring (circular)
  if (expansion.includes(original)) return null;
  // Must not double any original character consecutively (AABB/reduplication)
  for (const char of original) {
    if (expansion.includes(char + char)) return null;
  }
  // All original characters must appear in order
  let pos = 0;
  for (const char of original) {
    const idx = expansion.indexOf(char, pos);
    if (idx === -1) return null;
    pos = idx + 1;
  }
  return expansion;
}

async function generateExpansion(word) {
  const prompt = `You are a Chinese language expert. Your task is to expand a Chinese word into a more vernacular phrase that reveals *why the word is constructed the way it is* — i.e., what each morpheme means in everyday speech.

Rules:
- Every character from the original word must appear in the expansion, in their original order
- You may add characters anywhere — before, between, or after the originals — but never replace or omit any original character
- The expansion must use natural, everyday Mandarin that a native speaker would actually say
- The expansion must make the word's internal structure more transparent by showing what each morpheme means via its more common vernacular form
- Be strict: a valid expansion must pass ALL of the following checks:
  1. Each added chunk meaningfully expands a morpheme into a more common everyday word (e.g. 规 → 规矩, 知 → 知道, 早 → 早上)
  2. The result sounds like something a native speaker would naturally say — not a dictionary gloss or a sentence
  3. The expansion reveals insight a learner could not get from seeing the original alone

- Return null if ANY of the following apply:
  - The word is already maximally vernacular (e.g. 吃饭, 喝水, 走路, 睡觉)
  - The expansion would be circular or tautological (e.g. 学生 → 学习的学生)
  - The expansion only appends a weak suffix or classifier (e.g. 太极拳 → 太极拳法, 母亲节 → 母亲节日)
  - The expansion only reduplicates characters (e.g. 干净 → 干干净净)
  - The expansion only adds grammatical particles or aspect markers without illuminating a morpheme (e.g. 游泳 → 游着泳)
  - The expansion just appends a synonym of the whole word rather than unpacking the morphemes (e.g. 重要 → 重要紧要)
  - No natural-sounding expansion exists that meaningfully explains the structure

Good examples (each morpheme expanded into its everyday form):
  * 违规 → 违反规矩 (违 → 违反 "to violate", 规 → 规矩 "rules/norms")
  * 不知不觉 → 不知道不觉得 (知 → 知道, 觉 → 觉得)
  * 早晚 → 早上晚上 (早 → 早上, 晚 → 晚上)
  * 规则 → 规矩法则 (规 → 规矩, 则 → 法则)
  * 客厅 → 客人厅堂 (客 → 客人, 厅 → 厅堂)

Null examples:
  * 吃饭 → null (maximally vernacular)
  * 学生 → null (学习的学生 is circular)
  * 干净 → null (干干净净 is just reduplication)
  * 重要 → null (no morpheme-level expansion possible)
  * 今天 → null (今日天天 fails — 今日 is more literary, not more vernacular)
  * 母亲节 → null (母亲节日 is a weak append of 日 with no morpheme insight)
  * 网络 → null (网络网络 is circular nonsense)
  * 感冒 → null (感觉冒出来 changes the meaning)

Word: ${word}

Respond with ONLY a JSON object in this exact format, no extra text:
{"expansion": "expanded form"} or {"expansion": null}`;

  const response = await anthropic.messages.create({
    model: 'claude-sonnet-4-6',
    max_tokens: 256,
    temperature: 0.3,
    system: 'You are a Chinese language expert. You respond only with valid JSON — no explanations, no reasoning, no extra text.',
    messages: [{ role: 'user', content: prompt }],
  });

  const content = response.content[0].text.trim();
  const stripped = content.replace(/^```(?:json)?\s*/i, '').replace(/\s*```\s*$/, '').trim();
  const objMatch = stripped.match(/\{[\s\S]*?\}/);
  if (!objMatch) return null;
  const parsed = JSON.parse(objMatch[0]);
  const raw = parsed.expansion || null;
  return raw ? validateExpansion(word, raw) : null;
}

async function processBatch(batch, client, stats) {
  await Promise.all(batch.map(async (row) => {
    try {
      const expansion = await generateExpansion(row.word1);

      if (expansion) {
        process.stdout.write(`  ✅ ${row.word1} → ${expansion}\n`);
        stats.expanded++;
      } else {
        process.stdout.write(`  —  ${row.word1} → null\n`);
        stats.nulled++;
      }

      if (!DRY_RUN) {
        await client.query(
          `UPDATE dictionaryentries SET expansion = $1 WHERE id = $2`,
          [expansion, row.id]
        );
      }
    } catch (err) {
      process.stdout.write(`  ❌ ${row.word1} → ERROR: ${err.message}\n`);
      stats.failed++;
    }
  }));
}

async function run() {
  console.log(`Starting Claude expansion backfill... ${DRY_RUN ? '(DRY RUN)' : ''}`);
  console.log(`Concurrency: ${CONCURRENCY}\n`);

  if (!process.env.ANTHROPIC_API_KEY) {
    console.error('ANTHROPIC_API_KEY not set');
    process.exit(1);
  }

  const client = await db.getClient();

  try {
    const { rows: entries } = await client.query(`
      SELECT id, word1
      FROM dictionaryentries
      WHERE language = 'zh'
        AND discoverable = TRUE
        AND expansion IS NULL
      ORDER BY char_length(word1), word1
    `);

    console.log(`Found ${entries.length} entries to process\n`);

    const stats = { expanded: 0, nulled: 0, failed: 0 };

    // Process in batches of CONCURRENCY
    for (let i = 0; i < entries.length; i += CONCURRENCY) {
      const batch = entries.slice(i, i + CONCURRENCY);
      await processBatch(batch, client, stats);
      // Small pause between batches to respect rate limits
      if (i + CONCURRENCY < entries.length) {
        await new Promise(r => setTimeout(r, 200));
      }
    }

    console.log('\n' + '='.repeat(60));
    console.log('BACKFILL SUMMARY');
    console.log('='.repeat(60));
    console.log(`Total processed : ${entries.length}`);
    console.log(`Expanded        : ${stats.expanded}`);
    console.log(`Null (correct)  : ${stats.nulled}`);
    console.log(`Errors          : ${stats.failed}`);
    if (DRY_RUN) console.log('\n(DRY RUN — no changes written)');
    console.log('='.repeat(60));

  } finally {
    client.release();
    await db.pool.end();
  }
}

run().catch(err => {
  console.error('Fatal error:', err);
  process.exit(1);
});
