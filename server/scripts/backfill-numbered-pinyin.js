/**
 * Backfill Script for DictionaryEntries numberedPinyin column
 *
 * Converts tone-marked pinyin (diacritics) to numbered pinyin notation.
 * Each syllable gets its tone number (1-4) appended. Neutral tone syllables
 * (no diacritics) get no number. The ü character is represented as "v".
 *
 * Examples:
 *   "gān huò"  -> "gan1 huo4"
 *   "pīn yīn"  -> "pin1 yin1"
 *   "lǘ"       -> "lv2"
 *   "de"        -> "de"         (neutral tone, no number)
 *   "nǚ"        -> "nv3"
 *
 * Usage (run from project root):
 *   node server/scripts/backfill-numbered-pinyin.js
 */

import db from '../db.js';

const BATCH_SIZE = 500;

/**
 * Maps every toned diacritic vowel to [base vowel, tone number].
 * Plain ü (no tone mark) is handled separately as 'v' with no tone.
 */
const DIACRITIC_MAP = {
  // a
  'ā': ['a', 1], 'á': ['a', 2], 'ǎ': ['a', 3], 'à': ['a', 4],
  // e
  'ē': ['e', 1], 'é': ['e', 2], 'ě': ['e', 3], 'è': ['e', 4],
  // i
  'ī': ['i', 1], 'í': ['i', 2], 'ǐ': ['i', 3], 'ì': ['i', 4],
  // o
  'ō': ['o', 1], 'ó': ['o', 2], 'ǒ': ['o', 3], 'ò': ['o', 4],
  // u
  'ū': ['u', 1], 'ú': ['u', 2], 'ǔ': ['u', 3], 'ù': ['u', 4],
  // ü (tone marks stripped, ü becomes v)
  'ǖ': ['v', 1], 'ǘ': ['v', 2], 'ǚ': ['v', 3], 'ǜ': ['v', 4],
};

/**
 * Convert a tone-marked pronunciation string to numbered pinyin.
 * Splits by spaces, processes each syllable independently.
 */
function toNumberedPinyin(pronunciation) {
  return pronunciation
    .split(' ')
    .map(syllable => {
      let result = '';
      let tone = null;

      for (const char of syllable) {
        if (DIACRITIC_MAP[char]) {
          const [base, toneNum] = DIACRITIC_MAP[char];
          result += base;
          tone = toneNum;
        } else if (char === 'ü') {
          // Plain ü with no tone mark → v, neutral tone
          result += 'v';
        } else {
          result += char;
        }
      }

      // Append tone number if a toned diacritic was found
      if (tone !== null) {
        result += tone;
      }

      return result;
    })
    .join(' ');
}

async function backfillNumberedPinyin() {
  console.log('🔢 Starting DictionaryEntries numberedPinyin backfill...\n');

  const client = await db.getClient();

  try {
    // Ensure the column exists (handles both fresh installs and renamed column)
    await client.query(`
      ALTER TABLE dictionaryentries ADD COLUMN IF NOT EXISTS "numberedPinyin" VARCHAR(500)
    `);
    console.log('✅ numberedPinyin column ready\n');

    // Count entries needing backfill
    const countResult = await client.query(`
      SELECT COUNT(*) AS count
      FROM dictionaryentries
      WHERE pronunciation IS NOT NULL AND "numberedPinyin" IS NULL
    `);
    const total = parseInt(countResult.rows[0].count, 10);
    console.log(`📊 Found ${total} DictionaryEntries needing numberedPinyin backfill\n`);

    if (total === 0) {
      console.log('✅ All entries already have numberedPinyin data!');
      return;
    }

    let totalUpdated = 0;
    let lastId = 0;

    while (true) {
      const batchResult = await client.query(`
        SELECT id, pronunciation
        FROM dictionaryentries
        WHERE pronunciation IS NOT NULL AND "numberedPinyin" IS NULL AND id > $1
        ORDER BY id ASC
        LIMIT $2
      `, [lastId, BATCH_SIZE]);

      const rows = batchResult.rows;
      if (rows.length === 0) break;

      const ids = rows.map(r => r.id);
      const numberedValues = rows.map(r => toNumberedPinyin(r.pronunciation));

      // Bulk update via unnest for efficiency
      await client.query(`
        UPDATE dictionaryentries
        SET "numberedPinyin" = v."numberedPinyin"
        FROM (
          SELECT unnest($1::int[]) AS id, unnest($2::text[]) AS "numberedPinyin"
        ) AS v
        WHERE dictionaryentries.id = v.id
      `, [ids, numberedValues]);

      totalUpdated += rows.length;
      lastId = ids[ids.length - 1];

      const progress = Math.round((totalUpdated / total) * 100);
      console.log(`📈 Progress: ${totalUpdated}/${total} (${progress}%)`);
    }

    console.log('\n' + '='.repeat(60));
    console.log('📊 Numbered Pinyin Backfill Complete!');
    console.log('='.repeat(60));
    console.log(`Total updated: ${totalUpdated}`);
    console.log('='.repeat(60) + '\n');

  } catch (error) {
    console.error('❌ Numbered pinyin backfill failed:', error);
    throw error;
  } finally {
    client.release();
    await db.pool.end();
  }
}

backfillNumberedPinyin()
  .then(() => {
    console.log('✅ Script completed successfully');
    process.exit(0);
  })
  .catch((error) => {
    console.error('❌ Script failed:', error);
    process.exit(1);
  });
