/**
 * Backfill Script: AI-powered vernacular register scoring for dictionaryentries
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
dotenv.config({ path: path.join(__dirname, '../.env.docker') });

import Anthropic from '@anthropic-ai/sdk';
import db from '../db.js';

const anthropic = new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY });

const isSpotCheck = process.argv.includes('--spot-check');
const isRandom = process.argv.includes('--random');
const limitArg = process.argv.find(a => a.startsWith('--limit='));
const spotCheckLimit = limitArg ? parseInt(limitArg.split('=')[1], 10) : 5;

// Shared scale and guidelines used in both prompt modes
const SCALE_AND_GUIDELINES = `Scale:
  5 = Natural vernacular — the word sounds completely natural and at home in everyday casual spoken Mandarin; native speakers use it without thinking in conversation (e.g. 吃饭, 好吃, 老爸, 搞定, 没事)
  4 = Informal-leaning — more common in spoken language than in writing; has a slightly casual or conversational feel, though not slang (e.g. 好久不见, 随便, 差不多, 讲)
  3 = Neutral register — equally appropriate in spoken and written contexts; neither marked as casual nor as formal (e.g. 工作, 学习, 手机, 问题, 明天)
  2 = Formal/written-leaning — more natural in written, academic, news, or formal speech contexts than in casual conversation; would sound slightly stiff in everyday chat (e.g. 目前, 然而, 因此, 手术, 阐述)
  1 = Literary/classical/formal only — archaic, classical Chinese, or elevated literary register; sounds unnatural or pretentious in everyday spoken Mandarin (e.g. 余 meaning "I/me", 翌日 for "the next day", 兮, 乃)

Guidelines:
  - Score based on how natural this word sounds in everyday casual spoken Mandarin — not whether it is formally correct or widely known.
  - A word that is universally known but primarily lives in formal/written contexts scores 2 (e.g. 手术 — everyone knows it, but it has a clinical, written feel; it does not belong in casual small talk).
  - A word used freely and naturally in casual conversation scores 4–5, regardless of whether it also appears in formal writing.
  - Classical or archaic words that survive only in set phrases or literary texts score 1.
  - If a word has multiple meanings with different registers, score the most common everyday usage.`;

/**
 * Ask Claude Sonnet to score the vernacular register of a Chinese word.
 *
 * In normal mode: returns { score: number }
 * In spot-check mode: returns { score: number, reasoning: string }
 */
async function askClaudeForVernacularScore(word, pronunciation, definitions) {
  const definitionText = Array.isArray(definitions)
    ? definitions.slice(0, 4).join('; ')
    : definitions;

  const header = `You are a Chinese linguistics expert specializing in sociolinguistics and register.

Word: ${word} (${pronunciation})
Definitions: ${definitionText}

Task: Score how vernacular (everyday spoken) the word "${word}" is on a scale of 1 to 5.

This is a register score — does this word live primarily in casual everyday speech (score high), or in written, formal, or literary contexts (score low)? The question is not whether the word is common or well-known, but whether it sounds natural and at home in everyday spoken Mandarin.

${SCALE_AND_GUIDELINES}`;

  let prompt;
  let maxTokens;

  if (isSpotCheck) {
    prompt = `${header}

Respond with ONLY a JSON object with two fields:
  "score": integer 1–5
  "reasoning": one sentence explaining your score

Example: {"score": 2, "reasoning": "Primarily used in formal/written contexts; would sound clinical in casual speech."}
No markdown, no extra text.`;
    maxTokens = 200;
  } else {
    prompt = `${header}

Respond with ONLY a single integer: 1, 2, 3, 4, or 5.
No explanation, no punctuation, no markdown.`;
    maxTokens = 16;
  }

  const response = await anthropic.messages.create({
    model: 'claude-sonnet-4-6',
    max_tokens: maxTokens,
    temperature: 0.1,
    messages: [{ role: 'user', content: prompt }],
  });

  const text = response.content[0].text.trim();

  if (isSpotCheck) {
    // Strip markdown code fences if present
    let cleaned = text.replace(/^```(?:json)?\s*/i, '').replace(/\s*```\s*$/, '').trim();
    const parsed = JSON.parse(cleaned);
    const score = parseInt(parsed.score, 10);
    if (score < 1 || score > 5 || isNaN(score)) {
      throw new Error(`Invalid score from Claude: ${parsed.score}`);
    }
    return { score, reasoning: parsed.reasoning ?? '' };
  } else {
    // Expect a bare digit 1–5; extract it defensively
    const match = text.match(/^[1-5]$/);
    if (!match) {
      throw new Error(`Invalid score from Claude: "${text}"`);
    }
    return { score: parseInt(text, 10) };
  }
}

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
      FROM dictionaryentries
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

        const result = await askClaudeForVernacularScore(row.word1, row.pronunciation, row.definitions);

        if (isSpotCheck) {
          console.log(`${result.score}  |  ${result.reasoning}`);
        } else {
          console.log(`${result.score}`);
        }

        await client.query(
          `UPDATE dictionaryentries SET "vernacularScore" = $1 WHERE id = $2`,
          [result.score, row.id]
        );

        scoreCounts[result.score]++;
        processed++;
      } catch (err) {
        console.log(`FAILED: ${err.message}`);
        failed++;
      }

      // Small delay to avoid rate-limiting
      await new Promise(r => setTimeout(r, 200));
    }

    const scoreLabels = {
      1: 'Literary/classical/formal only',
      2: 'Formal/written-leaning',
      3: 'Neutral register',
      4: 'Informal-leaning',
      5: 'Natural vernacular',
    };

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
