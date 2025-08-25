// Test script for the change password API endpoint
import fetch from 'node-fetch';

// Configuration
const API_URL = 'http://localhost:3001';
const TEST_USER = {
  email: 'test@example.com',
  password: 'Password123'
};

// Test the change password functionality
async function testChangePassword() {
  console.log('Testing change password functionality...\n');
  
  try {
    // Step 1: Login to get a token
    console.log(`Attempting to login with email: ${TEST_USER.email}`);
    const loginResponse = await fetch(`${API_URL}/api/auth/login`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json'
      },
      body: JSON.stringify({
        email: TEST_USER.email,
        password: TEST_USER.password
      })
    });
    
    const loginData = await loginResponse.json();
    
    if (!loginResponse.ok) {
      console.error(`❌ Login failed: ${loginData.error}`);
      return;
    }
    
    console.log(`✅ Login successful!`);
    console.log(`   User: ${loginData.user.name} (${loginData.user.email})`);
    console.log(`   Token received: ${loginData.token.substring(0, 20)}...`);
    
    const token = loginData.token;
    const userId = loginData.user.id;
    
    // Step 2: Change the password
    console.log('\nAttempting to change password...');
    const newPassword = 'NewPassword123';
    
    const changePasswordResponse = await fetch(`${API_URL}/api/auth/change-password`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${token}`
      },
      body: JSON.stringify({
        currentPassword: TEST_USER.password,
        newPassword: newPassword
      })
    });
    
    const changePasswordData = await changePasswordResponse.json();
    
    if (!changePasswordResponse.ok) {
      console.error(`❌ Password change failed: ${changePasswordData.error}`);
      return;
    }
    
    console.log(`✅ Password changed successfully!`);
    console.log(`   Message: ${changePasswordData.message}`);
    
    // Step 3: Try to login with the new password
    console.log('\nAttempting to login with the new password...');
    const newLoginResponse = await fetch(`${API_URL}/api/auth/login`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json'
      },
      body: JSON.stringify({
        email: TEST_USER.email,
        password: newPassword
      })
    });
    
    const newLoginData = await newLoginResponse.json();
    
    if (!newLoginResponse.ok) {
      console.error(`❌ Login with new password failed: ${newLoginData.error}`);
      return;
    }
    
    console.log(`✅ Login with new password successful!`);
    console.log(`   User: ${newLoginData.user.name} (${newLoginData.user.email})`);
    
    // Step 4: Change the password back to the original
    console.log('\nChanging password back to the original...');
    const revertPasswordResponse = await fetch(`${API_URL}/api/auth/change-password`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${newLoginData.token}`
      },
      body: JSON.stringify({
        currentPassword: newPassword,
        newPassword: TEST_USER.password
      })
    });
    
    const revertPasswordData = await revertPasswordResponse.json();
    
    if (!revertPasswordResponse.ok) {
      console.error(`❌ Reverting password failed: ${revertPasswordData.error}`);
      return;
    }
    
    console.log(`✅ Password reverted successfully!`);
    console.log(`   Message: ${revertPasswordData.message}`);
    
  } catch (error) {
    console.error('Error during test:', error);
  }
}

// Run the test
testChangePassword();
