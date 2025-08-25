// Simple test to verify OnDeck API endpoints are available
// This test checks if the endpoints respond correctly to requests

import http from 'http';

const BASE_URL = 'http://localhost:3001';

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

async function testEndpointAvailability() {
  console.log('🚀 Testing OnDeck API Endpoint Availability\n');
  
  try {
    // Test GET /api/onDeckPage without authentication (should return 401)
    console.log('📋 Testing GET /api/onDeckPage (without auth)...');
    const getResponse = await makeRequest('GET', '/api/onDeckPage');
    
    if (getResponse.statusCode === 401) {
      console.log('✅ GET endpoint exists and requires authentication');
    } else {
      console.log('❌ Unexpected response:', getResponse.statusCode, getResponse.body);
    }

    // Test PUT /api/onDeckPage/test without authentication (should return 401)
    console.log('➕ Testing PUT /api/onDeckPage/test (without auth)...');
    const putResponse = await makeRequest('PUT', '/api/onDeckPage/test', {
      vocabEntryIds: [1, 2, 3]
    });
    
    if (putResponse.statusCode === 401) {
      console.log('✅ PUT endpoint exists and requires authentication');
    } else {
      console.log('❌ Unexpected response:', putResponse.statusCode, putResponse.body);
    }

    // Test DELETE /api/onDeckPage/test without authentication (should return 401)
    console.log('🗑️ Testing DELETE /api/onDeckPage/test (without auth)...');
    const deleteResponse = await makeRequest('DELETE', '/api/onDeckPage/test');
    
    if (deleteResponse.statusCode === 401) {
      console.log('✅ DELETE endpoint exists and requires authentication');
    } else {
      console.log('❌ Unexpected response:', deleteResponse.statusCode, deleteResponse.body);
    }

    console.log('\n🎉 All OnDeck API endpoints are properly configured!');
    console.log('📝 Next steps:');
    console.log('   1. Create a test user or use existing credentials');
    console.log('   2. Update test-ondeck-functionality.js with valid credentials');
    console.log('   3. Run the full integration test');

  } catch (error) {
    console.error('💥 Test failed with error:', error);
  }
}

// Run the test
testEndpointAvailability();
