// Test script to verify the reader vocabulary test account was created automatically
import fetch from 'node-fetch';
import dotenv from 'dotenv';

// Load environment variables
dotenv.config();

const API_BASE_URL = 'http://localhost:5000';

async function testReaderVocabAccount() {
  try {
    console.log('Testing Reader Vocabulary Test Account...\n');
    
    // Test credentials for the reader vocab account
    const testUser = {
      email: 'reader-vocab-test@example.com',
      password: 'TestPassword123!'
    };
    
    console.log(`Attempting to login with: ${testUser.email}`);
    
    // Step 1: Test login
    const loginResponse = await fetch(`${API_BASE_URL}/api/auth/login`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json'
      },
      body: JSON.stringify({
        email: testUser.email,
        password: testUser.password
      })
    });
    
    const loginData = await loginResponse.json();
    
    if (!loginResponse.ok) {
      console.log(`❌ Login failed: ${loginData.error}`);
      console.log('This suggests the automatic account creation did not work.');
      return;
    }
    
    console.log('✅ Login successful!');
    console.log(`   User: ${loginData.user.name} (${loginData.user.email})`);
    
    const authToken = loginData.token;
    
    // Step 2: Check vocabulary entries
    console.log('\nChecking vocabulary entries...');
    
    const entriesResponse = await fetch(`${API_BASE_URL}/api/vocabEntries`, {
      method: 'GET',
      headers: {
        'Authorization': `Bearer ${authToken}`,
        'Content-Type': 'application/json'
      }
    });
    
    if (!entriesResponse.ok) {
      console.log('❌ Failed to fetch vocabulary entries');
      return;
    }
    
    const entries = await entriesResponse.json();
    
    console.log(`✅ Found ${entries.length} vocabulary entries`);
    
    // Step 3: Verify specific reader vocabulary
    const expectedWords = ['今天', '咖啡店', '春节', '太极拳', '市中心'];
    const foundWords = entries.filter(entry => 
      expectedWords.includes(entry.entrykey || entry.entryKey)
    );
    
    console.log('\nVerifying reader vocabulary words:');
    expectedWords.forEach(word => {
      const found = entries.find(entry => 
        (entry.entrykey || entry.entryKey) === word
      );
      if (found) {
        const value = found.entryvalue || found.entryValue;
        console.log(`✅ ${word} → ${value}`);
      } else {
        console.log(`❌ ${word} → NOT FOUND`);
      }
    });
    
    // Step 4: Summary
    console.log('\n=== AUTOMATIC ACCOUNT CREATION TEST RESULTS ===');
    console.log(`Account Login: ${loginResponse.ok ? '✅ SUCCESS' : '❌ FAILED'}`);
    console.log(`Vocabulary Count: ${entries.length} entries`);
    console.log(`Expected Reader Words Found: ${foundWords.length}/${expectedWords.length}`);
    
    if (loginResponse.ok && entries.length >= 100 && foundWords.length === expectedWords.length) {
      console.log('🎉 AUTOMATIC ACCOUNT CREATION WORKING PERFECTLY!');
      console.log('The reader vocabulary test account is automatically created on Docker startup.');
    } else {
      console.log('⚠️  Some issues detected with automatic account creation.');
    }
    
    console.log('\n=== USAGE INSTRUCTIONS ===');
    console.log('To use this account:');
    console.log('1. Navigate to the application in your browser');
    console.log(`2. Login with: ${testUser.email}`);
    console.log(`3. Password: ${testUser.password}`);
    console.log('4. Explore vocabulary from all three reader texts!');
    
  } catch (error) {
    console.error('❌ Error testing reader vocab account:', error.message);
    console.log('This might indicate the containers are still starting up.');
    console.log('Try running this test again in a few moments.');
  }
}

// Run the test
testReaderVocabAccount();
