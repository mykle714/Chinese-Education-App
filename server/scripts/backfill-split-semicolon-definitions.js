import dotenv from 'dotenv';
import { fileURLToPath } from 'url';
import path from 'path';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
dotenv.config({ path: path.join(__dirname, '../.env.docker') });

import db from '../db.js';

const DRY_RUN = process.argv.includes('--dry-run');

/**
 * Expands a definitions array by splitting any semicolon-delimited elements
 * into separate entries, maintaining original order.
 *
 * Example:
 *   ["to jump; to hop", "to bounce"]
 *   → ["to jump", "to hop", "to bounce"]
 */
function expandDefinitions(definitions) {
  const result = [];
  for (const def of definitions) {
    if (def.includes(';')) {
      const parts = def.split(';').map(p => p.trim()).filter(Boolean);
      result.push(...parts);
    } else {
      result.push(def);
    }
  }
  return result;
}

async function backfillSplitSemicolonDefinitions() {
  console.log(`Starting semicolon-split definitions backfill... ${DRY_RUN ? '(DRY RUN — no writes)' : ''}\n`);

  const client = await db.getClient();

  try {
    const result = await client.query(`
      SELECT id, word1, definitions
      FROM dictionaryentries
      ORDER BY id
    `);

    const entries = result.rows;
    console.log(`Found ${entries.length} total entries\n`);

    let changedCount = 0;
    let unchangedCount = 0;

    for (const entry of entries) {
      const definitions = Array.isArray(entry.definitions)
        ? entry.definitions
        : JSON.parse(entry.definitions || '[]');

      const expanded = expandDefinitions(definitions);

      // Only update if something actually changed
      if (JSON.stringify(definitions) === JSON.stringify(expanded)) {
        unchangedCount++;
        continue;
      }

      changedCount++;
      console.log(`[${entry.id}] "${entry.word1}"`);
      console.log(`  Before (${definitions.length}): ${JSON.stringify(definitions)}`);
      console.log(`  After  (${expanded.length}): ${JSON.stringify(expanded)}`);

      if (!DRY_RUN) {
        await client.query(`
          UPDATE dictionaryentries
          SET definitions = $1::jsonb
          WHERE id = $2
        `, [JSON.stringify(expanded), entry.id]);
      }
    }

    console.log('\n' + '='.repeat(60));
    console.log('BACKFILL SUMMARY');
    console.log('='.repeat(60));
    console.log(`Total entries scanned: ${entries.length}`);
    console.log(`Entries changed:       ${changedCount}`);
    console.log(`Entries unchanged:     ${unchangedCount}`);
    if (DRY_RUN) console.log('\n(DRY RUN — no changes were written to the database)');
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

backfillSplitSemicolonDefinitions().catch(error => {
  console.error('Fatal error:', error);
  process.exit(1);
});
