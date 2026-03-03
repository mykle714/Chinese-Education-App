/**
 * Backfill Script for DictionaryEntries tone column
 * Computes tone strings from existing pronunciation data for Chinese dictionary entries.
 *
 * Usage: node server/scripts/backfill-tones.js
 */

import db from '../db.js';

const BATCH_SIZE = 500;

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
      WHERE language = 'zh' AND pronunciation IS NOT NULL AND tone IS NULL
    `);
    const total = parseInt(countResult.rows[0].count, 10);
    console.log(`📊 Found ${total} DictionaryEntries needing tone backfill\n`);

    if (total === 0) {
      console.log('✅ All entries already have tone data!');
      return;
    }

    let offset = 0;
    let totalUpdated = 0;

    while (offset < total) {
      // Fetch a batch
      const batchResult = await client.query(`
        SELECT id, pronunciation
        FROM dictionaryentries
        WHERE language = 'zh' AND pronunciation IS NOT NULL AND tone IS NULL
        ORDER BY id ASC
        LIMIT $1 OFFSET $2
      `, [BATCH_SIZE, offset]);

      const rows = batchResult.rows;
      if (rows.length === 0) break;

      // Build bulk update values
      const updates = rows.map(row => ({
        id: row.id,
        tone: extractTones(row.pronunciation)
      }));

      // Execute updates in a single query using unnest
      const ids = updates.map(u => u.id);
      const tones = updates.map(u => u.tone);

      await client.query(`
        UPDATE dictionaryentries
        SET tone = v.tone
        FROM (
          SELECT unnest($1::int[]) AS id, unnest($2::text[]) AS tone
        ) AS v
        WHERE dictionaryentries.id = v.id
      `, [ids, tones]);

      totalUpdated += rows.length;
      offset += rows.length;

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
