// Script to test the login functionality
import fetch from 'node-fetch';
import dotenv from 'dotenv';

// Load environment variables
dotenv.config();

const API_BASE_URL = 'http://localhost:5000';

async function testLogin() {
  try {
    // Test credentials
    const testUser = { email: 'accounts@test.com', password: 'testpass123' };
    
    console.log('Testing login functionality...\n');
    
    console.log(`Attempting to login with email: ${testUser.email}`);
    
    try {
      const response = await fetch(`${API_BASE_URL}/api/auth/login`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json'
        },
        body: JSON.stringify({
          email: testUser.email,
          password: testUser.password
        })
      });
      
      const data = await response.json();
      
      if (response.ok) {
        console.log('✅ Login successful!');
        console.log(`   User: ${data.user.name} (${data.user.email})`);
        console.log(`   Token received: ${data.token.substring(0, 20)}...`);
      } else {
        console.log(`❌ Login failed: ${data.error}`);
        console.log(`   Error code: ${data.code}`);
      }
    } catch (error) {
      console.log(`❌ Error making request: ${error.message}`);
    }
    
  } catch (err) {
    console.error('Error testing login:', err);
  }
}

// Run the function
testLogin();
