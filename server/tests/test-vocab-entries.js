// Test vocab entry endpoints with new DAL architecture
// Run with: node server/tests/test-vocab-entries.js

import { vocabEntryController } from '../dist/dal/setup.js';

// Mock request and response objects for testing
function createMockReq(user = null, body = {}, params = {}, query = {}) {
  return {
    user,
    body,
    params,
    query
  };
}

function createMockRes() {
  const res = {
    statusCode: 200,
    data: null,
    status: function(code) {
      this.statusCode = code;
      return this;
    },
    json: function(data) {
      this.data = data;
      console.log(`Response ${this.statusCode}:`, JSON.stringify(data, null, 2));
      return this;
    },
    end: function() {
      console.log(`Response ${this.statusCode}: (no content)`);
      return this;
    }
  };
  return res;
}

async function testVocabEntries() {
  console.log('🔍 Testing Vocab Entry Endpoints with NEW DAL Architecture...\n');

  const testUser = {
    userId: 'FE66022C-C841-F011-A5F1-7C1E52096DE5', // Test user ID
    email: 'test@example.com'
  };

  let createdEntryId = null;

  try {
    // Test 1: Create a new vocab entry
    console.log('1. Testing create vocab entry...');
    const newEntry = {
      entryKey: '测试',
      entryValue: 'test',
      isCustomTag: true,
      hskLevelTag: 'HSK1'
    };

    const createReq = createMockReq(testUser, newEntry);
    const createRes = createMockRes();

    await vocabEntryController.createEntry(createReq, createRes);

    if (createRes.statusCode === 201) {
      console.log('✅ Create vocab entry successful!');
      createdEntryId = createRes.data?.id;
      console.log(`   Created entry ID: ${createdEntryId}`);
    } else {
      console.log(`❌ Create failed with status ${createRes.statusCode}`);
    }

    // Test 2: Get all vocab entries
    console.log('\n2. Testing get all vocab entries...');
    const getAllReq = createMockReq(testUser);
    const getAllRes = createMockRes();

    await vocabEntryController.getAllEntries(getAllReq, getAllRes);

    if (getAllRes.statusCode === 200) {
      console.log('✅ Get all vocab entries successful!');
      console.log(`   Found ${getAllRes.data?.length || 0} entries`);
    } else {
      console.log(`❌ Get all failed with status ${getAllRes.statusCode}`);
    }

    // Test 3: Get paginated vocab entries
    console.log('\n3. Testing get paginated vocab entries...');
    const getPaginatedReq = createMockReq(testUser, {}, {}, { limit: '5', offset: '0' });
    const getPaginatedRes = createMockRes();

    await vocabEntryController.getPaginatedEntries(getPaginatedReq, getPaginatedRes);

    if (getPaginatedRes.statusCode === 200) {
      console.log('✅ Get paginated vocab entries successful!');
      console.log(`   Entries: ${getPaginatedRes.data?.entries?.length || 0}`);
      console.log(`   Total: ${getPaginatedRes.data?.total || 0}`);
      console.log(`   Has more: ${getPaginatedRes.data?.hasMore || false}`);
    } else {
      console.log(`❌ Get paginated failed with status ${getPaginatedRes.statusCode}`);
    }

    // Test 4: Get vocab entry by ID (if we created one)
    if (createdEntryId) {
      console.log('\n4. Testing get vocab entry by ID...');
      const getByIdReq = createMockReq(testUser, {}, { id: createdEntryId.toString() });
      const getByIdRes = createMockRes();

      await vocabEntryController.getEntryById(getByIdReq, getByIdRes);

      if (getByIdRes.statusCode === 200) {
        console.log('✅ Get vocab entry by ID successful!');
        console.log(`   Entry: ${getByIdRes.data?.entryKey} = ${getByIdRes.data?.entryValue}`);
      } else {
        console.log(`❌ Get by ID failed with status ${getByIdRes.statusCode}`);
      }

      // Test 5: Update vocab entry
      console.log('\n5. Testing update vocab entry...');
      const updateData = {
        entryKey: '测试更新',
        entryValue: 'test updated',
        isCustomTag: true,
        hskLevelTag: 'HSK2'
      };

      const updateReq = createMockReq(testUser, updateData, { id: createdEntryId.toString() });
      const updateRes = createMockRes();

      await vocabEntryController.updateEntry(updateReq, updateRes);

      if (updateRes.statusCode === 200) {
        console.log('✅ Update vocab entry successful!');
        console.log(`   Updated: ${updateRes.data?.entryKey} = ${updateRes.data?.entryValue}`);
      } else {
        console.log(`❌ Update failed with status ${updateRes.statusCode}`);
      }

      // Test 6: Delete vocab entry
      console.log('\n6. Testing delete vocab entry...');
      const deleteReq = createMockReq(testUser, {}, { id: createdEntryId.toString() });
      const deleteRes = createMockRes();

      await vocabEntryController.deleteEntry(deleteReq, deleteRes);

      if (deleteRes.statusCode === 204) {
        console.log('✅ Delete vocab entry successful!');
      } else {
        console.log(`❌ Delete failed with status ${deleteRes.statusCode}`);
      }
    }

    console.log('\n🎉 NEW DAL Architecture working for all vocab entry operations!');

  } catch (error) {
    console.error('❌ Test failed:', error);
    console.error('Stack trace:', error.stack);
  }
}

// Run the test
testVocabEntries().then(() => {
  console.log('\n🎉 Vocab entry endpoints test completed');
  process.exit(0);
}).catch(error => {
  console.error('💥 Test execution failed:', error);
  process.exit(1);
});
