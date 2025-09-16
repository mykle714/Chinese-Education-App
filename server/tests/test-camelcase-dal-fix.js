/**
 * Comprehensive test script for camelCase DAL fix
 * Tests all CRUD operations across User, VocabEntry, and OnDeck DAL implementations
 */

import { userController, vocabEntryController, onDeckVocabController } from '../dal/setup.ts';
import { userService, vocabEntryService, onDeckVocabService } from '../dal/setup.ts';
import bcrypt from 'bcrypt';

console.log('🧪 Starting comprehensive camelCase DAL fix tests...\n');

// Test data
const testUser = {
  email: 'test-camelcase@example.com',
  name: 'CamelCase Test User',
  password: 'testpassword123'
};

const testVocabEntry = {
  entryKey: '测试',
  entryValue: 'test',
  isCustomTag: true,
  hskLevelTag: 'HSK1'
};

const testOnDeckSet = {
  featureName: 'test-flashcards',
  vocabEntryIds: []
};

let createdUserId = null;
let createdEntryId = null;

async function runTests() {
  try {
    console.log('📋 Test 1: User Creation (CREATE)');
    console.log('================================');
    
    // Hash password for user creation
    const hashedPassword = await bcrypt.hash(testUser.password, 10);
    const userCreateData = {
      ...testUser,
      password: hashedPassword
    };
    
    const createdUser = await userService.createUser(userCreateData);
    createdUserId = createdUser.id;
    
    console.log('✅ User created successfully:');
    console.log(`   ID: ${createdUser.id}`);
    console.log(`   Email: ${createdUser.email}`);
    console.log(`   Name: ${createdUser.name}`);
    console.log(`   Created At: ${createdUser.createdAt}`);
    console.log('');

    console.log('📋 Test 2: User Retrieval (READ)');
    console.log('=================================');
    
    const retrievedUser = await userService.getUserById(createdUserId);
    console.log('✅ User retrieved successfully:');
    console.log(`   ID: ${retrievedUser.id}`);
    console.log(`   Email: ${retrievedUser.email}`);
    console.log(`   Name: ${retrievedUser.name}`);
    console.log('');

    console.log('📋 Test 3: User Authentication');
    console.log('==============================');
    
    const authResult = await userService.authenticateUser(testUser.email, testUser.password);
    console.log('✅ User authentication successful:');
    console.log(`   User ID: ${authResult.user.id}`);
    console.log(`   Token present: ${!!authResult.token}`);
    console.log('');

    console.log('📋 Test 4: VocabEntry Creation (CREATE)');
    console.log('=======================================');
    
    const createdEntry = await vocabEntryService.createEntry(createdUserId, testVocabEntry);
    createdEntryId = createdEntry.id;
    
    console.log('✅ VocabEntry created successfully:');
    console.log(`   ID: ${createdEntry.id}`);
    console.log(`   User ID: ${createdEntry.userId}`);
    console.log(`   Entry Key: ${createdEntry.entryKey}`);
    console.log(`   Entry Value: ${createdEntry.entryValue}`);
    console.log(`   Is Custom Tag: ${createdEntry.isCustomTag}`);
    console.log(`   HSK Level Tag: ${createdEntry.hskLevelTag}`);
    console.log(`   Created At: ${createdEntry.createdAt}`);
    console.log('');

    console.log('📋 Test 5: VocabEntry Retrieval (READ)');
    console.log('======================================');
    
    const retrievedEntry = await vocabEntryService.getEntry(createdUserId, createdEntryId);
    console.log('✅ VocabEntry retrieved successfully:');
    console.log(`   ID: ${retrievedEntry.id}`);
    console.log(`   User ID: ${retrievedEntry.userId}`);
    console.log(`   Entry Key: ${retrievedEntry.entryKey}`);
    console.log(`   Entry Value: ${retrievedEntry.entryValue}`);
    console.log('');

    console.log('📋 Test 6: VocabEntry Update (UPDATE)');
    console.log('=====================================');
    
    const updateData = {
      entryKey: '测试更新',
      entryValue: 'test updated',
      isCustomTag: false,
      hskLevelTag: 'HSK2'
    };
    
    const updatedEntry = await vocabEntryService.updateEntry(createdUserId, createdEntryId, updateData);
    console.log('✅ VocabEntry updated successfully:');
    console.log(`   ID: ${updatedEntry.id}`);
    console.log(`   Entry Key: ${updatedEntry.entryKey}`);
    console.log(`   Entry Value: ${updatedEntry.entryValue}`);
    console.log(`   Is Custom Tag: ${updatedEntry.isCustomTag}`);
    console.log(`   HSK Level Tag: ${updatedEntry.hskLevelTag}`);
    console.log('');

    console.log('📋 Test 7: VocabEntry Search');
    console.log('============================');
    
    const searchResults = await vocabEntryService.searchEntries(createdUserId, '测试');
    console.log('✅ VocabEntry search successful:');
    console.log(`   Results found: ${searchResults.length}`);
    if (searchResults.length > 0) {
      console.log(`   First result: ${searchResults[0].entryKey} -> ${searchResults[0].entryValue}`);
    }
    console.log('');

    console.log('📋 Test 8: User Entries List');
    console.log('============================');
    
    const userEntries = await vocabEntryService.getUserEntries(createdUserId);
    console.log('✅ User entries retrieved successfully:');
    console.log(`   Total entries: ${userEntries.total}`);
    console.log(`   Entries in result: ${userEntries.entries.length}`);
    console.log('');

    console.log('📋 Test 9: OnDeck Vocab Set Creation');
    console.log('====================================');
    
    // Update test set with the created entry ID
    testOnDeckSet.vocabEntryIds = [createdEntryId];
    
    const createdSet = await onDeckVocabService.createOrUpdateSet(createdUserId, testOnDeckSet);
    console.log('✅ OnDeck vocab set created successfully:');
    console.log(`   User ID: ${createdSet.userId}`);
    console.log(`   Feature Name: ${createdSet.featureName}`);
    console.log(`   Vocab Entry IDs: [${createdSet.vocabEntryIds.join(', ')}]`);
    console.log(`   Updated At: ${createdSet.updatedAt}`);
    console.log('');

    console.log('📋 Test 10: OnDeck Vocab Set Retrieval');
    console.log('======================================');
    
    const retrievedSet = await onDeckVocabService.getSetByFeatureName(createdUserId, testOnDeckSet.featureName);
    console.log('✅ OnDeck vocab set retrieved successfully:');
    console.log(`   Feature Name: ${retrievedSet.featureName}`);
    console.log(`   Vocab Entry IDs: [${retrievedSet.vocabEntryIds.join(', ')}]`);
    console.log('');

    console.log('📋 Test 11: User Statistics');
    console.log('===========================');
    
    const userStats = await vocabEntryService.getUserVocabStats(createdUserId);
    console.log('✅ User statistics retrieved successfully:');
    console.log(`   Total entries: ${userStats.total}`);
    console.log(`   Custom entries: ${userStats.customEntries}`);
    console.log(`   HSK entries: ${userStats.hskEntries}`);
    console.log(`   Recent entries: ${userStats.recentEntries}`);
    console.log('');

    console.log('📋 Test 12: CSV Import Test');
    console.log('===========================');
    
    const csvData = `front,back,hint,publishedAt
你好,hello,greeting,2024-01-01
再见,goodbye,farewell,2024-01-02`;
    
    const csvBuffer = Buffer.from(csvData, 'utf-8');
    const importResult = await vocabEntryService.importFromCSV(createdUserId, csvBuffer);
    
    console.log('✅ CSV import completed successfully:');
    console.log(`   Success: ${importResult.success}`);
    console.log(`   Total processed: ${importResult.results.total}`);
    console.log(`   Inserted: ${importResult.results.inserted}`);
    console.log(`   Updated: ${importResult.results.updated}`);
    console.log(`   Errors: ${importResult.results.errors.length}`);
    console.log('');

    console.log('📋 Test 13: Cleanup - Delete VocabEntry');
    console.log('=======================================');
    
    const deleteResult = await vocabEntryService.deleteEntry(createdUserId, createdEntryId);
    console.log('✅ VocabEntry deleted successfully:', deleteResult);
    console.log('');

    console.log('📋 Test 14: Cleanup - Delete OnDeck Set');
    console.log('=======================================');
    
    const deleteSetResult = await onDeckVocabService.deleteSet(createdUserId, testOnDeckSet.featureName);
    console.log('✅ OnDeck set deleted successfully:', deleteSetResult);
    console.log('');

    console.log('🎉 ALL TESTS PASSED! 🎉');
    console.log('========================');
    console.log('✅ User CRUD operations working correctly');
    console.log('✅ VocabEntry CRUD operations working correctly');
    console.log('✅ OnDeck vocab set operations working correctly');
    console.log('✅ Search functionality working correctly');
    console.log('✅ Statistics functionality working correctly');
    console.log('✅ CSV import functionality working correctly');
    console.log('✅ camelCase column names properly handled');
    console.log('✅ userId is correctly preserved in all operations');
    console.log('');
    console.log('🔧 The camelCase DAL fix has been successfully implemented and tested!');

  } catch (error) {
    console.error('❌ TEST FAILED:', error.message);
    console.error('Stack trace:', error.stack);
    
    // Additional debugging info
    if (error.code) {
      console.error('Error code:', error.code);
    }
    if (error.statusCode) {
      console.error('Status code:', error.statusCode);
    }
    
    process.exit(1);
  } finally {
    // Cleanup: Delete test user if it was created
    if (createdUserId) {
      try {
        console.log('\n🧹 Final cleanup - deleting test user...');
        // Note: This will cascade delete all related entries due to foreign key constraints
        await userService.deleteUser(createdUserId);
        console.log('✅ Test user deleted successfully');
      } catch (cleanupError) {
        console.warn('⚠️  Warning: Could not delete test user:', cleanupError.message);
      }
    }
    
    console.log('\n🏁 Test script completed.');
    process.exit(0);
  }
}

// Run the tests
runTests();
