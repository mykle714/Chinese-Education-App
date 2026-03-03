import { Pool } from 'pg';
import dotenv from 'dotenv';

dotenv.config();

const config = {
  host: process.env.DB_HOST || 'localhost',
  port: parseInt(process.env.DB_PORT || '5432'),
  database: process.env.DB_NAME || 'cow_db',
  user: process.env.DB_USER || 'cow_user',
  password: process.env.DB_PASSWORD || 'cow_password_local',
  ssl: false
};

const pool = new Pool(config);

async function queryDiscoverableCards() {
  const client = await pool.connect();
  try {
    console.log('🔍 Querying discoverable cards...\n');

    // Query 1: Total count of discoverable cards
    console.log('Query 1: Total discoverable cards');
    const totalResult = await client.query(
      'SELECT COUNT(*) as total_discoverable FROM dictionaryentries WHERE discoverable = TRUE'
    );
    console.log(`Total discoverable cards: ${totalResult.rows[0].total_discoverable}\n`);

    // Query 2: Count by language
    console.log('Query 2: Discoverable cards by language');
    const byLanguageResult = await client.query(
      'SELECT language, COUNT(*) as count FROM dictionaryentries WHERE discoverable = TRUE GROUP BY language ORDER BY language'
    );
    console.log('Results:');
    byLanguageResult.rows.forEach(row => {
      console.log(`  ${row.language}: ${row.count}`);
    });

    // Query 3: Total vocabentries rows
    console.log('\nQuery 3: Total vocabentries rows');
    const vocabResult = await client.query('SELECT COUNT(*) as total FROM vocabentries');
    console.log(`Total vocabentries: ${vocabResult.rows[0].total}`);

    console.log('\n✅ Query completed successfully');
  } catch (error) {
    console.error('❌ Query failed:', error.message);
    process.exit(1);
  } finally {
    client.release();
    await pool.end();
  }
}

queryDiscoverableCards();
