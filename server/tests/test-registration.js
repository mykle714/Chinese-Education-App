// Test user registration with new DAL architecture
// Run with: node server/tests/test-registration.js

import { userController } from '../dist/dal/setup.js';

// Mock request and response objects for testing
function createMockReq(body = {}) {
  return {
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

async function testRegistration() {
  console.log('🔍 Testing User Registration with NEW DAL Architecture...\n');

  try {
    // Test registration with a unique email
    const timestamp = Date.now();
    const testUser = {
      email: `testuser${timestamp}@example.com`,
      name: 'Test User Registration',
      password: 'testpassword123'
    };

    console.log('1. Testing user registration...');
    console.log(`   Email: ${testUser.email}`);
    console.log(`   Name: ${testUser.name}`);

    const req = createMockReq(testUser);
    const res = createMockRes();

    await userController.register(req, res);

    if (res.statusCode === 201) {
      console.log('✅ Registration successful!');
      console.log('🎉 NEW DAL Architecture working for registration!');
      
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
      console.log(`❌ Registration failed with status ${res.statusCode}`);
      console.log('Response data:', res.data);
    }

  } catch (error) {
    console.error('❌ Test failed:', error);
    console.error('Stack trace:', error.stack);
  }
}

// Run the test
testRegistration().then(() => {
  console.log('\n🎉 Registration test completed');
  process.exit(0);
}).catch(error => {
  console.error('💥 Test execution failed:', error);
  process.exit(1);
});
