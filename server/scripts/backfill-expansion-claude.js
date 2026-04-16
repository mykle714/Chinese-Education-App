/**
 * Backfill Script: AI-powered expansion + literal translation for dictionaryentries.
 *
 * Uses Claude to generate two fields for all discoverable zh entries:
 *   - expansion: a longer vernacular form that reveals each morpheme's everyday meaning
 *   - expansionLiteralTranslation: short English phrase that literally glosses the expansion
 *
 * Sentinel convention: '' (empty string) means "attempted, no valid expansion."
 * This distinguishes from NULL ("never attempted") so future runs skip already-tried entries.
 *
 * The script handles two modes automatically:
 *   - Full enrichment: entry has expansion IS NULL → generate both fields
 *   - Literal-only:   entry has expansion but missing literal → generate literal only
 *
 * Usage:
 *   docker exec cow-backend-local npx tsx scripts/backfill-expansion-claude.js
 *   docker exec cow-backend-local npx tsx scripts/backfill-expansion-claude.js --dry-run
 *   docker exec cow-backend-local npx tsx scripts/backfill-expansion-claude.js --concurrency=8
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
 * Post-processing validator for expansion.
 * Returns the expansion string if valid, null otherwise.
 */
function validateExpansion(original, expansion) {
  if (!expansion || typeof expansion !== 'string') return null;
  // Must be longer than the original
  if (expansion.length <= original.length) return null;
  // Must not be identical to original
  if (expansion === original) return null;
  // Must not contain the original as a contiguous substring (circular expansion)
  if (expansion.includes(original)) return null;
  // Must not double any original character consecutively (reduplication)
  for (const char of original) {
    if (expansion.includes(char + char)) return null;
  }
  // All original characters must appear in their original order
  let pos = 0;
  for (const char of original) {
    const idx = expansion.indexOf(char, pos);
    if (idx === -1) return null;
    pos = idx + 1;
  }
  return expansion;
}

/**
 * Ask Claude to generate both expansion and literal translation for a new entry.
 * Returns { expansion: string|null, expansionLiteralTranslation: string|null }
 */
async function generateExpansionAndLiteral(word) {
  const response = await anthropic.messages.create({
    model: 'claude-sonnet-4-6',
    max_tokens: 256,
    temperature: 0.3,
    system: 'You are a Chinese language expert. Respond only with valid JSON — no explanations, no reasoning, no extra text.',
    messages: [{
      role: 'user',
      content: `Your task is to expand a Chinese word into a more vernacular phrase that reveals *why the word is constructed the way it is* — i.e., what each morpheme means in everyday speech. Also provide a short English literal translation of the expansion.

Rules:
- Every character from the original word must appear in the expansion, in their original order
- You may add characters anywhere — before, between, or after the originals — but never replace or omit any original character
- The expansion must use natural, everyday Mandarin that a native speaker would actually say
- The expansion must make the word's internal structure more transparent by showing what each morpheme means via its more common vernacular form
- Be strict: a valid expansion must pass ALL of the following checks:
  1. Each added chunk meaningfully expands a morpheme into a more common everyday word (e.g. 规 → 规矩, 知 → 知道, 早 → 早上)
  2. The result sounds like something a native speaker would naturally say — not a dictionary gloss or a sentence
  3. The expansion reveals insight a learner could not get from seeing the original alone
- expansionLiteralTranslation must be a short English phrase (not a sentence) that literally glosses the expansion's morphemes

Return null for BOTH fields if ANY of the following apply:
  - The word is already maximally vernacular (e.g. 吃饭, 喝水, 走路, 睡觉)
  - The expansion would be circular or tautological (e.g. 学生 → 学习的学生)
  - The expansion only appends a weak suffix or classifier (e.g. 太极拳 → 太极拳法, 母亲节 → 母亲节日)
  - The expansion only reduplicates characters (e.g. 干净 → 干干净净)
  - The expansion only adds grammatical particles without illuminating a morpheme (e.g. 游泳 → 游着泳)
  - The expansion just appends a synonym of the whole word (e.g. 重要 → 重要紧要)
  - No natural-sounding expansion exists that meaningfully explains the structure

Good examples:
  * 违规 → {"expansion":"违反规矩","expansionLiteralTranslation":"violate-rules norms"}
  * 不知不觉 → {"expansion":"不知道不觉得","expansionLiteralTranslation":"not-know not-feel"}
  * 早晚 → {"expansion":"早上晚上","expansionLiteralTranslation":"morning evening"}
  * 规则 → {"expansion":"规矩法则","expansionLiteralTranslation":"rules-norms law-principles"}
  * 客厅 → {"expansion":"客人厅堂","expansionLiteralTranslation":"guest-person hall-room"}

Null examples: 吃饭, 学生, 干净, 重要, 今天, 网络, 感冒 → all null

Word: ${word}

Respond with ONLY a JSON object:
{"expansion": "expanded form", "expansionLiteralTranslation": "literal English phrase"}
or
{"expansion": null, "expansionLiteralTranslation": null}`,
    }],
  });

  const content = response.content[0].text.trim();
  const stripped = content.replace(/^```(?:json)?\s*/i, '').replace(/\s*```\s*$/, '').trim();
  const objMatch = stripped.match(/\{[\s\S]*?\}/);
  if (!objMatch) return { expansion: null, expansionLiteralTranslation: null };

  const parsed = JSON.parse(objMatch[0]);
  const rawExpansion = parsed.expansion || null;
  const validExpansion = rawExpansion ? validateExpansion(word, rawExpansion) : null;

  return {
    expansion: validExpansion,
    // Only keep literal translation if expansion itself is valid
    expansionLiteralTranslation: validExpansion ? (parsed.expansionLiteralTranslation || null) : null,
  };
}

/**
 * Ask Claude for only the literal translation of an entry that already has a valid expansion.
 * Returns the literal translation string or null.
 */
async function generateLiteralTranslation(word, expansion) {
  const response = await anthropic.messages.create({
    model: 'claude-sonnet-4-6',
    max_tokens: 128,
    temperature: 0.3,
    system: 'You are a Chinese language expert. Respond only with valid JSON — no explanations, no extra text.',
    messages: [{
      role: 'user',
      content: `The Chinese word "${word}" has been expanded to "${expansion}".

Provide a short English phrase that literally glosses the expansion morpheme-by-morpheme, showing how each chunk contributes to the meaning. Must be a phrase, not a sentence.

Examples:
  * 违反规矩 → "violate-rules norms"
  * 不知道不觉得 → "not-know not-feel"
  * 早上晚上 → "morning evening"
  * 客人厅堂 → "guest-person hall-room"

Respond with ONLY: {"expansionLiteralTranslation": "literal phrase"} or {"expansionLiteralTranslation": null}`,
    }],
  });

  const content = response.content[0].text.trim();
  const stripped = content.replace(/^```(?:json)?\s*/i, '').replace(/\s*```\s*$/, '').trim();
  const objMatch = stripped.match(/\{[\s\S]*?\}/);
  if (!objMatch) return null;
  const parsed = JSON.parse(objMatch[0]);
  return parsed.expansionLiteralTranslation || null;
}

async function processEntry(row, client, stats) {
  // An entry has a usable expansion if it's a non-empty string
  const hasExpansion = typeof row.expansion === 'string' && row.expansion !== '';

  try {
    if (hasExpansion) {
      // Has expansion but missing literal translation — only generate literal
      process.stdout.write(`  ${row.word1} [literal only] ... `);
      const literal = await generateLiteralTranslation(row.word1, row.expansion);
      process.stdout.write(`${literal ?? 'null'}\n`);
      stats.literalOnly++;

      if (!DRY_RUN) {
        await client.query(
          `UPDATE dictionaryentries SET "expansionLiteralTranslation" = $1 WHERE id = $2`,
          [literal, row.id]
        );
      }
    } else {
      // Never attempted — generate both expansion and literal translation
      process.stdout.write(`  ${row.word1} ... `);
      const { expansion, expansionLiteralTranslation } = await generateExpansionAndLiteral(row.word1);

      if (expansion) {
        process.stdout.write(`${expansion} | ${expansionLiteralTranslation ?? 'no literal'}\n`);
        stats.expanded++;
      } else {
        process.stdout.write(`— null\n`);
        stats.nulled++;
      }

      if (!DRY_RUN) {
        await client.query(
          `UPDATE dictionaryentries SET expansion = $1, "expansionLiteralTranslation" = $2 WHERE id = $3`,
          // Write '' sentinel when expansion is null so future runs skip this entry
          [expansion ?? '', expansionLiteralTranslation, row.id]
        );
      }
    }
  } catch (err) {
    process.stdout.write(`  ❌ ${row.word1} → ERROR: ${err.message}\n`);
    stats.failed++;
  }
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
      SELECT id, word1, pronunciation, expansion, "expansionLiteralTranslation"
      FROM dictionaryentries
      WHERE language = 'zh'
        AND discoverable = TRUE
        AND (
          expansion IS NULL                                                -- never attempted
          OR (expansion != '' AND "expansionLiteralTranslation" IS NULL)  -- has expansion, needs literal
        )
      ORDER BY char_length(word1), word1
    `);

    console.log(`Found ${entries.length} entries to process\n`);

    const stats = { expanded: 0, literalOnly: 0, nulled: 0, failed: 0 };

    for (let i = 0; i < entries.length; i += CONCURRENCY) {
      const batch = entries.slice(i, i + CONCURRENCY);
      await Promise.all(batch.map(row => processEntry(row, client, stats)));
      // Brief pause between batches to respect API rate limits
      if (i + CONCURRENCY < entries.length) {
        await new Promise(r => setTimeout(r, 200));
      }
    }

    console.log('\n' + '='.repeat(60));
    console.log('BACKFILL SUMMARY');
    console.log('='.repeat(60));
    console.log(`Total processed  : ${entries.length}`);
    console.log(`Expansion+literal: ${stats.expanded}`);
    console.log(`Literal only     : ${stats.literalOnly}`);
    console.log(`Null (sentinel)  : ${stats.nulled}`);
    console.log(`Errors           : ${stats.failed}`);
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
