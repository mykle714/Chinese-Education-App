/**
 * Backfill Script: Populate breakdown data for existing Chinese vocabulary entries
 * 
 * This script:
 * 1. Fetches all Chinese vocab entries (language = 'zh')
 * 2. Generates character breakdown for each entry
 * 3. Updates the breakdown column in the database
 * 
 * Usage: node server/scripts/backfill-breakdown.js
 */

import db from '../db.js';
import { DictionaryService } from '../services/DictionaryService.js';
import { DictionaryDAL } from '../dal/implementations/DictionaryDAL.js';

async function backfillBreakdown() {
  console.log('🚀 Starting breakdown backfill process...\n');
  
  const client = await db.getClient();
  const dictionaryDAL = new DictionaryDAL();
  const dictionaryService = new DictionaryService(dictionaryDAL);
  
  try {
    // Fetch all Chinese vocab entries that don't have breakdown yet
    const result = await client.query(`
      SELECT id, "entryKey", language
      FROM vocabentries
      WHERE language = 'zh'
      AND (breakdown IS NULL OR breakdown = 'null'::jsonb)
      ORDER BY id
    `);
    
    const entries = result.rows;
    console.log(`📊 Found ${entries.length} Chinese vocab entries without breakdown\n`);
    
    if (entries.length === 0) {
      console.log('✅ No entries to process. All Chinese entries already have breakdown!');
      return;
    }
    
    let processedCount = 0;
    let successCount = 0;
    let failCount = 0;
    
    // Process each entry
    for (const entry of entries) {
      processedCount++;
      
      try {
        // Generate breakdown using DictionaryService
        const breakdown = await dictionaryService.generateBreakdown(entry.entryKey, entry.language);
        
        if (breakdown) {
          // Update the entry with the breakdown
          await client.query(`
            UPDATE vocabentries
            SET breakdown = $1
            WHERE id = $2
          `, [JSON.stringify(breakdown), entry.id]);
          
          successCount++;
          console.log(`✅ [${processedCount}/${entries.length}] Updated entry ID ${entry.id}: "${entry.entryKey}"`);
        } else {
          failCount++;
          console.log(`⚠️  [${processedCount}/${entries.length}] Skipped entry ID ${entry.id}: "${entry.entryKey}" (no breakdown generated)`);
        }
        
        // Log progress every 50 entries
        if (processedCount % 50 === 0) {
          console.log(`\n📈 Progress: ${processedCount}/${entries.length} (${Math.round(processedCount / entries.length * 100)}%)\n`);
        }
        
      } catch (error) {
        failCount++;
        console.error(`❌ [${processedCount}/${entries.length}] Failed to process entry ID ${entry.id}: ${error.message}`);
      }
    }
    
    // Summary
    console.log('\n' + '='.repeat(60));
    console.log('📊 BACKFILL SUMMARY');
    console.log('='.repeat(60));
    console.log(`Total entries processed: ${processedCount}`);
    console.log(`Successfully updated: ${successCount}`);
    console.log(`Failed/Skipped: ${failCount}`);
    console.log(`Success rate: ${Math.round(successCount / processedCount * 100)}%`);
    console.log('='.repeat(60));
    console.log('\n✅ Backfill process completed!');
    
  } catch (error) {
    console.error('❌ Fatal error during backfill:', error);
    throw error;
  } finally {
    client.release();
    // Close the database pool to allow the script to exit
    await db.closePool();
  }
}

// Run the backfill
backfillBreakdown().catch(error => {
  console.error('Fatal error:', error);
  process.exit(1);
});
