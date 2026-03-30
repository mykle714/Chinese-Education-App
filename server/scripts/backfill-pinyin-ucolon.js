/**
 * Backfill Script: Fix u:N Pinyin Notation in dictionaryentries
 *
 * 1,154 rows have malformed `pronunciation` values using the CEDICT ASCII
 * stand-in `u:` for ü (e.g. `lu:3`, `nu:3`, `lu:e4`).  This script:
 *   1. Replaces all u:eN and u:N sequences with proper Unicode ü tone-marks.
 *   2. Recomputes the `tone` column from the corrected pronunciation.
 *
 * Compound finals (u:eN) are replaced BEFORE bare (u:N) to avoid partial matches.
 *
 * Usage (run from project root):
 *   node server/scripts/backfill-pinyin-ucolon.js
 */

import db from '../db.js';

const BATCH_SIZE = 500;

// Replacement map — order matters: compounds before bare vowels
const U_COLON_REPLACEMENTS = [
  ['u:e1', 'üē'],
  ['u:e2', 'üé'],
  ['u:e3', 'üě'],
  ['u:e4', 'üè'],
  ['u:1',  'ǖ'],
  ['u:2',  'ǘ'],
  ['u:3',  'ǚ'],
  ['u:4',  'ǜ'],
  ['u:5',  'ü'],  // neutral tone
];

const TONE_MARK_MAP = {
  'ā': 1, 'á': 2, 'ǎ': 3, 'à': 4,
  'ē': 1, 'é': 2, 'ě': 3, 'è': 4,
  'ī': 1, 'í': 2, 'ǐ': 3, 'ì': 4,
  'ō': 1, 'ó': 2, 'ǒ': 3, 'ò': 4,
  'ū': 1, 'ú': 2, 'ǔ': 3, 'ù': 4,
  'ǖ': 1, 'ǘ': 2, 'ǚ': 3, 'ǜ': 4,
};

/** Replace all u:eN / u:N sequences in a pronunciation string. */
function fixUColon(pronunciation) {
  let result = pronunciation;
  for (const [from, to] of U_COLON_REPLACEMENTS) {
    // Use replaceAll so every occurrence within a multi-syllable string is fixed
    result = result.replaceAll(from, to);
  }
  return result;
}

/** Re-extract tone digits from a corrected pronunciation string (matches pinyin.ts). */
function extractTones(pronunciation) {
  return pronunciation.split(' ').map(syllable => {
    for (const char of syllable) {
      if (TONE_MARK_MAP[char] !== undefined) return TONE_MARK_MAP[char];
    }
    return 0; // neutral tone
  }).join('');
}

async function backfillUColonPinyin() {
  console.log('🔧 Starting u:N pinyin notation backfill...\n');

  const client = await db.getClient();

  try {
    // Count affected rows
    const countResult = await client.query(`
      SELECT COUNT(*) AS count
      FROM dictionaryentries
      WHERE pronunciation LIKE '%:%'
    `);
    const total = parseInt(countResult.rows[0].count, 10);
    console.log(`📊 Found ${total} rows with u:N notation\n`);

    if (total === 0) {
      console.log('✅ No rows need fixing — nothing to do.');
      return;
    }

    let offset = 0;
    let totalUpdated = 0;

    while (offset < total) {
      // Fetch a batch of affected rows
      const batchResult = await client.query(`
        SELECT id, pronunciation
        FROM dictionaryentries
        WHERE pronunciation LIKE '%:%'
        ORDER BY id ASC
        LIMIT $1 OFFSET $2
      `, [BATCH_SIZE, offset]);

      const rows = batchResult.rows;
      if (rows.length === 0) break;

      // Compute corrected pronunciation and tone for each row
      const ids          = [];
      const pronunciations = [];
      const tones        = [];

      for (const row of rows) {
        const fixed = fixUColon(row.pronunciation);
        ids.push(row.id);
        pronunciations.push(fixed);
        tones.push(extractTones(fixed));
      }

      // Bulk update both columns in a single query
      await client.query(`
        UPDATE dictionaryentries
        SET
          pronunciation = v.pronunciation,
          tone          = v.tone
        FROM (
          SELECT
            unnest($1::int[])  AS id,
            unnest($2::text[]) AS pronunciation,
            unnest($3::text[]) AS tone
        ) AS v
        WHERE dictionaryentries.id = v.id
      `, [ids, pronunciations, tones]);

      totalUpdated += rows.length;
      offset += rows.length;

      const progress = Math.round((totalUpdated / total) * 100);
      console.log(`📈 Progress: ${totalUpdated}/${total} (${progress}%)`);
    }

    console.log('\n' + '='.repeat(60));
    console.log('📊 u:N Pinyin Backfill Complete!');
    console.log('='.repeat(60));
    console.log(`Total rows updated: ${totalUpdated}`);
    console.log('='.repeat(60) + '\n');

  } catch (error) {
    console.error('❌ Backfill failed:', error);
    throw error;
  } finally {
    client.release();
    await db.pool.end();
  }
}

backfillUColonPinyin()
  .then(() => {
    console.log('✅ Script completed successfully');
    process.exit(0);
  })
  .catch((error) => {
    console.error('❌ Script failed:', error);
    process.exit(1);
  });
