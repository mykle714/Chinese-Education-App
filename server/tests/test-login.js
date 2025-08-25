// Script to test the login functionality
import fetch from 'node-fetch';
import dotenv from 'dotenv';

// Load environment variables
dotenv.config();

const API_BASE_URL = 'http://localhost:3001';

async function testLogin() {
  try {
    // Test credentials
    const testUsers = [
      { email: 'test@example.com', password: 'pw' },
      { email: 'default@example.com', password: 'password' }
    ];
    
    console.log('Testing login functionality...\n');
    
    for (const user of testUsers) {
      console.log(`Attempting to login with email: ${user.email}`);
      
      try {
        const response = await fetch(`${API_BASE_URL}/api/auth/login`, {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json'
          },
          body: JSON.stringify({
            email: user.email,
            password: user.password
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
      
      console.log('-----------------------------------');
    }
    
  } catch (err) {
    console.error('Error testing login:', err);
  }
}

// Run the function
testLogin();
