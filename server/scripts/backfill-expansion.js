/**
 * Backfill Script: AI-powered expansion for dictionaryentries
 *
 * For each discoverable zh entry with missing expansion or missing expansion literal
 * translation, uses GPT-5.4 to generate:
 * - expansion (expanded form of the word)
 * - expansionLiteralTranslation (literal phrase that shows component meaning)
 *
 * Expansion must preserve original meaning while keeping all original characters
 * in order. Literal translation must be a phrase, not a sentence.
 *
 * Usage: docker exec cow-backend-local npx tsx scripts/backfill-expansion.js
 */

import dotenv from 'dotenv';
import { fileURLToPath } from 'url';
import path from 'path';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
dotenv.config({ path: path.join(__dirname, '../.env.docker') });

import OpenAI from 'openai';
import db from '../db.js';

const openai = new OpenAI({ apiKey: process.env.OPENAI_API_KEY });

/**
 * Ask GPT-5.4 to generate expansion data for a Chinese word.
 * If existingExpansion is provided, model should keep it unchanged and only add literal translation.
 */
async function askGptForExpansionData(word, existingExpansion = null) {
  const hasExistingExpansion = typeof existingExpansion === 'string' && existingExpansion.trim().length > 0;
  const prompt = `You are a Chinese language expert. The goal is to break down a Chinese word into more commonly used, everyday components by expanding it into a longer phrase.

Rules:
- Every character from the original word must appear in the expansion, in their original order
- You may ONLY add characters between or after the originals — never replace or omit any original character
- Each character added must be more colloquial or commonly used in everyday speech than the character it is expanding
- Each original character may be expanded only by adding a chunk of at most 3 Chinese characters for that character
- The expansion must have the exact same meaning as the original word — do not change or broaden the meaning
- The expansion must be a natural phrase that a native Mandarin speaker would actually say
- Do NOT produce awkward or repetitive results like 动一动作一作
- If a clean, natural, meaning-preserving expansion using more common characters is not possible, return null
- For expansionLiteralTranslation: return a literal translation phrase that shows how expansion components combine to create the original meaning
- expansionLiteralTranslation must be a phrase, not a sentence
- expansionLiteralTranslation should read as literally translated from the expansion components
- Examples:
  * 不知不觉 → 不知道不觉得 (道 and 得 are common everyday particles)
  * 违规 → 违反规矩 (反 and 矩 make the components more explicit and colloquial)
  * 早晚 → 早上晚上 (上 is a very common directional complement)

Word: ${word}
${hasExistingExpansion ? `Existing expansion (must keep exactly): ${existingExpansion}` : ''}

Respond with ONLY a JSON object in this exact format, with no extra text:
{"expansion": "expanded form or null", "expansionLiteralTranslation": "literal phrase or null"}`;

  const response = await openai.chat.completions.create({
    model: 'gpt-5.4',
    messages: [{ role: 'user', content: prompt }],
    response_format: { type: 'json_object' },
    max_completion_tokens: 256,
  });

  const text = response.choices?.[0]?.message?.content?.trim() || '';
  if (!text) throw new Error('Empty response from model');

  let parsed;
  try {
    parsed = JSON.parse(text);
  } catch {
    const objMatch = text.match(/\{[\s\S]*\}/);
    if (!objMatch) throw new Error(`No JSON object found in response: ${text}`);
    parsed = JSON.parse(objMatch[0]);
  }

  const expansion = parsed.expansion || null;
  const expansionLiteralTranslation = parsed.expansionLiteralTranslation || null;

  return {
    expansion: hasExistingExpansion ? existingExpansion : expansion,
    expansionLiteralTranslation,
  };
}

async function run() {
  console.log('🚀 Starting AI-powered expansion backfill...\n');

  if (!process.env.OPENAI_API_KEY) {
    console.error('❌ OPENAI_API_KEY not set');
    process.exit(1);
  }

  const client = await db.getClient();

  try {
    const { rows: entries } = await client.query(`
      SELECT id, word1, pronunciation, expansion, "expansionLiteralTranslation"
      FROM dictionaryentries
      WHERE language = 'zh'
        AND discoverable = TRUE
        AND (expansion IS NULL OR "expansionLiteralTranslation" IS NULL)
      ORDER BY id ASC
    `);

    console.log(`📊 Found ${entries.length} entries needing expansion data\n`);

    let expanded = 0;
    let literalOnly = 0;
    let nulled = 0;
    let failed = 0;

    for (const row of entries) {
      try {
        process.stdout.write(`  ${row.word1} (${row.pronunciation}) ... `);

        const { expansion, expansionLiteralTranslation } = await askGptForExpansionData(
          row.word1,
          row.expansion
        );

        if (!expansion) {
          console.log('no expansion');
          nulled++;
          await client.query(
            `UPDATE dictionaryentries SET "expansionLiteralTranslation" = NULL WHERE id = $1`,
            [row.id]
          );
          continue;
        }

        console.log(`→ ${expansion}${expansionLiteralTranslation ? ` | ${expansionLiteralTranslation}` : ' | no literal translation'}`);

        await client.query(
          `UPDATE dictionaryentries
           SET expansion = $1, "expansionLiteralTranslation" = $2
           WHERE id = $3`,
          [expansion, expansionLiteralTranslation, row.id]
        );

        if (row.expansion) {
          literalOnly++;
        } else {
          expanded++;
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
    console.log(`Total processed  : ${entries.length}`);
    console.log(`With expansion   : ${expanded}`);
    console.log(`Literal-only fill: ${literalOnly}`);
    console.log(`No expansion     : ${nulled}`);
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
