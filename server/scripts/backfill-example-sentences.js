/**
 * Backfill Script: AI-powered example sentences for dictionaryentries
 *
 * For each discoverable zh entry with no exampleSentences, uses Claude AI to generate
 * 3 natural, contextually appropriate example sentences using the word in different
 * grammatical roles. Each sentence includes Chinese, English translation, and
 * a partOfSpeechDict keyed by sentence tokens (single or multi-character words).
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

// --words=未来,摸脉 → scope to specific entries only; omit to target all discoverable entries with exampleSentences IS NULL
const wordsArg = process.argv.find(a => a.startsWith('--words='));
const targetWords = wordsArg ? wordsArg.slice('--words='.length).split(',').map(s => s.trim()).filter(Boolean) : null;
const wordsFilter = targetWords?.length
  ? `AND word1 = ANY(ARRAY[${targetWords.map(w => `'${w.replace(/'/g, "''")}'`).join(', ')}])`
  : '';

/**
 * Ask Claude to generate 3 natural example sentences for a Chinese word.
 * Returns an array of { chinese, english, partOfSpeechDict } objects.
 */
async function generateExampleSentences(word, pronunciation, definitions) {
  const allowedPosTags = [
    'noun',
    'verb',
    'adjective',
    'adverb',
    'pronoun',
    'numeral',
    'classifier',
    'preposition',
    'conjunction',
    'particle',
    'interjection',
    'onomatopoeia'
  ];
  const definitionText = Array.isArray(definitions) ? definitions.slice(0, 3).join('; ') : definitions;

  const prompt = `You are a Chinese language teacher creating example sentences for a vocabulary app.

Word: ${word} (${pronunciation})
Meaning: ${definitionText}

Write exactly 3 natural example sentences using "${word}". Each sentence should:
- Use the word naturally as a native speaker would
- Be simple enough for an intermediate learner (HSK 3–4 level vocabulary otherwise)
- Show a different grammatical role or context for the word for each sentence
- Have an accurate English translation
- Mirror the punctuation of the Chinese sentence in the English translation — if the Chinese uses a comma to separate two clauses, use a comma in the same position in English; match question marks, exclamation points, etc.
- Match the clause structure of the Chinese sentence — if the Chinese has two clauses separated by a conjunction or comma, the English should have two parallel clauses in the same order
- Include a "translatedVocab" field: the English word or short phrase in your English translation that directly corresponds to "${word}" (e.g. if the word is 贴 and the sentence is "She stuck the photo on the wall.", translatedVocab is "stuck")
- Include a "partOfSpeechDict" object for each sentence
- partOfSpeechDict keys must be word tokens that appear in the Chinese sentence (single or multi-character words are both allowed)
- Make sure to include every word in the sentence as a key in partOfSpeechDict
- partOfSpeechDict values must be one of:
  ${allowedPosTags.join(', ')}
- Do not include punctuation as keys
- Include the target word "${word}" as one of the keys in partOfSpeechDict

Respond with ONLY a JSON array in this exact format (no markdown, no explanation):
[
  {
    "chinese": "Chinese sentence",
    "english": "English translation",
    "translatedVocab": "english word",
    "partOfSpeechDict": {
      "wordToken1": "pos_tag",
      "wordToken2": "pos_tag"
    }
  },
  {
    "chinese": "Chinese sentence",
    "english": "English translation",
    "translatedVocab": "english word",
    "partOfSpeechDict": {
      "wordToken1": "pos_tag",
      "wordToken2": "pos_tag"
    }
  },
  {
    "chinese": "Chinese sentence",
    "english": "English translation",
    "translatedVocab": "english word",
    "partOfSpeechDict": {
      "wordToken1": "pos_tag",
      "wordToken2": "pos_tag"
    }
  }
]`;

  const response = await anthropic.messages.create({
    model: 'claude-sonnet-4-6',
    max_tokens: 600,
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

  const allowedPosTagSet = new Set(allowedPosTags);

  // Validate each sentence has required fields
  const valid = parsed.filter(s =>
    s && typeof s.chinese === 'string' && s.chinese.length > 0 &&
    typeof s.english === 'string' && s.english.length > 0 &&
    typeof s.translatedVocab === 'string' && s.translatedVocab.trim().length > 0 &&
    s.partOfSpeechDict &&
    typeof s.partOfSpeechDict === 'object' &&
    !Array.isArray(s.partOfSpeechDict) &&
    Object.keys(s.partOfSpeechDict).length > 0 &&
    Object.entries(s.partOfSpeechDict).every(([token, tag]) =>
      typeof token === 'string' &&
      token.length > 0 &&
      !/[\s，。！？；：,.!?;:]/.test(token) &&
      typeof tag === 'string' &&
      allowedPosTagSet.has(tag)
    )
  );

  return valid.length > 0 ? valid : null;
}

async function run() {
  if (isSpotCheck) {
    console.log('🔍 SPOT CHECK MODE — processing 3 entries only\n');
  }
  if (targetWords?.length) console.log(`🎯 Scoped to: ${targetWords.join(', ')}\n`);
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
        ${wordsFilter}
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
            console.log(`    ${s.chinese}`);
            console.log(`           ${s.english}`);
            console.log(`           translatedVocab: ${s.translatedVocab}`);
            console.log(`           POS: ${JSON.stringify(s.partOfSpeechDict)}`);
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
