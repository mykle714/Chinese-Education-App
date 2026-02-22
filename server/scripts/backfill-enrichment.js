/**
 * Backfill Script for Vocabulary Enrichment Data
 * Populates synonyms, exampleSentences, and partsOfSpeech for existing Chinese vocab entries
 * 
 * Usage: node server/scripts/backfill-enrichment.js
 */

import db from '../db.js';
import { DictionaryService } from '../services/DictionaryService.js';
import { DictionaryDAL } from '../dal/implementations/DictionaryDAL.js';

const dictionaryDAL = new DictionaryDAL();
const dictionaryService = new DictionaryService(dictionaryDAL);

async function backfillEnrichmentData() {
  console.log('🚀 Starting vocabulary enrichment backfill...\n');
  
  const client = await db.getClient();
  
  try {
    // Get all Chinese vocab entries without enrichment data
    const result = await client.query(`
      SELECT id, "entryKey", language
      FROM vocabentries
      WHERE language = 'zh'
      AND (
        synonyms IS NULL 
        OR synonyms = '[]'::jsonb
        OR "exampleSentences" IS NULL
        OR "exampleSentences" = '[]'::jsonb
        OR "partsOfSpeech" IS NULL
        OR "partsOfSpeech" = '[]'::jsonb
      )
      ORDER BY id ASC
    `);
    
    const entries = result.rows;
    console.log(`📊 Found ${entries.length} Chinese entries to process\n`);
    
    if (entries.length === 0) {
      console.log('✅ All entries already have enrichment data!');
      return;
    }
    
    let processed = 0;
    let succeeded = 0;
    let failed = 0;
    
    for (const entry of entries) {
      processed++;
      
      try {
        console.log(`[${processed}/${entries.length}] Processing: ${entry.entryKey}...`);
        
        // Generate all enrichment fields in parallel
        const [synonyms, exampleSentences, partsOfSpeech] = await Promise.all([
          dictionaryService.findSynonyms(entry.entryKey, entry.language),
          dictionaryService.generateExampleSentences(entry.entryKey, entry.language),
          dictionaryService.extractPartsOfSpeech(entry.entryKey, entry.language)
        ]);
        
        // Update the entry with enrichment data
        await client.query(`
          UPDATE vocabentries
          SET 
            synonyms = $1,
            "exampleSentences" = $2,
            "partsOfSpeech" = $3
          WHERE id = $4
        `, [
          JSON.stringify(synonyms),
          JSON.stringify(exampleSentences),
          JSON.stringify(partsOfSpeech),
          entry.id
        ]);
        
        succeeded++;
        console.log(`  ✓ Updated with ${synonyms.length} synonyms, ${exampleSentences.length} examples, ${partsOfSpeech.length} POS\n`);
        
        // Progress indicator every 10 entries
        if (processed % 10 === 0) {
          console.log(`📈 Progress: ${processed}/${entries.length} (${Math.round(processed/entries.length*100)}%)\n`);
        }
        
        // Small delay to avoid overwhelming the dictionary service
        await new Promise(resolve => setTimeout(resolve, 50));
        
      } catch (error) {
        failed++;
        console.error(`  ✗ Failed: ${error.message}\n`);
      }
    }
    
    console.log('\n' + '='.repeat(60));
    console.log('📊 Backfill Complete!');
    console.log('='.repeat(60));
    console.log(`Total processed: ${processed}`);
    console.log(`Succeeded: ${succeeded} (${Math.round(succeeded/processed*100)}%)`);
    console.log(`Failed: ${failed} (${Math.round(failed/processed*100)}%)`);
    console.log('='.repeat(60) + '\n');
    
  } catch (error) {
    console.error('❌ Backfill failed:', error);
    throw error;
  } finally {
    client.release();
    await db.end();
  }
}

// Run the backfill
backfillEnrichmentData()
  .then(() => {
    console.log('✅ Script completed successfully');
    process.exit(0);
  })
  .catch((error) => {
    console.error('❌ Script failed:', error);
    process.exit(1);
  });
