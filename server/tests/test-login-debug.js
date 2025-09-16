// Debug script for login issues
// Run with: node server/tests/test-login-debug.js

import { userController, userDAL } from '../dal/setup.js';

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

async function debugLogin() {
  console.log('🔍 Debugging Login Issues...\n');

  try {
    // First, let's check if we can connect to the database
    console.log('1. Testing database connection...');
    const users = await userDAL.findAll();
    console.log(`✅ Database connected. Found ${users.length} users.`);
    
    if (users.length > 0) {
      console.log('📋 Available users:');
      users.forEach((user, index) => {
        console.log(`   ${index + 1}. Email: ${user.email}, Name: ${user.name}`);
      });
      
      // Test login with the first user (you'll need to know their password)
      const firstUser = users[0];
      console.log(`\n2. Testing login with user: ${firstUser.email}`);
      console.log('⚠️  Note: You need to provide the correct password for this user');
      
      // Try with a common test password - you may need to update this
      const testPasswords = ['password', 'test123', 'testpassword', '123456'];
      
      for (const password of testPasswords) {
        console.log(`\n   Trying password: "${password}"`);
        
        const req = createMockReq({
          email: firstUser.email,
          password: password
        });
        const res = createMockRes();
        
        try {
          await userController.login(req, res);
          
          if (res.statusCode === 200) {
            console.log('✅ Login successful!');
            break;
          } else {
            console.log(`❌ Login failed with status ${res.statusCode}`);
          }
        } catch (error) {
          console.log(`❌ Login error: ${error.message}`);
          console.log(`   Error code: ${error.code || 'No code'}`);
          console.log(`   Stack: ${error.stack}`);
        }
      }
    } else {
      console.log('❌ No users found in database. You may need to register a user first.');
      
      // Test user registration
      console.log('\n3. Testing user registration...');
      const testUser = {
        email: 'test@example.com',
        name: 'Test User',
        password: 'testpassword123'
      };
      
      try {
        const newUser = await userDAL.create(testUser);
        console.log('✅ User created successfully:', newUser);
        
        // Now try to login with the new user
        console.log('\n4. Testing login with newly created user...');
        const req = createMockReq({
          email: testUser.email,
          password: testUser.password
        });
        const res = createMockRes();
        
        await userController.login(req, res);
        
        if (res.statusCode === 200) {
          console.log('✅ Login successful with new user!');
        } else {
          console.log(`❌ Login failed with new user. Status: ${res.statusCode}`);
        }
        
      } catch (error) {
        console.log(`❌ User creation failed: ${error.message}`);
        console.log(`   Error code: ${error.code || 'No code'}`);
      }
    }
    
  } catch (error) {
    console.error('❌ Database connection or query failed:', error);
    console.error('Stack trace:', error.stack);
    
    // Check if it's a specific database error
    if (error.message.includes('ECONNREFUSED')) {
      console.log('\n💡 Troubleshooting tips:');
      console.log('   - Make sure your database server is running');
      console.log('   - Check your database connection settings in .env');
      console.log('   - Verify your Azure SQL Database credentials');
    } else if (error.message.includes('Login failed')) {
      console.log('\n💡 Troubleshooting tips:');
      console.log('   - Check your Azure SQL Database credentials');
      console.log('   - Verify the database name and server');
      console.log('   - Check if your IP is whitelisted in Azure');
    }
  }
}

// Run the debug test
debugLogin().then(() => {
  console.log('\n🎉 Debug test completed');
  process.exit(0);
}).catch(error => {
  console.error('💥 Debug test failed:', error);
  process.exit(1);
});
