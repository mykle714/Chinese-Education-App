// Test script for OnDeck DAL architecture
// Run with: node server/tests/test-ondeck-dal.js

import { onDeckVocabController } from '../dal/setup.js';

// Mock request and response objects for testing
function createMockReq(user, params = {}, body = {}) {
  return {
    user,
    params,
    body
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
    }
  };
  return res;
}

async function testOnDeckDAL() {
  console.log('🧪 Testing OnDeck DAL Architecture...\n');

  // Test user (you may need to use a real user ID from your database)
  const testUser = { userId: 'test-user-id-here' };

  try {
    console.log('1. Testing getAllSets...');
    const req1 = createMockReq(testUser);
    const res1 = createMockRes();
    await onDeckVocabController.getAllSets(req1, res1);
    
    console.log('\n2. Testing createOrUpdateSet...');
    const req2 = createMockReq(
      testUser, 
      { featureName: 'test-feature' }, 
      { vocabEntryIds: [1, 2, 3] }
    );
    const res2 = createMockRes();
    await onDeckVocabController.createOrUpdateSet(req2, res2);
    
    console.log('\n3. Testing getSetByFeatureName...');
    const req3 = createMockReq(testUser, { featureName: 'test-feature' });
    const res3 = createMockRes();
    await onDeckVocabController.getSetByFeatureName(req3, res3);
    
    console.log('\n4. Testing getUserStats...');
    const req4 = createMockReq(testUser);
    const res4 = createMockRes();
    await onDeckVocabController.getUserStats(req4, res4);
    
    console.log('\n5. Testing getFeatureNames...');
    const req5 = createMockReq(testUser);
    const res5 = createMockRes();
    await onDeckVocabController.getFeatureNames(req5, res5);
    
    console.log('\n✅ OnDeck DAL architecture test completed successfully!');
    
  } catch (error) {
    console.error('❌ OnDeck DAL test failed:', error);
    console.error('Stack trace:', error.stack);
  }
}

// Run the test
testOnDeckDAL().then(() => {
  console.log('\n🎉 Test execution finished');
  process.exit(0);
}).catch(error => {
  console.error('💥 Test execution failed:', error);
  process.exit(1);
});
