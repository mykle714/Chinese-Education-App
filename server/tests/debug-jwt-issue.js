// Debug JWT authentication issue
// Run with: node server/tests/debug-jwt-issue.js

import jwt from 'jsonwebtoken';

const JWT_SECRET = process.env.JWT_SECRET;

function debugJWTIssue() {
  console.log('🔍 Debugging JWT Authentication Issue...\n');

  // Test 1: Check if we can create and verify a valid token
  console.log('1. Testing JWT token creation and verification...');
  
  try {
    const testPayload = {
      userId: 'test-user-id',
      email: 'test@example.com'
    };
    
    const token = jwt.sign(testPayload, JWT_SECRET, { expiresIn: '24h' });
    console.log('✅ Token created successfully');
    console.log(`   Token: ${token}`);
    console.log(`   Length: ${token.length} characters`);
    
    // Verify the token
    const decoded = jwt.verify(token, JWT_SECRET);
    console.log('✅ Token verification successful');
    console.log('   Decoded payload:', decoded);
    
  } catch (error) {
    console.error('❌ JWT creation/verification failed:', error);
  }

  // Test 2: Check common malformed token scenarios
  console.log('\n2. Testing malformed token scenarios...');
  
  const malformedTokens = [
    '',                    // Empty string
    'undefined',           // String "undefined"
    'null',               // String "null"
    'Bearer ',            // Bearer with no token
    'malformed.token',    // Invalid format
    'eyJ.invalid',        // Partial token
    'not-a-jwt-at-all'    // Random string
  ];
  
  malformedTokens.forEach((badToken, index) => {
    try {
      console.log(`   Testing malformed token ${index + 1}: "${badToken}"`);
      jwt.verify(badToken, JWT_SECRET);
      console.log('   ⚠️  Unexpectedly succeeded');
    } catch (error) {
      console.log(`   ✅ Correctly failed: ${error.name} - ${error.message}`);
    }
  });

  // Test 3: Check environment variables
  console.log('\n3. Checking environment...');
  console.log(`   JWT_SECRET: ${JWT_SECRET ? 'Set' : 'Not set'}`);
  console.log(`   NODE_ENV: ${process.env.NODE_ENV || 'Not set'}`);
  
  // Test 4: Simulate cookie parsing
  console.log('\n4. Testing cookie parsing simulation...');
  
  const mockCookieStrings = [
    'token=eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJ1c2VySWQiOiJ0ZXN0IiwiZW1haWwiOiJ0ZXN0QGV4YW1wbGUuY29tIiwiaWF0IjoxNjk5OTk5OTk5fQ.invalid',
    'token=',
    'token=undefined',
    'other=value; token=valid-token-here'
  ];
  
  mockCookieStrings.forEach((cookieStr, index) => {
    console.log(`   Cookie string ${index + 1}: "${cookieStr}"`);
    
    // Simple cookie parsing simulation
    const tokenMatch = cookieStr.match(/token=([^;]*)/);
    const extractedToken = tokenMatch ? tokenMatch[1] : null;
    console.log(`   Extracted token: "${extractedToken}"`);
    
    if (extractedToken) {
      try {
        jwt.verify(extractedToken, JWT_SECRET);
        console.log('   ✅ Token is valid');
      } catch (error) {
        console.log(`   ❌ Token invalid: ${error.name} - ${error.message}`);
      }
    }
  });
}

// Run the debug
debugJWTIssue();
console.log('\n🎉 JWT debug completed');
