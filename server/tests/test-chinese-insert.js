import db from '../dist/db.js';

async function testChineseCharacters() {
  try {
    console.log('Testing Chinese character insertion with updated schema...\n');
    
    const pool = await db.poolPromise;
    
    // Get a real user ID from the database
    const userResult = await pool.request().query('SELECT TOP 1 id FROM Users');
    if (userResult.recordset.length === 0) {
      console.log('❌ No users found in database. Please create a user first.');
      return;
    }
    
    const userId = userResult.recordset[0].id;
    console.log(`Using user ID: ${userId}`);
    
    // Test data with Chinese characters
    const testEntries = [
      { key: '你好', value: 'Hello' },
      { key: '谢谢', value: 'Thank you' },
      { key: '再见', value: 'Goodbye' },
      { key: '学习', value: 'To study/learn' },
      { key: '中文', value: 'Chinese language' }
    ];
    
    console.log('1. Inserting test Chinese entries...');
    
    for (const entry of testEntries) {
      try {
        await pool.request()
          .input('userId', db.sql.UniqueIdentifier, userId)
          .input('entryKey', db.sql.NVarChar, entry.key)
          .input('entryValue', db.sql.NVarChar, entry.value)
          .query(`
            INSERT INTO VocabEntries (userId, entryKey, entryValue)
            VALUES (@userId, @entryKey, @entryValue)
          `);
        console.log(`   ✅ Inserted: ${entry.key} = ${entry.value}`);
      } catch (error) {
        console.log(`   ❌ Failed to insert ${entry.key}: ${error.message}`);
      }
    }
    
    console.log('\n2. Retrieving and verifying Chinese entries...');
    
    const retrieveResult = await pool.request()
      .input('userId', db.sql.UniqueIdentifier, userId)
      .query(`
        SELECT TOP 10 entryKey, entryValue, createdAt 
        FROM VocabEntries 
        WHERE userId = @userId 
        ORDER BY createdAt DESC
      `);
    
    console.log('Recent entries:');
    console.log('===============');
    
    retrieveResult.recordset.forEach((entry, index) => {
      console.log(`${index + 1}. Key: "${entry.entryKey}" | Value: "${entry.entryValue}"`);
      
      // Check if characters are properly stored (not question marks)
      const hasQuestionMarks = entry.entryKey.includes('?') || entry.entryValue.includes('?');
      if (hasQuestionMarks) {
        console.log('   ⚠️  Still contains question marks');
      } else {
        // Check if we have Chinese characters (Unicode range)
        const hasChinese = /[\u4e00-\u9fff]/.test(entry.entryKey);
        if (hasChinese) {
          console.log('   ✅ Chinese characters preserved correctly');
        }
      }
    });
    
    console.log('\n3. Testing character encoding...');
    
    // Test a specific Chinese character
    const testChar = '测';
    const charResult = await pool.request()
      .input('testChar', db.sql.NVarChar, testChar)
      .query('SELECT @testChar as testChar');
    
    const retrievedChar = charResult.recordset[0].testChar;
    console.log(`Original: "${testChar}" (char code: ${testChar.charCodeAt(0)})`);
    console.log(`Retrieved: "${retrievedChar}" (char code: ${retrievedChar.charCodeAt(0)})`);
    
    if (testChar === retrievedChar) {
      console.log('✅ Character encoding test passed!');
    } else {
      console.log('❌ Character encoding test failed!');
    }
    
  } catch (error) {
    console.error('❌ Error testing Chinese characters:', error);
  }
}

testChineseCharacters().then(() => {
  console.log('\nChinese character test completed.');
  process.exit(0);
}).catch(error => {
  console.error('Test failed:', error);
  process.exit(1);
});
