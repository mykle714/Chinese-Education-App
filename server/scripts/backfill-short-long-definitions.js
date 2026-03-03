import dotenv from 'dotenv';
import { fileURLToPath } from 'url';
import path from 'path';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
dotenv.config({ path: path.join(__dirname, '../.env.docker') });

import db from '../db.js';
import { DictionaryService } from '../services/DictionaryService.js';
import { DictionaryDAL } from '../dal/implementations/DictionaryDAL.js';

async function backfillShortLongDefinitions() {
  console.log('Starting shortDefinition / longDefinition backfill...\n');

  const client = await db.getClient();
  const dictionaryDAL = new DictionaryDAL();
  const dictionaryService = new DictionaryService(dictionaryDAL);

  try {
    const result = await client.query(`
      SELECT id, word1, language, definitions
      FROM dictionaryentries
      WHERE language = 'zh'
        AND discoverable = TRUE
        AND ("shortDefinition" IS NULL OR "longDefinition" IS NULL)
      ORDER BY id
    `);

    const entries = result.rows;
    console.log(`Found ${entries.length} entries to process\n`);

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
        const definitions = Array.isArray(entry.definitions)
          ? entry.definitions
          : JSON.parse(entry.definitions || '[]');

        const shortDef = dictionaryService.generateShortDefinition(definitions);

        if (!shortDef) {
          failCount++;
          console.log(`Skipped ID ${entry.id}: "${entry.word1}" (no short definition generated)`);
          continue;
        }

        const longDef = await dictionaryService.generateLongDefinition(
          entry.word1,
          entry.language,
          shortDef,
          definitions
        );

        await client.query(`
          UPDATE dictionaryentries
          SET "shortDefinition" = $1, "longDefinition" = $2
          WHERE id = $3
        `, [shortDef, longDef, entry.id]);

        successCount++;

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

backfillShortLongDefinitions().catch(error => {
  console.error('Fatal error:', error);
  process.exit(1);
});
