import db from '../db.js';
import { DictionaryService } from '../services/DictionaryService.js';
import { DictionaryDAL } from '../dal/implementations/DictionaryDAL.js';

// --words=未来,摸脉 → scope to specific entries only; omit to target all discoverable entries with breakdown IS NULL
const wordsArg = process.argv.find(a => a.startsWith('--words='));
const targetWords = wordsArg ? wordsArg.slice('--words='.length).split(',').map(s => s.trim()).filter(Boolean) : null;
const wordsFilter = targetWords?.length
  ? `AND word1 = ANY(ARRAY[${targetWords.map(w => `'${w.replace(/'/g, "''")}'`).join(', ')}])`
  : '';

async function backfillDictionaryBreakdown() {
  console.log('Starting dictionary breakdown backfill...\n');
  if (targetWords?.length) console.log(`🎯 Scoped to: ${targetWords.join(', ')}\n`);

  const client = await db.getClient();
  const dictionaryDAL = new DictionaryDAL();
  const dictionaryService = new DictionaryService(dictionaryDAL);

  try {
    const result = await client.query(`
      SELECT id, word1, language
      FROM dictionaryentries
      WHERE language = 'zh'
        AND discoverable = TRUE
        AND char_length(word1) > 1
        AND (breakdown IS NULL OR breakdown = 'null'::jsonb)
        ${wordsFilter}
      ORDER BY id
    `);

    const entries = result.rows;
    console.log(`Found ${entries.length} discoverable multi-char Chinese dictionary entries without breakdown\n`);

    if (entries.length === 0) {
      console.log('No entries to process.');
      return;
    }

    let processedCount = 0;
    let successCount = 0;
    let failCount = 0;

    for (const entry of entries) {
      processedCount++;

      try {
        const breakdown = await dictionaryService.generateBreakdown(entry.word1, entry.language);

        if (breakdown) {
          await client.query(`
            UPDATE dictionaryentries
            SET breakdown = $1
            WHERE id = $2
          `, [JSON.stringify(breakdown), entry.id]);

          successCount++;
        } else {
          failCount++;
          console.log(`Skipped ID ${entry.id}: "${entry.word1}" (no breakdown generated)`);
        }

        if (processedCount % 50 === 0) {
          console.log(`Progress: ${processedCount}/${entries.length} (${Math.round(processedCount / entries.length * 100)}%)`);
        }

      } catch (error) {
        failCount++;
        console.error(`Failed ID ${entry.id}: "${entry.word1}": ${error.message}`);
      }
    }

    console.log('\n' + '='.repeat(60));
    console.log('BACKFILL SUMMARY');
    console.log('='.repeat(60));
    console.log(`Total processed: ${processedCount}`);
    console.log(`Successfully updated: ${successCount}`);
    console.log(`Failed/Skipped: ${failCount}`);
    console.log(`Success rate: ${Math.round(successCount / processedCount * 100)}%`);
    console.log('='.repeat(60));
    console.log('\nBackfill complete.');

  } catch (error) {
    console.error('Fatal error during backfill:', error);
    throw error;
  } finally {
    client.release();
    await db.pool.end();
  }
}

backfillDictionaryBreakdown().catch(error => {
  console.error('Fatal error:', error);
  process.exit(1);
});
