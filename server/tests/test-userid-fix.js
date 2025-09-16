/**
 * Simple test to verify userId is properly preserved in VocabEntry creation
 * This test directly uses the DAL classes to test the camelCase column fix
 */

import { VocabEntryDAL } from '../dist/dal/implementations/VocabEntryDAL.js';
import { UserDAL } from '../dist/dal/implementations/UserDAL.js';
import bcrypt from 'bcrypt';

console.log('🧪 Testing userId preservation in VocabEntry creation...\n');

async function testUserIdFix() {
  try {
    // Create DAL instances
    const userDAL = new UserDAL();
    const vocabEntryDAL = new VocabEntryDAL();
    
    console.log('📋 Step 1: Creating test user...');
    
    // Create a test user with unique email
    const timestamp = Date.now();
    const hashedPassword = await bcrypt.hash('testpassword123', 10);
    const testUser = await userDAL.create({
      email: `test-userid-fix-${timestamp}@example.com`,
      name: 'Test User',
      password: hashedPassword
    });
    
    console.log('✅ User created successfully:');
    console.log(`   ID: ${testUser.id}`);
    console.log(`   Email: ${testUser.email}`);
    console.log('');
    
    console.log('📋 Step 2: Creating vocab entry with userId...');
    
    // Create a vocab entry with the user ID
    const testEntry = await vocabEntryDAL.create({
      userId: testUser.id,
      entryKey: '测试',
      entryValue: 'test',
      isCustomTag: true,
      hskLevelTag: 'HSK1'
    });
    
    console.log('✅ VocabEntry created successfully:');
    console.log(`   ID: ${testEntry.id}`);
    console.log(`   User ID: ${testEntry.userId}`);
    console.log(`   Entry Key: ${testEntry.entryKey}`);
    console.log(`   Entry Value: ${testEntry.entryValue}`);
    console.log('');
    
    console.log('📋 Step 3: Verifying userId is preserved...');
    
    // Verify the userId is correctly preserved
    if (testEntry.userId === testUser.id) {
      console.log('✅ SUCCESS: userId is correctly preserved!');
      console.log(`   Expected: ${testUser.id}`);
      console.log(`   Actual: ${testEntry.userId}`);
    } else {
      console.log('❌ FAILURE: userId is not preserved correctly!');
      console.log(`   Expected: ${testUser.id}`);
      console.log(`   Actual: ${testEntry.userId}`);
      throw new Error('userId preservation test failed');
    }
    console.log('');
    
    console.log('📋 Step 4: Retrieving entry to double-check...');
    
    // Retrieve the entry to double-check
    const retrievedEntry = await vocabEntryDAL.findById(testEntry.id);
    
    if (retrievedEntry && retrievedEntry.userId === testUser.id) {
      console.log('✅ SUCCESS: Retrieved entry has correct userId!');
      console.log(`   Retrieved userId: ${retrievedEntry.userId}`);
    } else {
      console.log('❌ FAILURE: Retrieved entry has incorrect userId!');
      console.log(`   Expected: ${testUser.id}`);
      console.log(`   Retrieved userId: ${retrievedEntry?.userId || 'null'}`);
      throw new Error('Retrieved entry userId test failed');
    }
    console.log('');
    
    console.log('📋 Step 5: Testing user-specific entry retrieval...');
    
    // Test finding entries by user ID
    const userEntries = await vocabEntryDAL.findByUserId(testUser.id);
    
    if (userEntries.length > 0 && userEntries[0].userId === testUser.id) {
      console.log('✅ SUCCESS: User-specific entry retrieval works!');
      console.log(`   Found ${userEntries.length} entries for user`);
      console.log(`   First entry userId: ${userEntries[0].userId}`);
    } else {
      console.log('❌ FAILURE: User-specific entry retrieval failed!');
      console.log(`   Found ${userEntries.length} entries`);
      if (userEntries.length > 0) {
        console.log(`   First entry userId: ${userEntries[0].userId}`);
      }
      throw new Error('User-specific entry retrieval test failed');
    }
    console.log('');
    
    console.log('🧹 Cleanup: Deleting test data...');
    
    // Cleanup
    await vocabEntryDAL.delete(testEntry.id);
    await userDAL.delete(testUser.id);
    
    console.log('✅ Test data cleaned up successfully');
    console.log('');
    
    console.log('🎉 ALL TESTS PASSED! 🎉');
    console.log('========================');
    console.log('✅ userId is correctly preserved in VocabEntry creation');
    console.log('✅ camelCase column names are working properly');
    console.log('✅ Database schema and DAL are properly synchronized');
    console.log('✅ The undefined userId issue has been FIXED!');
    
  } catch (error) {
    console.error('❌ TEST FAILED:', error.message);
    console.error('Stack trace:', error.stack);
    
    if (error.code) {
      console.error('Error code:', error.code);
    }
    
    process.exit(1);
  }
}

// Run the test
testUserIdFix();
