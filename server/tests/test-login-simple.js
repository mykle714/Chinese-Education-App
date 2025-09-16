// Simple login test script
// Run with: node server/tests/test-login-simple.js

import { userController, userService, userDAL } from '../dist/dal/setup.js';

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
    cookies: {},
    status: function(code) {
      this.statusCode = code;
      return this;
    },
    json: function(data) {
      this.data = data;
      console.log(`Response ${this.statusCode}:`, JSON.stringify(data, null, 2));
      return this;
    },
    cookie: function(name, value, options) {
      this.cookies[name] = { value, options };
      console.log(`Cookie set: ${name} = ${value}`);
      return this;
    }
  };
  return res;
}

async function testLogin() {
  console.log('🔍 Testing Login with Real Account...\n');

  try {
    // First, let's test the database connection by trying to find a user by email
    console.log('1. Testing database connection...');
    
    // Try to find a user with a common email pattern
    const testEmails = [
      'test@example.com',
      'admin@example.com', 
      'user@test.com',
      'demo@demo.com'
    ];
    
    let foundUser = null;
    for (const email of testEmails) {
      try {
        console.log(`   Checking for user: ${email}`);
        foundUser = await userDAL.findByEmail(email);
        if (foundUser) {
          console.log(`✅ Found user: ${foundUser.email}`);
          break;
        }
      } catch (error) {
        console.log(`   Error checking ${email}: ${error.message}`);
      }
    }
    
    if (!foundUser) {
      console.log('❌ No test users found. Let\'s create one...');
      
      // Create a test user
      const testUser = {
        email: 'test@example.com',
        name: 'Test User',
        password: 'testpassword123'
      };
      
      try {
        console.log('2. Creating test user...');
        const newUser = await userService.register(testUser);
        console.log('✅ Test user created:', { email: newUser.email, name: newUser.name });
        foundUser = newUser;
      } catch (error) {
        console.log(`❌ Failed to create test user: ${error.message}`);
        console.log(`   Error code: ${error.code || 'No code'}`);
        
        // If user already exists, try to find them
        if (error.message.includes('already exists') || error.code === 'ERR_DUPLICATE') {
          console.log('   User might already exist, trying to find...');
          foundUser = await userDAL.findByEmail(testUser.email);
          if (foundUser) {
            console.log('✅ Found existing user:', { email: foundUser.email, name: foundUser.name });
          }
        } else {
          throw error;
        }
      }
    }
    
    if (foundUser) {
      console.log('\n3. Testing login...');
      
      // Test with known password
      const testPassword = 'testpassword123';
      
      const req = createMockReq({
        email: foundUser.email,
        password: testPassword
      });
      const res = createMockRes();
      
      try {
        await userController.login(req, res);
        
        if (res.statusCode === 200) {
          console.log('✅ Login successful!');
          console.log('🎉 NEW DAL Architecture is working correctly!');
        } else {
          console.log(`❌ Login failed with status ${res.statusCode}`);
          console.log('Response data:', res.data);
        }
      } catch (error) {
        console.log(`❌ Login error: ${error.message}`);
        console.log(`   Error code: ${error.code || 'No code'}`);
        console.log(`   Stack: ${error.stack}`);
        
        // Check if it's a database connection issue
        if (error.message.includes('database') || error.message.includes('connection')) {
          console.log('\n💡 This appears to be a database connection issue.');
          console.log('   Please check:');
          console.log('   - Database server is running');
          console.log('   - Connection string in .env file');
          console.log('   - Network connectivity to Azure SQL Database');
        }
      }
    }
    
  } catch (error) {
    console.error('❌ Test failed:', error);
    console.error('Stack trace:', error.stack);
    
    // Provide specific troubleshooting based on error type
    if (error.message.includes('ECONNREFUSED')) {
      console.log('\n💡 Connection refused - database server might not be running');
    } else if (error.message.includes('Login failed')) {
      console.log('\n💡 Authentication failed - check database credentials');
    } else if (error.message.includes('getaddrinfo ENOTFOUND')) {
      console.log('\n💡 DNS resolution failed - check database server address');
    }
  }
}

// Run the test
testLogin().then(() => {
  console.log('\n🎉 Test completed');
  process.exit(0);
}).catch(error => {
  console.error('💥 Test execution failed:', error);
  process.exit(1);
});
