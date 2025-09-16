// Test get current user with new DAL architecture
// Run with: node server/tests/test-get-current-user.js

import { userController } from '../dist/dal/setup.js';

// Mock request and response objects for testing
function createMockReq(user = null, body = {}) {
  return {
    user,
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

async function testGetCurrentUser() {
  console.log('🔍 Testing Get Current User with NEW DAL Architecture...\n');

  try {
    // Test with authenticated user (using the test user we know exists)
    const mockUser = {
      userId: 'FE66022C-C841-F011-A5F1-7C1E52096DE5', // Test user ID from previous tests
      email: 'accounts@test.com'
    };

    console.log('1. Testing get current user with authenticated user...');
    console.log(`   User ID: ${mockUser.userId}`);

    const req = createMockReq(mockUser);
    const res = createMockRes();

    await userController.getCurrentUser(req, res);

    if (res.statusCode === 200) {
      console.log('✅ Get current user successful!');
      console.log('🎉 NEW DAL Architecture working for get current user!');
      
      // Verify the response structure
      if (res.data && res.data.id && res.data.email && res.data.name) {
        console.log('✅ Response structure is correct');
        console.log(`   User ID: ${res.data.id}`);
        console.log(`   Email: ${res.data.email}`);
        console.log(`   Name: ${res.data.name}`);
        console.log(`   Created: ${res.data.createdAt}`);
        
        // Verify password is not returned
        if (!res.data.password) {
          console.log('✅ Password correctly excluded from response');
        } else {
          console.log('⚠️  Warning: Password included in response (security issue)');
        }
      } else {
        console.log('⚠️  Warning: Response structure may be incomplete');
      }
    } else {
      console.log(`❌ Get current user failed with status ${res.statusCode}`);
      console.log('Response data:', res.data);
    }

    // Test with unauthenticated user (no user object)
    console.log('\n2. Testing get current user without authentication...');
    const reqUnauth = createMockReq(null);
    const resUnauth = createMockRes();

    await userController.getCurrentUser(reqUnauth, resUnauth);

    if (resUnauth.statusCode === 401) {
      console.log('✅ Correctly rejected unauthenticated request');
    } else {
      console.log(`⚠️  Expected 401 but got ${resUnauth.statusCode}`);
    }

  } catch (error) {
    console.error('❌ Test failed:', error);
    console.error('Stack trace:', error.stack);
  }
}

// Run the test
testGetCurrentUser().then(() => {
  console.log('\n🎉 Get current user test completed');
  process.exit(0);
}).catch(error => {
  console.error('💥 Test execution failed:', error);
  process.exit(1);
});
