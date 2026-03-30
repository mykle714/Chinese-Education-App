/**
 * Backfill Script for DictionaryEntries toneless column
 *
 * Strips tone diacritics from the pronunciation column and writes the result
 * to the toneless column. Applies to all languages (zh, ja, ko, vi) since
 * the strip map is explicit and only targets known diacritic characters.
 *
 * Examples:
 *   "pīn yīn"  -> "pin yin"
 *   "lǘ"       -> "lü"
 *   "hàn zì"   -> "han zi"
 *
 * Usage (run from project root):
 *   node server/scripts/backfill-toneless.js
 */

import db from '../db.js';

const BATCH_SIZE = 500;

/**
 * Maps every toned diacritic vowel to its bare (toneless) form.
 * ü is kept as ü — only the tone number is stripped, not the umlaut.
 */
const DIACRITIC_MAP = {
  // a
  'ā': 'a', 'á': 'a', 'ǎ': 'a', 'à': 'a',
  // e
  'ē': 'e', 'é': 'e', 'ě': 'e', 'è': 'e',
  // i
  'ī': 'i', 'í': 'i', 'ǐ': 'i', 'ì': 'i',
  // o
  'ō': 'o', 'ó': 'o', 'ǒ': 'o', 'ò': 'o',
  // u
  'ū': 'u', 'ú': 'u', 'ǔ': 'u', 'ù': 'u',
  // ü (tone marks stripped, umlaut preserved)
  'ǖ': 'ü', 'ǘ': 'ü', 'ǚ': 'ü', 'ǜ': 'ü',
};

/** Strip tone diacritics from a pronunciation string, preserving spaces and ü. */
function stripTones(pronunciation) {
  return pronunciation
    .split('')
    .map(char => DIACRITIC_MAP[char] ?? char)
    .join('');
}

async function backfillToneless() {
  console.log('🔇 Starting DictionaryEntries toneless backfill...\n');

  const client = await db.getClient();

  try {
    // Ensure the toneless column exists (idempotent — safe to re-run)
    await client.query(`
      ALTER TABLE dictionaryentries ADD COLUMN IF NOT EXISTS toneless VARCHAR(500)
    `);
    console.log('✅ toneless column ready\n');

    // Count entries needing backfill
    const countResult = await client.query(`
      SELECT COUNT(*) AS count
      FROM dictionaryentries
      WHERE pronunciation IS NOT NULL AND toneless IS NULL
    `);
    const total = parseInt(countResult.rows[0].count, 10);
    console.log(`📊 Found ${total} DictionaryEntries needing toneless backfill\n`);

    if (total === 0) {
      console.log('✅ All entries already have toneless data!');
      return;
    }

    let offset = 0;
    let totalUpdated = 0;

    // Use cursor-style pagination by id to avoid offset drift as rows are updated
    let lastId = 0;

    while (true) {
      // Always fetch from id > lastId so updated rows naturally fall out of the set
      const batchResult = await client.query(`
        SELECT id, pronunciation
        FROM dictionaryentries
        WHERE pronunciation IS NOT NULL AND toneless IS NULL AND id > $1
        ORDER BY id ASC
        LIMIT $2
      `, [lastId, BATCH_SIZE]);

      const rows = batchResult.rows;
      if (rows.length === 0) break;

      const ids            = rows.map(r => r.id);
      const tonelessValues = rows.map(r => stripTones(r.pronunciation));

      // Bulk update via unnest for efficiency
      await client.query(`
        UPDATE dictionaryentries
        SET toneless = v.toneless
        FROM (
          SELECT unnest($1::int[]) AS id, unnest($2::text[]) AS toneless
        ) AS v
        WHERE dictionaryentries.id = v.id
      `, [ids, tonelessValues]);

      totalUpdated += rows.length;
      lastId = ids[ids.length - 1];

      const progress = Math.round((totalUpdated / total) * 100);
      console.log(`📈 Progress: ${totalUpdated}/${total} (${progress}%)`);
    }

    console.log('\n' + '='.repeat(60));
    console.log('📊 Toneless Backfill Complete!');
    console.log('='.repeat(60));
    console.log(`Total updated: ${totalUpdated}`);
    console.log('='.repeat(60) + '\n');

  } catch (error) {
    console.error('❌ Toneless backfill failed:', error);
    throw error;
  } finally {
    client.release();
    await db.pool.end();
  }
}

backfillToneless()
  .then(() => {
    console.log('✅ Script completed successfully');
    process.exit(0);
  })
  .catch((error) => {
    console.error('❌ Script failed:', error);
    process.exit(1);
  });
