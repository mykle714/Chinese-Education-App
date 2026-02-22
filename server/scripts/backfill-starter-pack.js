/**
 * Backfill Script: Enrich Starter Pack Vocab with AI (Sonnet 4.6)
 *
 * Enriches all starter pack vocabentries rows (starterPackBucket IS NULL) with:
 *   - synonyms (all languages)
 *   - exampleSentences (all languages)
 *   - expansion (zh only, with character-preservation constraint)
 *
 * Usage:
 *   ANTHROPIC_BACKFILL_API_KEY=sk-ant-xxx npx tsx scripts/backfill-starter-pack.js
 *
 * Env vars:
 *   ANTHROPIC_BACKFILL_API_KEY  (required)
 *   LANGUAGE                   (optional, e.g. LANGUAGE=zh — defaults to all 4)
 *   DRY_RUN=true               (preview without writing to DB)
 */

import Anthropic from '@anthropic-ai/sdk';
import db from '../db.js';

const ANTHROPIC_API_KEY = process.env.ANTHROPIC_BACKFILL_API_KEY;
if (!ANTHROPIC_API_KEY) {
  console.error('❌ Error: ANTHROPIC_BACKFILL_API_KEY is required');
  process.exit(1);
}

const DRY_RUN = process.env.DRY_RUN === 'true';
const LANGUAGE_FILTER = process.env.LANGUAGE; // e.g. 'zh' or undefined for all

const ALL_LANGUAGES = ['zh', 'ja', 'ko', 'vi'];
const LANGUAGES = LANGUAGE_FILTER ? [LANGUAGE_FILTER] : ALL_LANGUAGES;

const BATCH_SIZE = 10;
const MODEL = 'claude-sonnet-4-6';
const INPUT_COST_PER_1M = 3.00;
const OUTPUT_COST_PER_1M = 15.00;

const anthropic = new Anthropic({ apiKey: ANTHROPIC_API_KEY });

const LANGUAGE_NAMES = {
  zh: 'Chinese',
  ja: 'Japanese',
  ko: 'Korean',
  vi: 'Vietnamese',
};

// ---------------------------------------------------------------------------
// Prompt builders
// ---------------------------------------------------------------------------

function buildZhPrompt(wordsBatch) {
  const wordsSection = wordsBatch.map((w, i) => {
    const def = Array.isArray(w.definitions) ? w.definitions[0] : w.definitions;
    return `${i + 1}. ${w.entryKey} (${w.pronunciation || ''}): ${def || ''}`;
  }).join('\n');

  return `You are a Chinese language expert. For each word, provide:

1. **SYNONYMS** (1-3 words, ONLY if high quality):
   - Only include synonyms that are VERY close in meaning
   - Must be commonly used, natural Chinese words
   - If no high-quality synonyms exist, return an empty array []
   - Quality over quantity - better to have 0 synonyms than mediocre ones

2. **WORD EXPANSION** (1 expanded form):
   - Expand each morpheme/character by inserting additional characters to make it more explicit
   - CRITICAL: Every character from the original word must appear in the expansion, in their original order
   - You may ONLY add characters between or after the originals — never replace or omit any original character
   - Examples:
     * 不知不觉 → 不知道不觉得  (added 道 and 得)
     * 违规 → 违反规矩           (added 反 and 矩)
     * 早晚 → 早上晚上           (added 上 twice)
     * 傻里傻气 → 傻里面傻气质   (added 面 and 质)
   - WRONG: 傻里傻气 → 傻乎乎的样子  (replaces original characters — not allowed)
   - If the word cannot be meaningfully expanded while preserving all characters, return null

3. **EXAMPLE SENTENCES** (3 sentences):
   - Natural, realistic sentences (how a native speaker would use it)
   - Show different grammatical contexts
   - 8-15 characters in Chinese
   - Include English translation and usage context

Words to process:
${wordsSection}

Respond in this EXACT JSON format:
{
  "words": [
    {
      "word": "word1",
      "synonyms": ["synonym1", "synonym2"],
      "expansion": "expanded form or null",
      "exampleSentences": [
        { "chinese": "example", "english": "translation", "usage": "context" },
        { "chinese": "example", "english": "translation", "usage": "context" },
        { "chinese": "example", "english": "translation", "usage": "context" }
      ]
    }
  ]
}

CRITICAL INSTRUCTIONS:
- synonyms: Return [] if no high-quality matches exist
- expansion: Return null if word cannot be meaningfully expanded while preserving all original characters
- Do not skip any words`;
}

function buildNonZhPrompt(lang, wordsBatch) {
  const langName = LANGUAGE_NAMES[lang];
  const wordsSection = wordsBatch.map((w, i) => {
    if (w.pronunciation && w.definitions) {
      const def = Array.isArray(w.definitions) ? w.definitions[0] : w.definitions;
      return `${i + 1}. ${w.entryKey} (${w.pronunciation}): ${def}`;
    }
    return `${i + 1}. ${w.entryKey}: ${w.entryValue || ''}`;
  }).join('\n');

  return `You are a ${langName} language expert. For each word, provide:

1. **SYNONYMS** (1-3 words, ONLY if high quality):
   - Only include synonyms that are VERY close in meaning
   - Must be commonly used, natural ${langName} words
   - If no high-quality synonyms exist, return an empty array []
   - Quality over quantity - better to have 0 synonyms than mediocre ones

2. **EXAMPLE SENTENCES** (3 sentences):
   - Natural, realistic sentences (how a native speaker would use it)
   - Show different grammatical contexts
   - Include English translation and usage context

Words to process:
${wordsSection}

Respond in this EXACT JSON format:
{
  "words": [
    {
      "word": "word1",
      "synonyms": ["synonym1", "synonym2"],
      "exampleSentences": [
        { "native": "example sentence", "english": "translation", "usage": "context" },
        { "native": "example sentence", "english": "translation", "usage": "context" },
        { "native": "example sentence", "english": "translation", "usage": "context" }
      ]
    }
  ]
}

CRITICAL INSTRUCTIONS:
- synonyms: Return [] if no high-quality matches exist
- Do not skip any words`;
}

// ---------------------------------------------------------------------------
// API call
// ---------------------------------------------------------------------------

async function callClaude(prompt) {
  const startTime = Date.now();

  const response = await anthropic.messages.create({
    model: MODEL,
    max_tokens: 4096,
    temperature: 0.7,
    messages: [{ role: 'user', content: prompt }],
  });

  const duration = Date.now() - startTime;
  const raw = response.content[0].text;
  const jsonText = raw.replace(/^```(?:json)?\s*/i, '').replace(/\s*```\s*$/, '').trim();
  const parsed = JSON.parse(jsonText);

  return {
    words: parsed.words,
    inputTokens: response.usage.input_tokens,
    outputTokens: response.usage.output_tokens,
    duration,
  };
}

// ---------------------------------------------------------------------------
// Process a single language
// ---------------------------------------------------------------------------

async function processLanguage(lang, client) {
  console.log(`\n${'─'.repeat(50)}`);
  console.log(`🌐 Language: ${LANGUAGE_NAMES[lang]} (${lang})`);
  console.log(`${'─'.repeat(50)}`);

  // Query words with dict join where available
  // DISTINCT ON (v.id) ensures one row per vocab entry even when dict has multiple entries
  const query = `
    SELECT DISTINCT ON (v.id) v.id, v."entryKey", v."entryValue", v.language,
           d.pronunciation, d.definitions
    FROM vocabentries v
    LEFT JOIN dictionaryentries d
      ON d.word1 = v."entryKey" AND d.language = v.language
    WHERE v."starterPackBucket" IS NULL
      AND v.language = $1
      AND (v.synonyms IS NULL OR v.synonyms = '[]'::jsonb)
    ORDER BY v.id, v."createdAt" ASC
  `;

  const result = await client.query(query, [lang]);
  const rows = result.rows;

  console.log(`📊 Found ${rows.length} words to enrich`);

  if (rows.length === 0) {
    console.log('   (all already enriched — skipping)');
    return { processed: 0, succeeded: 0, failed: 0, inputTokens: 0, outputTokens: 0 };
  }

  if (DRY_RUN) {
    console.log('   DRY RUN — skipping AI calls');
    // Show sample
    rows.slice(0, 5).forEach((r, i) => {
      const def = Array.isArray(r.definitions) ? r.definitions?.[0] : r.definitions;
      console.log(`   ${i + 1}. ${r.entryKey}${def ? ` — ${def}` : ''}`);
    });
    if (rows.length > 5) console.log(`   ... and ${rows.length - 5} more`);
    return { processed: rows.length, succeeded: 0, failed: 0, inputTokens: 0, outputTokens: 0 };
  }

  // Split into batches
  const batches = [];
  for (let i = 0; i < rows.length; i += BATCH_SIZE) {
    batches.push(rows.slice(i, i + BATCH_SIZE));
  }

  let succeeded = 0;
  let failed = 0;
  let totalInput = 0;
  let totalOutput = 0;

  for (let batchIdx = 0; batchIdx < batches.length; batchIdx++) {
    const batch = batches[batchIdx];
    console.log(`\n  Batch [${batchIdx + 1}/${batches.length}] — ${batch.length} words...`);

    const prompt = lang === 'zh' ? buildZhPrompt(batch) : buildNonZhPrompt(lang, batch);

    try {
      const { words: aiWords, inputTokens, outputTokens, duration } = await callClaude(prompt);

      totalInput += inputTokens;
      totalOutput += outputTokens;

      // Match AI results back to DB rows by position (same order as batch)
      for (let i = 0; i < batch.length; i++) {
        const row = batch[i];
        const aiWord = aiWords[i];

        if (!aiWord) {
          console.log(`    ⚠ No AI result for ${row.entryKey}`);
          failed++;
          continue;
        }

        const synonyms = JSON.stringify(aiWord.synonyms || []);
        const exampleSentences = JSON.stringify(aiWord.exampleSentences || []);

        try {
          if (lang === 'zh') {
            await client.query(
              `UPDATE vocabentries SET synonyms = $1, "exampleSentences" = $2, expansion = $3 WHERE id = $4`,
              [synonyms, exampleSentences, aiWord.expansion ?? null, row.id]
            );
          } else {
            await client.query(
              `UPDATE vocabentries SET synonyms = $1, "exampleSentences" = $2 WHERE id = $3`,
              [synonyms, exampleSentences, row.id]
            );
          }
          succeeded++;
        } catch (dbErr) {
          console.error(`    ✗ DB error for ${row.entryKey}: ${dbErr.message}`);
          failed++;
        }
      }

      const cost = ((inputTokens / 1e6) * INPUT_COST_PER_1M + (outputTokens / 1e6) * OUTPUT_COST_PER_1M).toFixed(4);
      console.log(`    ✓ Done (${duration}ms, $${cost})`);

    } catch (err) {
      console.error(`    ✗ Batch failed: ${err.message}`);
      failed += batch.length;
    }

    // Pause between batches to respect rate limits
    if (batchIdx < batches.length - 1) {
      await new Promise(r => setTimeout(r, 1000));
    }
  }

  const totalCost = ((totalInput / 1e6) * INPUT_COST_PER_1M + (totalOutput / 1e6) * OUTPUT_COST_PER_1M).toFixed(4);
  console.log(`\n  Summary: ${succeeded} succeeded, ${failed} failed — $${totalCost} total`);

  return { processed: rows.length, succeeded, failed, inputTokens: totalInput, outputTokens: totalOutput };
}

// ---------------------------------------------------------------------------
// Main
// ---------------------------------------------------------------------------

async function main() {
  console.log('\n🚀 Starter Pack AI Enrichment Backfill');
  console.log(`   Model:    ${MODEL}`);
  console.log(`   Language: ${LANGUAGE_FILTER || 'all (zh, ja, ko, vi)'}`);
  console.log(`   Dry run:  ${DRY_RUN}`);

  const client = await db.getClient();

  let grandTotal = { processed: 0, succeeded: 0, failed: 0, inputTokens: 0, outputTokens: 0 };

  try {
    for (const lang of LANGUAGES) {
      const stats = await processLanguage(lang, client);
      grandTotal.processed += stats.processed;
      grandTotal.succeeded += stats.succeeded;
      grandTotal.failed += stats.failed;
      grandTotal.inputTokens += stats.inputTokens;
      grandTotal.outputTokens += stats.outputTokens;
    }

    const grandCost = (
      (grandTotal.inputTokens / 1e6) * INPUT_COST_PER_1M +
      (grandTotal.outputTokens / 1e6) * OUTPUT_COST_PER_1M
    ).toFixed(4);

    console.log(`\n${'='.repeat(50)}`);
    console.log('📊 GRAND TOTAL');
    console.log(`${'='.repeat(50)}`);
    console.log(`  Words found:  ${grandTotal.processed}`);
    if (!DRY_RUN) {
      console.log(`  Succeeded:    ${grandTotal.succeeded}`);
      console.log(`  Failed:       ${grandTotal.failed}`);
      console.log(`  Input tokens: ${grandTotal.inputTokens.toLocaleString()}`);
      console.log(`  Output tokens:${grandTotal.outputTokens.toLocaleString()}`);
      console.log(`  Total cost:   $${grandCost}`);
    }
    console.log(`${'='.repeat(50)}\n`);

  } finally {
    client.release();
    await db.pool.end();
  }
}

main().catch(err => {
  console.error('❌ Fatal error:', err);
  process.exit(1);
});
