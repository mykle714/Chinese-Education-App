/**
 * Backfill Script for DictionaryEntries tone column
 * Computes tone strings from existing pronunciation data for Chinese dictionary entries.
 *
 * Usage: node server/scripts/backfill-tones.js
 */

import db from '../db.js';

const BATCH_SIZE = 500;

// --words=未来,摸脉 → scope to specific entries only; omit to target all zh entries with tone IS NULL
const wordsArg = process.argv.find(a => a.startsWith('--words='));
const targetWords = wordsArg ? wordsArg.slice('--words='.length).split(',').map(s => s.trim()).filter(Boolean) : null;
const wordsFilter = targetWords?.length
  ? `AND word1 = ANY(ARRAY[${targetWords.map(w => `'${w.replace(/'/g, "''")}'`).join(', ')}])`
  : '';

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

async function backfillDictionaryTones() {
  console.log('🔊 Starting DictionaryEntries tone backfill...\n');
  if (targetWords?.length) console.log(`🎯 Scoped to: ${targetWords.join(', ')}\n`);

  const client = await db.getClient();

  try {
    // Ensure the tone column exists (idempotent)
    await client.query(`
      ALTER TABLE dictionaryentries ADD COLUMN IF NOT EXISTS tone VARCHAR(20)
    `);
    console.log('✅ tone column ready\n');

    // Count entries needing backfill
    const countResult = await client.query(`
      SELECT COUNT(*) as count
      FROM dictionaryentries
      WHERE language = 'zh' AND pronunciation IS NOT NULL AND tone IS NULL ${wordsFilter}
    `);
    const total = parseInt(countResult.rows[0].count, 10);
    console.log(`📊 Found ${total} DictionaryEntries needing tone backfill\n`);

    if (total === 0) {
      console.log('✅ All entries already have tone data!');
      return;
    }

    // Cursor-based pagination (id > lastId) avoids the OFFSET sliding-window bug
    // where updated rows fall out of the WHERE clause and shift subsequent offsets.
    let lastId = 0;
    let totalUpdated = 0;

    while (true) {
      const batchResult = await client.query(`
        SELECT id, pronunciation
        FROM dictionaryentries
        WHERE language = 'zh' AND pronunciation IS NOT NULL AND tone IS NULL AND id > $1 ${wordsFilter}
        ORDER BY id ASC
        LIMIT $2
      `, [lastId, BATCH_SIZE]);

      const rows = batchResult.rows;
      if (rows.length === 0) break;

      const ids = rows.map(r => r.id);
      const tones = rows.map(r => extractTones(r.pronunciation));

      await client.query(`
        UPDATE dictionaryentries
        SET tone = v.tone
        FROM (
          SELECT unnest($1::int[]) AS id, unnest($2::text[]) AS tone
        ) AS v
        WHERE dictionaryentries.id = v.id
      `, [ids, tones]);

      totalUpdated += rows.length;
      lastId = ids[ids.length - 1];

      const progress = Math.round((totalUpdated / total) * 100);
      console.log(`📈 Progress: ${totalUpdated}/${total} (${progress}%)`);
    }

    console.log('\n' + '='.repeat(60));
    console.log('📊 Tone Backfill Complete!');
    console.log('='.repeat(60));
    console.log(`Total updated: ${totalUpdated}`);
    console.log('='.repeat(60) + '\n');

  } catch (error) {
    console.error('❌ Tone backfill failed:', error);
    throw error;
  } finally {
    client.release();
    await db.end();
  }
}

backfillDictionaryTones()
  .then(() => {
    console.log('✅ Script completed successfully');
    process.exit(0);
  })
  .catch((error) => {
    console.error('❌ Script failed:', error);
    process.exit(1);
  });
