import db from '../dist/db.js';

async function checkChineseCharacters() {
  try {
    console.log('Checking Chinese character encoding in database...\n');
    
    const pool = await db.poolPromise;
    
    // Get a few recent entries
    const result = await pool.request().query(`
      SELECT TOP 5 id, entryKey, entryValue, createdAt 
      FROM VocabEntries 
      ORDER BY createdAt DESC
    `);
    
    console.log('Recent entries from database:');
    console.log('================================');
    
    if (result.recordset.length === 0) {
      console.log('No entries found in database.');
      return;
    }
    
    result.recordset.forEach((entry, index) => {
      console.log(`Entry ${index + 1}:`);
      console.log(`  ID: ${entry.id}`);
      console.log(`  Key: "${entry.entryKey}"`);
      console.log(`  Value: "${entry.entryValue}"`);
      console.log(`  Created: ${entry.createdAt}`);
      
      // Check if characters are displaying as question marks
      const hasQuestionMarks = entry.entryKey.includes('?') || entry.entryValue.includes('?');
      if (hasQuestionMarks) {
        console.log('  ⚠️  Contains question marks - possible encoding issue');
      }
      
      // Check character codes for the first few characters
      console.log(`  Key char codes: ${Array.from(entry.entryKey.slice(0, 5)).map(c => c.charCodeAt(0)).join(', ')}`);
      console.log(`  Value char codes: ${Array.from(entry.entryValue.slice(0, 5)).map(c => c.charCodeAt(0)).join(', ')}`);
      console.log('  ---');
    });
    
    // Test inserting a Chinese character directly
    console.log('\nTesting direct Chinese character insertion...');
    const testKey = '测试';
    const testValue = 'Test';
    
    try {
      await pool.request()
        .input('userId', db.sql.UniqueIdentifier, '12345678-1234-1234-1234-123456789012') // dummy user ID
        .input('entryKey', db.sql.NText, testKey)
        .input('entryValue', db.sql.NText, testValue)
        .query(`
          INSERT INTO VocabEntries (userId, entryKey, entryValue)
          VALUES (@userId, @entryKey, @entryValue)
        `);
      
      console.log('✅ Successfully inserted test Chinese characters');
      
      // Retrieve the test entry
      const testResult = await pool.request()
        .input('entryKey', db.sql.NText, testKey)
        .query('SELECT entryKey, entryValue FROM VocabEntries WHERE entryKey = @entryKey');
      
      if (testResult.recordset.length > 0) {
        const retrieved = testResult.recordset[0];
        console.log(`Retrieved: Key="${retrieved.entryKey}", Value="${retrieved.entryValue}"`);
        
        if (retrieved.entryKey === testKey) {
          console.log('✅ Chinese characters preserved correctly');
        } else {
          console.log('❌ Chinese characters corrupted');
        }
      }
      
    } catch (error) {
      console.log('❌ Failed to insert test characters:', error.message);
    }
    
  } catch (error) {
    console.error('Error checking database:', error);
  }
}

checkChineseCharacters().then(() => {
  console.log('\nTest completed.');
  process.exit(0);
}).catch(error => {
  console.error('Test failed:', error);
  process.exit(1);
});
