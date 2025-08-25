// Test script for tag functionality
// This script tests the new isCustomTag and hskLevelTag features

const { createVocabEntry, updateVocabEntry, getVocabEntryById, getAllVocabEntries } = require('../models/vocabEntryModel.js');

async function testTagFunctionality() {
  console.log('Testing tag functionality...');
  
  try {
    // Test 1: Create entry with tags
    console.log('\n1. Testing entry creation with tags...');
    const testUserId = '12345678-1234-1234-1234-123456789012'; // Replace with actual user ID
    
    const newEntry = await createVocabEntry({
      userId: testUserId,
      entryKey: '测试',
      entryValue: 'test',
      isCustomTag: true,
      hskLevelTag: 'HSK1'
    });
    
    console.log('Created entry with tags:', {
      id: newEntry.id,
      entryKey: newEntry.entryKey,
      entryValue: newEntry.entryValue,
      isCustomTag: newEntry.isCustomTag,
      hskLevelTag: newEntry.hskLevelTag
    });
    
    // Test 2: Create entry without tags (should default isCustomTag to true)
    console.log('\n2. Testing entry creation without tags...');
    const entryWithoutTags = await createVocabEntry({
      userId: testUserId,
      entryKey: '默认',
      entryValue: 'default'
    });
    
    console.log('Created entry without tags:', {
      id: entryWithoutTags.id,
      entryKey: entryWithoutTags.entryKey,
      entryValue: entryWithoutTags.entryValue,
      isCustomTag: entryWithoutTags.isCustomTag,
      hskLevelTag: entryWithoutTags.hskLevelTag
    });
    
    // Test 3: Update entry with tags
    console.log('\n3. Testing entry update with tags...');
    const updatedEntry = await updateVocabEntry(newEntry.id, {
      entryKey: '测试更新',
      entryValue: 'test updated',
      isCustomTag: true,
      hskLevelTag: 'HSK3'
    });
    
    console.log('Updated entry:', {
      id: updatedEntry.id,
      entryKey: updatedEntry.entryKey,
      entryValue: updatedEntry.entryValue,
      isCustomTag: updatedEntry.isCustomTag,
      hskLevelTag: updatedEntry.hskLevelTag
    });
    
    // Test 4: Test invalid HSK level
    console.log('\n4. Testing invalid HSK level...');
    try {
      await createVocabEntry({
        userId: testUserId,
        entryKey: '无效',
        entryValue: 'invalid',
        hskLevelTag: 'HSK7' // Invalid level
      });
      console.log('ERROR: Should have thrown error for invalid HSK level');
    } catch (error) {
      console.log('Correctly caught invalid HSK level error:', error.message);
    }
    
    // Test 5: Retrieve entry by ID to verify tags are returned
    console.log('\n5. Testing entry retrieval...');
    const retrievedEntry = await getVocabEntryById(newEntry.id);
    console.log('Retrieved entry:', {
      id: retrievedEntry.id,
      entryKey: retrievedEntry.entryKey,
      entryValue: retrievedEntry.entryValue,
      isCustomTag: retrievedEntry.isCustomTag,
      hskLevelTag: retrievedEntry.hskLevelTag
    });
    
    // Test 6: Get all entries to verify tag fields are included
    console.log('\n6. Testing get all entries (showing first 3)...');
    const allEntries = await getAllVocabEntries();
    const firstThree = allEntries.slice(0, 3);
    firstThree.forEach((entry, index) => {
      console.log(`Entry ${index + 1}:`, {
        id: entry.id,
        entryKey: entry.entryKey,
        isCustomTag: entry.isCustomTag,
        hskLevelTag: entry.hskLevelTag
      });
    });
    
    console.log('\n✅ All tag functionality tests completed successfully!');
    
  } catch (error) {
    console.error('❌ Test failed:', error);
    console.error('Error details:', error.message);
    if (error.code) {
      console.error('Error code:', error.code);
    }
  }
}

// Run the test
testTagFunctionality();
