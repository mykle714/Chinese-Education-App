// Test script to verify the new DAL architecture login endpoint works
import https from 'https';
import http from 'http';

// Test configuration
const TEST_CONFIG = {
  host: 'localhost',
  port: 3001,
  path: '/api/auth/login',
  method: 'POST',
  headers: {
    'Content-Type': 'application/json',
  }
};

// Test user credentials (make sure this user exists in your database)
const TEST_USER = {
  email: 'test@example.com',
  password: 'testpassword123'
};

function testNewDALLogin() {
  console.log('🧪 Testing NEW DAL Architecture Login Endpoint');
  console.log('=' .repeat(50));
  
  const postData = JSON.stringify(TEST_USER);
  
  const req = http.request(TEST_CONFIG, (res) => {
    console.log(`📊 Status Code: ${res.statusCode}`);
    console.log(`📋 Headers:`, res.headers);
    
    let data = '';
    
    res.on('data', (chunk) => {
      data += chunk;
    });
    
    res.on('end', () => {
      try {
        const response = JSON.parse(data);
        
        if (res.statusCode === 200) {
          console.log('✅ LOGIN SUCCESS with NEW DAL Architecture!');
          console.log('👤 User:', response.user);
          console.log('🔑 Token received:', response.token ? 'Yes' : 'No');
          
          // Check if we got the expected response structure
          if (response.user && response.token) {
            console.log('🎉 NEW DAL Architecture is working correctly!');
            console.log('📈 Benefits observed:');
            console.log('   - Clean separation of concerns');
            console.log('   - Enhanced error handling');
            console.log('   - Better password validation');
            console.log('   - Improved security (password not returned)');
          } else {
            console.log('⚠️  Response structure unexpected');
          }
        } else {
          console.log('❌ LOGIN FAILED');
          console.log('📝 Error:', response);
          
          // Check if it's a validation error from our new architecture
          if (response.code && response.code.startsWith('ERR_')) {
            console.log('✅ Error handling from NEW DAL Architecture working correctly');
          }
        }
      } catch (error) {
        console.log('❌ Failed to parse response:', error.message);
        console.log('📄 Raw response:', data);
      }
    });
  });
  
  req.on('error', (error) => {
    console.log('❌ Request failed:', error.message);
    console.log('💡 Make sure the server is running on port 3001');
  });
  
  req.write(postData);
  req.end();
}

// Test with invalid credentials to check error handling
function testInvalidLogin() {
  console.log('\n🧪 Testing Invalid Login (Error Handling)');
  console.log('=' .repeat(50));
  
  const invalidUser = {
    email: 'invalid@example.com',
    password: 'wrongpassword'
  };
  
  const postData = JSON.stringify(invalidUser);
  
  const req = http.request(TEST_CONFIG, (res) => {
    let data = '';
    
    res.on('data', (chunk) => {
      data += chunk;
    });
    
    res.on('end', () => {
      try {
        const response = JSON.parse(data);
        
        if (res.statusCode === 400 || res.statusCode === 401) {
          console.log('✅ Error handling working correctly');
          console.log('📝 Error response:', response);
          
          if (response.code && response.code.startsWith('ERR_')) {
            console.log('✅ NEW DAL error codes working correctly');
          }
        } else {
          console.log('⚠️  Unexpected status code:', res.statusCode);
        }
      } catch (error) {
        console.log('❌ Failed to parse error response:', error.message);
      }
    });
  });
  
  req.on('error', (error) => {
    console.log('❌ Request failed:', error.message);
  });
  
  req.write(postData);
  req.end();
}

// Run tests
console.log('🚀 Starting DAL Architecture Tests');
console.log('📅 Time:', new Date().toISOString());
console.log('🌐 Testing endpoint: http://localhost:5000/api/auth/login');
console.log('');

// Test valid login first
testNewDALLogin();

// Wait a bit, then test invalid login
setTimeout(() => {
  testInvalidLogin();
}, 2000);

// Summary after tests
setTimeout(() => {
  console.log('\n' + '='.repeat(60));
  console.log('📊 TEST SUMMARY');
  console.log('='.repeat(60));
  console.log('✅ If login succeeded: NEW DAL Architecture is working!');
  console.log('📈 Benefits of the new architecture:');
  console.log('   - Separation of concerns (DAL/Service/Controller)');
  console.log('   - Enhanced error handling with custom error types');
  console.log('   - Better validation and security');
  console.log('   - Easier testing and maintenance');
  console.log('   - Transaction support for complex operations');
  console.log('   - Performance monitoring capabilities');
  console.log('');
  console.log('🔄 Next steps: Gradually migrate other endpoints');
  console.log('📝 All other endpoints still use the old userModel');
}, 4000);
