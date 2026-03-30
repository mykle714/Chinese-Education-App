/**
 * Backfill Script for exampleSentencesMetadata in dictionaryentries
 * Populates exampleSentencesMetadata for discoverable dictionaryentries rows that have
 * exampleSentences but no metadata. The metadata maps each unique word/character segment
 * in the sentences to its pronunciation from the dictionary using greedy longest-match segmentation.
 *
 * Usage:
 *   npx tsx /app/scripts/backfill-example-sentences-metadata.js             # full backfill
 *   npx tsx /app/scripts/backfill-example-sentences-metadata.js --spot-check # test 5 entries
 */

import db from '../db.js';
import { DictionaryDAL } from '../dal/implementations/DictionaryDAL.js';
import { getAllSubstrings, buildDictMap, buildExcludeSet, segmentWithDict } from '../dal/shared/segmentString.js';

const dictionaryDAL = new DictionaryDAL();

// When --spot-check is passed, process only 5 entries and print detailed output per entry
const isSpotCheck = process.argv.includes('--spot-check');

async function backfillExampleSentencesMetadata() {
  if (isSpotCheck) {
    console.log('🔍 SPOT CHECK MODE — processing 5 entries only\n');
  }
  console.log('🚀 Starting exampleSentencesMetadata backfill for dictionaryentries...\n');

  const client = await db.getClient();

  try {
    // Ensure the exampleSentencesMetadata column exists (idempotent)
    await client.query(`
      ALTER TABLE dictionaryentries ADD COLUMN IF NOT EXISTS "exampleSentencesMetadata" JSONB DEFAULT NULL
    `);
    console.log('✅ exampleSentencesMetadata column ready\n');

    const result = await client.query(`
      SELECT id, "exampleSentences"
      FROM dictionaryentries
      WHERE discoverable = TRUE
        AND "exampleSentences" IS NOT NULL
        AND "exampleSentences" != '[]'::jsonb
        AND "exampleSentencesMetadata" IS NULL
      ORDER BY id ASC
      ${isSpotCheck ? 'LIMIT 5' : ''}
    `);
    const entries = result.rows;
    console.log(`📊 Found ${entries.length} entries needing exampleSentencesMetadata backfill\n`);

    let updated = 0;
    let failed = 0;

    for (const row of entries) {
      try {
        const sentences = Array.isArray(row.exampleSentences) ? row.exampleSentences : [];
        // Collect all candidate substrings across all sentences for a single batch lookup
        const allSubstrings = [...new Set(sentences.flatMap(s => getAllSubstrings(s.chinese || '')))];
        const dictEntries = await dictionaryDAL.findMultipleByWord1(allSubstrings, 'zh');
        const dictMap = buildDictMap(dictEntries);
        const excludeTokens = buildExcludeSet(dictEntries);
        const exampleSentencesMetadata = {};
        // Segment each sentence and build metadata from matched segments
        for (const s of sentences) {
          const segments = segmentWithDict(s.chinese || '', dictMap, excludeTokens);
          for (const seg of segments) {
            if (!dictMap.has(seg)) continue;
            // Split multi-char segments into individual characters so the frontend
            // can look up pinyin by single character (exampleSentencesMetadata?.[char])
            const chars = [...seg]; // Unicode-safe split
            const syllables = dictMap.get(seg).pronunciation.split(' ');
            if (chars.length === syllables.length) {
              for (let i = 0; i < chars.length; i++) {
                if (!exampleSentencesMetadata[chars[i]]) {
                  exampleSentencesMetadata[chars[i]] = { pronunciation: syllables[i] };
                }
              }
            } else {
              // Char/syllable count mismatch — fall back to storing the whole segment
              console.warn(`  ⚠ Char/syllable mismatch for "${seg}" on id ${row.id}`);
              if (!exampleSentencesMetadata[seg]) {
                exampleSentencesMetadata[seg] = { pronunciation: dictMap.get(seg).pronunciation };
              }
            }
          }
        }
        await client.query(
          `UPDATE dictionaryentries SET "exampleSentencesMetadata" = $1 WHERE id = $2`,
          [JSON.stringify(exampleSentencesMetadata), row.id]
        );
        updated++;

        // In spot-check mode, print a detailed breakdown for each entry
        if (isSpotCheck) {
          console.log(`  id=${row.id} → ${Object.keys(exampleSentencesMetadata).length} segments mapped:`);
          for (const [char, meta] of Object.entries(exampleSentencesMetadata)) {
            console.log(`    "${char}" → "${meta.pronunciation}"`);
          }
        } else if (updated % 50 === 0) {
          console.log(`📈 Progress: ${updated}/${entries.length} (${Math.round(updated / entries.length * 100)}%)`);
        }
      } catch (err) {
        failed++;
        console.error(`  ✗ Failed exampleSentencesMetadata for id ${row.id}: ${err.message}`);
      }
    }

    console.log('\n' + '='.repeat(60));
    console.log(isSpotCheck ? '📊 Spot Check Complete!' : '📊 Backfill Complete!');
    console.log('='.repeat(60));
    console.log(`Total: ${entries.length}`);
    console.log(`Updated: ${updated}`);
    console.log(`Failed: ${failed}`);
    console.log('='.repeat(60) + '\n');

  } catch (error) {
    console.error('❌ Backfill failed:', error);
    throw error;
  } finally {
    client.release();
  }
}

backfillExampleSentencesMetadata()
  .then(() => {
    console.log('✅ Script completed successfully');
    process.exit(0);
  })
  .catch((error) => {
    console.error('❌ Script failed:', error);
    process.exit(1);
  });
