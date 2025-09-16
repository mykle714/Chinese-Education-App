import { Pool } from 'pg';

const config = {
  host: 'localhost',
  port: 5432,
  database: 'cow_db',
  user: 'cow_user',
  password: 'cow_password_local',
  max: 20,
  idleTimeoutMillis: 30000,
  connectionTimeoutMillis: 2000,
};

console.log('Testing PostgreSQL connection...');
console.log('Config:', { host: config.host, port: config.port, database: config.database, user: config.user });

async function testConnection() {
  const pool = new Pool(config);
  
  try {
    const client = await pool.connect();
    console.log('✅ Connected to PostgreSQL successfully!');
    
    const result = await client.query('SELECT version()');
    console.log('✅ Database version:', result.rows[0].version);
    
    const testResult = await client.query('SELECT COUNT(*) as count FROM vocabentries');
    console.log('✅ Sample data count:', testResult.rows[0].count, 'vocabulary entries');
    
    const sampleData = await client.query('SELECT entrykey, entryvalue, language, script FROM vocabentries LIMIT 3');
    console.log('✅ Sample vocabulary entries:');
    sampleData.rows.forEach(row => {
      console.log(`  - ${row.entrykey} (${row.language}): ${row.entryvalue}`);
    });
    
    client.release();
    console.log('✅ Connection test completed successfully!');
    process.exit(0);
  } catch (error) {
    console.error('❌ Connection test failed:', error.message);
    console.error('Error details:', error);
    process.exit(1);
  } finally {
    await pool.end();
  }
}

testConnection();
