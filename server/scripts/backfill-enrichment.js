/**
 * Backfill Script for Vocabulary Enrichment Data
 * Populates synonyms, exampleSentences, and partsOfSpeech for existing Chinese vocab entries
 * 
 * Usage: node server/scripts/backfill-enrichment.js
 */

import Anthropic from '@anthropic-ai/sdk';
import db from '../db.js';
import { DictionaryService } from '../services/DictionaryService.js';
import { DictionaryDAL } from '../dal/implementations/DictionaryDAL.js';

const dictionaryDAL = new DictionaryDAL();
const dictionaryService = new DictionaryService(dictionaryDAL);

const ANTHROPIC_API_KEY = process.env.ANTHROPIC_API_KEY;
const anthropic = ANTHROPIC_API_KEY ? new Anthropic({ apiKey: ANTHROPIC_API_KEY }) : null;

async function generateExpansion(word) {
  if (!anthropic) return null;
  try {
    const prompt = `You are a Chinese language expert. Expand the following Chinese word by inserting additional characters to make it more explicit.

Rules:
- Every character from the original word must appear in the expansion, in their original order
- Never replace or omit any original character
- Examples:
  * 不知不觉 → 不知道不觉得 (added 道 and 得)
  * 违规 → 违反规矩 (added 反 and 矩)
  * 早晚 → 早上晚上 (added 上 twice)
- If the word cannot be meaningfully expanded while preserving all characters, return null

Word: ${word}

Respond with ONLY a JSON object in this exact format:
{"expansion": "expanded form"} or {"expansion": null}`;

    const response = await anthropic.messages.create({
      model: 'claude-haiku-4-5-20251001',
      max_tokens: 256,
      temperature: 0.7,
      messages: [{ role: 'user', content: prompt }]
    });

    const content = response.content[0].text.trim();
    const jsonText = content.replace(/^```(?:json)?\s*/i, '').replace(/\s*```\s*$/, '').trim();
    const parsed = JSON.parse(jsonText);
    return parsed.expansion || null;
  } catch (error) {
    console.error(`  Failed to generate expansion for "${word}": ${error.message}`);
    return null;
  }
}

const TONE_MARK_MAP = {
  'ā': 1, 'á': 2, 'ǎ': 3, 'à': 4,
  'ē': 1, 'é': 2, 'ě': 3, 'è': 4,
  'ī': 1, 'í': 2, 'ǐ': 3, 'ì': 4,
  'ō': 1, 'ó': 2, 'ǒ': 3, 'ò': 4,
  'ū': 1, 'ú': 2, 'ǔ': 3, 'ù': 4,
  'ǖ': 1, 'ǘ': 2, 'ǚ': 3, 'ǜ': 4,
};

function extractTones(pronunciation) {
  return pronunciation.split(' ').map(syllable => {
    for (const char of syllable) {
      if (TONE_MARK_MAP[char] !== undefined) return TONE_MARK_MAP[char];
    }
    return 0;
  }).join('');
}

async function backfillEnrichmentData() {
  console.log('🚀 Starting vocabulary enrichment backfill...\n');

  const client = await db.getClient();

  try {
    // Ensure the tone column exists (idempotent)
    await client.query(`
      ALTER TABLE vocabentries ADD COLUMN IF NOT EXISTS tone VARCHAR(20)
    `);
    console.log('✅ tone column ready\n');

    // Get all Chinese vocab entries without enrichment data
    const result = await client.query(`
      SELECT id, "entryKey", language
      FROM vocabentries
      WHERE language = 'zh'
      AND (
        synonyms IS NULL
        OR synonyms = '[]'::jsonb
        OR "exampleSentences" IS NULL
        OR "exampleSentences" = '[]'::jsonb
        OR "partsOfSpeech" IS NULL
        OR "partsOfSpeech" = '[]'::jsonb
        OR expansion IS NULL
      )
      ORDER BY id ASC
    `);

    const entries = result.rows;
    console.log(`📊 Found ${entries.length} Chinese entries to process\n`);

    if (entries.length === 0) {
      console.log('✅ All entries already have enrichment data!');
      return;
    }

    let processed = 0;
    let succeeded = 0;
    let failed = 0;

    for (const entry of entries) {
      processed++;

      try {
        console.log(`[${processed}/${entries.length}] Processing: ${entry.entryKey}...`);

        // Generate all enrichment fields in parallel
        const [synonyms, exampleSentences, partsOfSpeech, expansion] = await Promise.all([
          dictionaryService.findSynonyms(entry.entryKey, entry.language),
          dictionaryService.generateExampleSentences(entry.entryKey, entry.language),
          dictionaryService.extractPartsOfSpeech(entry.entryKey, entry.language),
          generateExpansion(entry.entryKey)
        ]);

        // Update the entry with enrichment data
        await client.query(`
          UPDATE vocabentries
          SET
            synonyms = $1,
            "exampleSentences" = $2,
            "partsOfSpeech" = $3,
            expansion = $4
          WHERE id = $5
        `, [
          JSON.stringify(synonyms),
          JSON.stringify(exampleSentences),
          JSON.stringify(partsOfSpeech),
          expansion,
          entry.id
        ]);

        succeeded++;
        console.log(`  ✓ Updated with ${synonyms.length} synonyms, ${exampleSentences.length} examples, ${partsOfSpeech.length} POS, expansion: ${expansion ? `"${expansion}"` : 'null'}\n`); ``

        // Progress indicator every 10 entries
        if (processed % 10 === 0) {
          console.log(`📈 Progress: ${processed}/${entries.length} (${Math.round(processed / entries.length * 100)}%)\n`);
        }

        // Small delay to avoid overwhelming the dictionary service
        await new Promise(resolve => setTimeout(resolve, 50));

      } catch (error) {
        failed++;
        console.error(`  ✗ Failed: ${error.message}\n`);
      }
    }

    console.log('\n' + '='.repeat(60));
    console.log('📊 Backfill Complete!');
    console.log('='.repeat(60));
    console.log(`Total processed: ${processed}`);
    console.log(`Succeeded: ${succeeded} (${Math.round(succeeded / processed * 100)}%)`);
    console.log(`Failed: ${failed} (${Math.round(failed / processed * 100)}%)`);
    console.log('='.repeat(60) + '\n');

    // Phase 2: backfill expansionMetadata for entries that have expansion but no expansionMetadata
    console.log('🔤 Starting expansionMetadata backfill phase...\n');

    // Ensure the expansionMetadata column exists (idempotent)
    await client.query(`
      ALTER TABLE vocabentries ADD COLUMN IF NOT EXISTS "expansionMetadata" JSONB DEFAULT NULL
    `);
    console.log('✅ expansionMetadata column ready\n');

    const expansionResult = await client.query(`
      SELECT id, expansion
      FROM vocabentries
      WHERE expansion IS NOT NULL AND "expansionMetadata" IS NULL
      ORDER BY id ASC
    `);
    const expansionEntries = expansionResult.rows;
    console.log(`📊 Found ${expansionEntries.length} entries needing expansionMetadata backfill\n`);

    let expansionUpdated = 0;
    for (const row of expansionEntries) {
      try {
        const chars = [...row.expansion];
        const dictEntries = await dictionaryDAL.findMultipleByWord1(chars, 'zh');
        const expansionMetadata = {};
        for (const entry of dictEntries) {
          if (!expansionMetadata[entry.word1]) {
            expansionMetadata[entry.word1] = {
              definition: Array.isArray(entry.definitions) ? entry.definitions[0] : entry.definitions,
              pronunciation: entry.pronunciation || ''
            };
          }
        }
        await client.query(
          `UPDATE vocabentries SET "expansionMetadata" = $1 WHERE id = $2`,
          [JSON.stringify(expansionMetadata), row.id]
        );
        expansionUpdated++;
      } catch (err) {
        console.error(`  ✗ Failed expansionMetadata for id ${row.id}: ${err.message}`);
      }
    }
    console.log(`✅ expansionMetadata backfill complete: ${expansionUpdated}/${expansionEntries.length} updated\n`);

    // Phase 3: backfill tone for entries that have pronunciation but no tone
    console.log('🔊 Starting tone backfill phase...\n');
    const toneResult = await client.query(`
      SELECT id, pronunciation
      FROM vocabentries
      WHERE tone IS NULL AND pronunciation IS NOT NULL
    `);
    const toneEntries = toneResult.rows;
    console.log(`📊 Found ${toneEntries.length} entries needing tone backfill\n`);

    let toneUpdated = 0;
    for (const row of toneEntries) {
      try {
        const tone = extractTones(row.pronunciation);
        await client.query(`UPDATE vocabentries SET tone = $1 WHERE id = $2`, [tone, row.id]);
        toneUpdated++;
      } catch (err) {
        console.error(`  ✗ Failed tone for id ${row.id}: ${err.message}`);
      }
    }
    console.log(`✅ Tone backfill complete: ${toneUpdated}/${toneEntries.length} updated\n`);

  } catch (error) {
    console.error('❌ Backfill failed:', error);
    throw error;
  } finally {
    client.release();
    await db.end();
  }
}

// Run the backfill
backfillEnrichmentData()
  .then(() => {
    console.log('✅ Script completed successfully');
    process.exit(0);
  })
  .catch((error) => {
    console.error('❌ Script failed:', error);
    process.exit(1);
  });
