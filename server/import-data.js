import { Pool } from 'pg';
import fs from 'fs';
import path from 'path';

// PostgreSQL configuration
const pgConfig = {
  host: 'localhost',
  port: 5432,
  database: 'cow_db',
  user: 'cow_user',
  password: 'cow_password_local',
  max: 20,
  idleTimeoutMillis: 30000,
  connectionTimeoutMillis: 2000,
};

async function importData() {
  const pool = new Pool(pgConfig);
  
  try {
    console.log('🔄 Connecting to PostgreSQL...');
    const client = await pool.connect();
    console.log('✅ Connected to PostgreSQL');

    const exportDir = path.join(process.cwd(), '..', 'database', 'exports');
    
    // Check if export files exist
    const usersFile = path.join(exportDir, 'users_export.json');
    const vocabFile = path.join(exportDir, 'vocabentries_export.json');
    const onDeckFile = path.join(exportDir, 'ondeckvocabsets_export.json');

    if (!fs.existsSync(usersFile)) {
      console.error('❌ Users export file not found. Run export-azure-data.js first.');
      process.exit(1);
    }

    if (!fs.existsSync(vocabFile)) {
      console.error('❌ VocabEntries export file not found. Run export-azure-data.js first.');
      process.exit(1);
    }

    // Start transaction
    await client.query('BEGIN');
    console.log('🔄 Started transaction');

    // Clear existing sample data
    console.log('🔄 Clearing existing sample data...');
    await client.query('DELETE FROM ondeckvocabsets');
    await client.query('DELETE FROM vocabentries');
    await client.query('DELETE FROM users');
    console.log('✅ Cleared existing data');

    // Import Users
    console.log('🔄 Importing Users...');
    const usersData = JSON.parse(fs.readFileSync(usersFile, 'utf8'));
    let usersImported = 0;
    
    for (const user of usersData.data) {
      try {
        await client.query(`
          INSERT INTO users (id, email, name, password, createdat)
          VALUES ($1, $2, $3, $4, $5)
        `, [user.id, user.email, user.name, user.password, user.createdAt]);
        usersImported++;
      } catch (error) {
        console.warn(`⚠️  Failed to import user ${user.email}:`, error.message);
      }
    }
    console.log(`✅ Imported ${usersImported}/${usersData.totalRecords} users`);

    // Import VocabEntries
    console.log('🔄 Importing VocabEntries...');
    const vocabData = JSON.parse(fs.readFileSync(vocabFile, 'utf8'));
    let vocabImported = 0;
    
    for (const entry of vocabData.data) {
      try {
        await client.query(`
          INSERT INTO vocabentries (id, userid, entrykey, entryvalue, language, script, iscustomtag, hskleveltag, createdat)
          VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9)
        `, [
          entry.id,
          entry.userId,
          entry.entryKey,
          entry.entryValue,
          'zh', // Default language for existing entries
          null, // Script will be null for existing entries
          entry.isCustomTag || false,
          entry.hskLevelTag || null,
          entry.createdAt
        ]);
        vocabImported++;
      } catch (error) {
        console.warn(`⚠️  Failed to import vocab entry ${entry.entryKey}:`, error.message);
      }
    }
    console.log(`✅ Imported ${vocabImported}/${vocabData.totalRecords} vocabulary entries`);

    // Import OnDeckVocabSets (if file exists)
    let onDeckImported = 0;
    if (fs.existsSync(onDeckFile)) {
      console.log('🔄 Importing OnDeckVocabSets...');
      const onDeckData = JSON.parse(fs.readFileSync(onDeckFile, 'utf8'));
      
      for (const set of onDeckData.data) {
        try {
          await client.query(`
            INSERT INTO ondeckvocabsets (userid, featurename, vocabentryids, updatedat)
            VALUES ($1, $2, $3, $4)
          `, [
            set.userId,
            set.featureName,
            JSON.stringify(set.vocabEntryIds),
            set.updatedAt
          ]);
          onDeckImported++;
        } catch (error) {
          console.warn(`⚠️  Failed to import on-deck set ${set.featureName}:`, error.message);
        }
      }
      console.log(`✅ Imported ${onDeckImported}/${onDeckData.totalRecords} on-deck vocab sets`);
    } else {
      console.log('ℹ️  No OnDeckVocabSets export file found - skipping');
    }

    // Update sequence values for auto-increment columns
    console.log('🔄 Updating sequence values...');
    
    // Update vocabentries sequence
    const maxVocabId = await client.query('SELECT MAX(id) as max_id FROM vocabentries');
    const maxId = maxVocabId.rows[0].max_id || 0;
    if (maxId > 0) {
      await client.query(`SELECT setval('vocabentries_id_seq', $1, true)`, [maxId]);
      console.log(`✅ Updated vocabentries sequence to ${maxId}`);
    }

    // Commit transaction
    await client.query('COMMIT');
    console.log('✅ Transaction committed');

    // Verify import
    console.log('🔄 Verifying import...');
    const userCount = await client.query('SELECT COUNT(*) as count FROM users');
    const vocabCount = await client.query('SELECT COUNT(*) as count FROM vocabentries');
    const onDeckCount = await client.query('SELECT COUNT(*) as count FROM ondeckvocabsets');
    
    console.log('\n🎉 Data import completed successfully!');
    console.log(`👥 Users: ${userCount.rows[0].count}`);
    console.log(`📚 Vocabulary entries: ${vocabCount.rows[0].count}`);
    console.log(`📋 On-deck sets: ${onDeckCount.rows[0].count}`);

    // Test multi-language data
    console.log('\n🔄 Testing multi-language support...');
    const sampleEntries = await client.query(`
      SELECT entrykey, entryvalue, language, script 
      FROM vocabentries 
      WHERE entrykey ~ '[\\u4e00-\\u9fff]|[\\u3040-\\u309f]|[\\u30a0-\\u30ff]|[\\uac00-\\ud7af]'
      LIMIT 5
    `);
    
    if (sampleEntries.rows.length > 0) {
      console.log('✅ Multi-language entries found:');
      sampleEntries.rows.forEach(row => {
        console.log(`  - ${row.entrykey} (${row.language || 'unknown'}): ${row.entryvalue}`);
      });
    } else {
      console.log('ℹ️  No multi-language entries found in imported data');
    }

    client.release();

  } catch (error) {
    console.error('❌ Import failed:', error.message);
    console.error('Full error:', error);
    
    // Try to rollback
    try {
      const client = await pool.connect();
      await client.query('ROLLBACK');
      client.release();
      console.log('🔄 Transaction rolled back');
    } catch (rollbackError) {
      console.error('❌ Failed to rollback transaction:', rollbackError.message);
    }
    
    process.exit(1);
  } finally {
    await pool.end();
    console.log('🔌 Disconnected from PostgreSQL');
  }
}

// Run the import
importData();
