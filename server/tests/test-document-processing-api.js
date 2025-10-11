// Test script to verify document processing API endpoints
import fetch from 'node-fetch';
import dotenv from 'dotenv';

// Load environment variables
dotenv.config();

const API_BASE_URL = 'http://localhost:5000';

async function testDocumentProcessingAPI() {
  try {
    console.log('🧪 Testing Document Processing API Endpoints...\n');
    
    // Test credentials for the reader vocab account
    const testUser = {
      email: 'reader-vocab-test@example.com',
      password: 'TestPassword123!'
    };
    
    console.log(`🔐 Logging in with: ${testUser.email}`);
    
    // Step 1: Login to get auth token
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
      return;
    }
    
    console.log('✅ Login successful!');
    const authToken = loginData.token;
    
    // Step 2: Test /api/texts endpoint (document retrieval)
    console.log('\n📄 Testing /api/texts endpoint...');
    
    const textsResponse = await fetch(`${API_BASE_URL}/api/texts`, {
      method: 'GET',
      headers: {
        'Authorization': `Bearer ${authToken}`,
        'Content-Type': 'application/json'
      }
    });
    
    if (!textsResponse.ok) {
      const textsError = await textsResponse.json();
      console.log(`❌ Failed to fetch texts: ${textsError.error}`);
      console.log(`   Code: ${textsError.code}`);
      if (textsError.debug) {
        console.log(`   Debug info:`, textsError.debug);
      }
    } else {
      const texts = await textsResponse.json();
      console.log(`✅ Successfully retrieved ${texts.length} texts`);
      
      // Show sample text info
      if (texts.length > 0) {
        const sampleText = texts[0];
        console.log(`   Sample text: "${sampleText.title}" (${sampleText.content.length} chars)`);
        console.log(`   Created: ${sampleText.createdAt}`);
      }
    }
    
    // Step 3: Test /api/vocabEntries/by-tokens endpoint (core document processing)
    console.log('\n🔍 Testing /api/vocabEntries/by-tokens endpoint...');
    
    // Test with common Chinese characters/words that should exist in the vocab
    const testTokens = [
      '今天',    // today
      '咖啡店',  // coffee shop
      '春节',    // Spring Festival
      '太极拳',  // Tai Chi
      '市中心',  // city center
      '我',      // I/me
      '你',      // you
      '他',      // he/him
      '她',      // she/her
      '的',      // possessive particle
      '是',      // is/am/are
      '在',      // at/in/on
      '有',      // have/there is
      '不',      // not
      '了',      // completed action particle
      '中国',    // China
      '北京',    // Beijing
      '上海',    // Shanghai
      '学校',    // school
      '老师'     // teacher
    ];
    
    console.log(`   Testing with ${testTokens.length} tokens: ${testTokens.slice(0, 10).join(', ')}...`);
    
    const tokenLookupResponse = await fetch(`${API_BASE_URL}/api/vocabEntries/by-tokens`, {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${authToken}`,
        'Content-Type': 'application/json'
      },
      body: JSON.stringify({
        tokens: testTokens
      })
    });
    
    if (!tokenLookupResponse.ok) {
      const tokenError = await tokenLookupResponse.json();
      console.log(`❌ Token lookup failed: ${tokenError.error}`);
      console.log(`   Code: ${tokenError.code}`);
    } else {
      const foundEntries = await tokenLookupResponse.json();
      console.log(`✅ Token lookup successful!`);
      console.log(`   Tokens requested: ${testTokens.length}`);
      console.log(`   Entries found: ${foundEntries.length}`);
      console.log(`   Match rate: ${(foundEntries.length / testTokens.length * 100).toFixed(1)}%`);
      
      // Show found entries
      console.log('\n   📝 Found vocabulary entries:');
      foundEntries.forEach((entry, index) => {
        if (index < 10) { // Show first 10
          console.log(`      ${entry.entryKey || entry.entrykey} → ${(entry.entryValue || entry.entryvalue)?.substring(0, 50)}${(entry.entryValue || entry.entryvalue)?.length > 50 ? '...' : ''}`);
        }
      });
      
      if (foundEntries.length > 10) {
        console.log(`      ... and ${foundEntries.length - 10} more entries`);
      }
      
      // Check for specific expected words
      console.log('\n   🎯 Checking for specific expected words:');
      const expectedWords = ['今天', '咖啡店', '春节', '太极拳', '市中心'];
      expectedWords.forEach(word => {
        const found = foundEntries.find(entry => 
          (entry.entryKey || entry.entrykey) === word
        );
        if (found) {
          const value = found.entryValue || found.entryvalue;
          console.log(`      ✅ ${word} → ${value}`);
        } else {
          console.log(`      ❌ ${word} → NOT FOUND`);
        }
      });
    }
    
    // Step 4: Test edge cases
    console.log('\n🧪 Testing edge cases...');
    
    // Test with empty array
    console.log('   Testing empty token array...');
    const emptyResponse = await fetch(`${API_BASE_URL}/api/vocabEntries/by-tokens`, {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${authToken}`,
        'Content-Type': 'application/json'
      },
      body: JSON.stringify({
        tokens: []
      })
    });
    
    if (emptyResponse.ok) {
      const emptyResult = await emptyResponse.json();
      console.log(`   ✅ Empty array handled correctly: returned ${emptyResult.length} entries`);
    } else {
      console.log(`   ❌ Empty array test failed`);
    }
    
    // Test with single character tokens
    console.log('   Testing single character tokens...');
    const singleCharTokens = ['我', '你', '他', '她', '的'];
    const singleCharResponse = await fetch(`${API_BASE_URL}/api/vocabEntries/by-tokens`, {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${authToken}`,
        'Content-Type': 'application/json'
      },
      body: JSON.stringify({
        tokens: singleCharTokens
      })
    });
    
    if (singleCharResponse.ok) {
      const singleCharResult = await singleCharResponse.json();
      console.log(`   ✅ Single char tokens: ${singleCharResult.length}/${singleCharTokens.length} found`);
    } else {
      console.log(`   ❌ Single char tokens test failed`);
    }
    
    // Test with non-existent tokens
    console.log('   Testing non-existent tokens...');
    const nonExistentTokens = ['不存在的词', '假词汇', '测试用词'];
    const nonExistentResponse = await fetch(`${API_BASE_URL}/api/vocabEntries/by-tokens`, {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${authToken}`,
        'Content-Type': 'application/json'
      },
      body: JSON.stringify({
        tokens: nonExistentTokens
      })
    });
    
    if (nonExistentResponse.ok) {
      const nonExistentResult = await nonExistentResponse.json();
      console.log(`   ✅ Non-existent tokens handled: ${nonExistentResult.length} entries found (expected 0 or very few)`);
    } else {
      console.log(`   ❌ Non-existent tokens test failed`);
    }
    
    // Step 5: Performance test with larger token array
    console.log('\n⚡ Testing performance with larger token array...');
    const largeTokenArray = [];
    
    // Create a mix of real and potentially non-existent tokens
    const baseTokens = ['我', '你', '他', '她', '的', '是', '在', '有', '不', '了', '中国', '北京', '上海', '学校', '老师'];
    for (let i = 0; i < 100; i++) {
      largeTokenArray.push(baseTokens[i % baseTokens.length]);
    }
    
    console.log(`   Testing with ${largeTokenArray.length} tokens...`);
    const startTime = Date.now();
    
    const largeResponse = await fetch(`${API_BASE_URL}/api/vocabEntries/by-tokens`, {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${authToken}`,
        'Content-Type': 'application/json'
      },
      body: JSON.stringify({
        tokens: largeTokenArray
      })
    });
    
    const endTime = Date.now();
    const responseTime = endTime - startTime;
    
    if (largeResponse.ok) {
      const largeResult = await largeResponse.json();
      console.log(`   ✅ Large array processed successfully`);
      console.log(`      Response time: ${responseTime}ms`);
      console.log(`      Entries found: ${largeResult.length}`);
      console.log(`      Performance: ${(largeTokenArray.length / responseTime * 1000).toFixed(1)} tokens/second`);
    } else {
      const largeError = await largeResponse.json();
      console.log(`   ❌ Large array test failed: ${largeError.error}`);
    }
    
    // Step 6: Summary
    console.log('\n=== DOCUMENT PROCESSING API TEST SUMMARY ===');
    console.log(`✅ Login: Working`);
    console.log(`${textsResponse.ok ? '✅' : '❌'} Texts API: ${textsResponse.ok ? 'Working' : 'Failed'}`);
    console.log(`${tokenLookupResponse.ok ? '✅' : '❌'} Token Lookup API: ${tokenLookupResponse.ok ? 'Working' : 'Failed'}`);
    console.log(`${emptyResponse.ok ? '✅' : '❌'} Empty Array Handling: ${emptyResponse.ok ? 'Working' : 'Failed'}`);
    console.log(`${singleCharResponse.ok ? '✅' : '❌'} Single Character Tokens: ${singleCharResponse.ok ? 'Working' : 'Failed'}`);
    console.log(`${nonExistentResponse.ok ? '✅' : '❌'} Non-existent Tokens: ${nonExistentResponse.ok ? 'Working' : 'Failed'}`);
    console.log(`${largeResponse.ok ? '✅' : '❌'} Large Array Performance: ${largeResponse.ok ? 'Working' : 'Failed'}`);
    
    if (tokenLookupResponse.ok && textsResponse.ok) {
      console.log('\n🎉 DOCUMENT PROCESSING API IS WORKING CORRECTLY!');
      console.log('The core functionality for processing documents and retrieving vocab cards is functional.');
    } else {
      console.log('\n⚠️  SOME ISSUES DETECTED WITH DOCUMENT PROCESSING API');
      console.log('Please check the specific error messages above for details.');
    }
    
  } catch (error) {
    console.error('❌ Error testing document processing API:', error.message);
    console.log('This might indicate the server is not running or there are network issues.');
  }
}

// Run the test
testDocumentProcessingAPI();
