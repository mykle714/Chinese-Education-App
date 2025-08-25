// Test script for OnDeck Vocab Sets functionality
// This script tests the basic CRUD operations for the OnDeck feature

import https from 'https';
import http from 'http';

// Configuration
const BASE_URL = 'http://localhost:3001';
const TEST_USER_EMAIL = 'test@example.com';
const TEST_USER_PASSWORD = 'testpassword123';

// Test data
const TEST_FEATURE_NAME = 'test-flashcards';
const TEST_VOCAB_ENTRY_IDS = [1, 2, 3]; // These should be valid vocab entry IDs for the test user

let authToken = '';

// Helper function to make HTTP requests
function makeRequest(method, path, data = null, token = null) {
  return new Promise((resolve, reject) => {
    const url = new URL(BASE_URL + path);
    const options = {
      hostname: url.hostname,
      port: url.port,
      path: url.pathname + url.search,
      method: method,
      headers: {
        'Content-Type': 'application/json',
      }
    };

    if (token) {
      options.headers['Authorization'] = `Bearer ${token}`;
    }

    const req = http.request(options, (res) => {
      let body = '';
      res.on('data', (chunk) => {
        body += chunk;
      });
      res.on('end', () => {
        try {
          const jsonBody = body ? JSON.parse(body) : {};
          resolve({
            statusCode: res.statusCode,
            headers: res.headers,
            body: jsonBody
          });
        } catch (e) {
          resolve({
            statusCode: res.statusCode,
            headers: res.headers,
            body: body
          });
        }
      });
    });

    req.on('error', (err) => {
      reject(err);
    });

    if (data) {
      req.write(JSON.stringify(data));
    }

    req.end();
  });
}

// Test functions
async function testLogin() {
  console.log('🔐 Testing login...');
  
  const response = await makeRequest('POST', '/api/auth/login', {
    email: TEST_USER_EMAIL,
    password: TEST_USER_PASSWORD
  });

  if (response.statusCode === 200 && response.body.token) {
    authToken = response.body.token;
    console.log('✅ Login successful');
    return true;
  } else {
    console.log('❌ Login failed:', response.body);
    return false;
  }
}

async function testGetAllOnDeckSets() {
  console.log('📋 Testing GET all on-deck sets...');
  
  const response = await makeRequest('GET', '/api/onDeckPage', null, authToken);

  if (response.statusCode === 200) {
    console.log('✅ GET all on-deck sets successful');
    console.log('📊 Found', response.body.length, 'on-deck sets');
    return response.body;
  } else {
    console.log('❌ GET all on-deck sets failed:', response.body);
    return null;
  }
}

async function testCreateOnDeckSet() {
  console.log('➕ Testing PUT (create) on-deck set...');
  
  const response = await makeRequest('PUT', `/api/onDeckPage/${TEST_FEATURE_NAME}`, {
    vocabEntryIds: TEST_VOCAB_ENTRY_IDS
  }, authToken);

  if (response.statusCode === 200) {
    console.log('✅ PUT (create) on-deck set successful');
    console.log('📝 Created set:', response.body);
    return response.body;
  } else {
    console.log('❌ PUT (create) on-deck set failed:', response.body);
    return null;
  }
}

async function testUpdateOnDeckSet() {
  console.log('✏️ Testing PUT (update) on-deck set...');
  
  const updatedIds = [4, 5, 6]; // Different IDs for update test
  const response = await makeRequest('PUT', `/api/onDeckPage/${TEST_FEATURE_NAME}`, {
    vocabEntryIds: updatedIds
  }, authToken);

  if (response.statusCode === 200) {
    console.log('✅ PUT (update) on-deck set successful');
    console.log('📝 Updated set:', response.body);
    return response.body;
  } else {
    console.log('❌ PUT (update) on-deck set failed:', response.body);
    return null;
  }
}

async function testDeleteOnDeckSet() {
  console.log('🗑️ Testing DELETE on-deck set...');
  
  const response = await makeRequest('DELETE', `/api/onDeckPage/${TEST_FEATURE_NAME}`, null, authToken);

  if (response.statusCode === 204) {
    console.log('✅ DELETE on-deck set successful');
    return true;
  } else {
    console.log('❌ DELETE on-deck set failed:', response.body);
    return false;
  }
}

async function testValidation() {
  console.log('🔍 Testing validation...');
  
  // Test with empty array
  console.log('  Testing empty array...');
  const emptyResponse = await makeRequest('PUT', `/api/onDeckPage/test-empty`, {
    vocabEntryIds: []
  }, authToken);
  
  if (emptyResponse.statusCode === 200) {
    console.log('  ✅ Empty array accepted');
  } else {
    console.log('  ❌ Empty array rejected:', emptyResponse.body);
  }

  // Test with too many IDs (over 30)
  console.log('  Testing array with 31 items (should fail)...');
  const tooManyIds = Array.from({length: 31}, (_, i) => i + 1);
  const tooManyResponse = await makeRequest('PUT', `/api/onDeckPage/test-too-many`, {
    vocabEntryIds: tooManyIds
  }, authToken);
  
  if (tooManyResponse.statusCode === 400) {
    console.log('  ✅ Too many IDs correctly rejected');
  } else {
    console.log('  ❌ Too many IDs should have been rejected:', tooManyResponse.body);
  }

  // Test with invalid data type
  console.log('  Testing invalid data type...');
  const invalidResponse = await makeRequest('PUT', `/api/onDeckPage/test-invalid`, {
    vocabEntryIds: "not an array"
  }, authToken);
  
  if (invalidResponse.statusCode === 400) {
    console.log('  ✅ Invalid data type correctly rejected');
  } else {
    console.log('  ❌ Invalid data type should have been rejected:', invalidResponse.body);
  }
}

// Main test runner
async function runTests() {
  console.log('🚀 Starting OnDeck Vocab Sets API Tests\n');
  
  try {
    // Step 1: Login
    const loginSuccess = await testLogin();
    if (!loginSuccess) {
      console.log('❌ Cannot proceed without authentication');
      return;
    }
    console.log('');

    // Step 2: Get initial state
    await testGetAllOnDeckSets();
    console.log('');

    // Step 3: Create a new on-deck set
    await testCreateOnDeckSet();
    console.log('');

    // Step 4: Update the on-deck set
    await testUpdateOnDeckSet();
    console.log('');

    // Step 5: Get all sets again to verify
    await testGetAllOnDeckSets();
    console.log('');

    // Step 6: Test validation
    await testValidation();
    console.log('');

    // Step 7: Clean up - delete the test set
    await testDeleteOnDeckSet();
    console.log('');

    // Step 8: Verify deletion
    await testGetAllOnDeckSets();
    console.log('');

    console.log('🎉 All tests completed!');

  } catch (error) {
    console.error('💥 Test failed with error:', error);
  }
}

// Run the tests
runTests();
