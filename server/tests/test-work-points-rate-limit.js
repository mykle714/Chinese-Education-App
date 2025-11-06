// Test to verify work points rate limiting (59 second minimum between increments)
import fetch from 'node-fetch';
import dotenv from 'dotenv';

// Load environment variables
dotenv.config();

const API_BASE_URL = 'http://localhost:5000';

// Helper function to wait
const wait = (ms) => new Promise(resolve => setTimeout(resolve, ms));

// Helper function to get current date in YYYY-MM-DD format
const getCurrentDate = () => {
  const now = new Date();
  const year = now.getFullYear();
  const month = String(now.getMonth() + 1).padStart(2, '0');
  const day = String(now.getDate()).padStart(2, '0');
  return `${year}-${month}-${day}`;
};

// Helper function to format elapsed time
const formatElapsed = (ms) => {
  return (ms / 1000).toFixed(1) + 's';
};

async function testRateLimit() {
  let authToken = null;
  const testUser = { 
    email: 'empty@test.com', 
    password: 'testing123' 
  };
  const testDate = getCurrentDate();
  const startTime = Date.now();
  
  console.log('\n🧪 Testing Work Points Rate Limit Enforcement\n');
  console.log('=' .repeat(60));
  console.log(`📝 Test User: ${testUser.email}`);
  console.log(`📅 Test Date: ${testDate}`);
  console.log(`⏱️  Rate Limit: 59 seconds minimum between increments`);
  console.log('=' .repeat(60) + '\n');

  try {
    // Step 1: Login
    console.log('🔐 Step 1: Logging in...');
    const loginResponse = await fetch(`${API_BASE_URL}/api/auth/login`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(testUser)
    });

    if (!loginResponse.ok) {
      const errorData = await loginResponse.json();
      console.error(`❌ Login failed: ${errorData.error}`);
      return;
    }

    const loginData = await loginResponse.json();
    authToken = loginData.token;
    console.log(`✅ Login successful (User: ${loginData.user.name})\n`);

    // Step 2: Get initial work points
    console.log('📊 Step 2: Getting initial work points...');
    const userResponse = await fetch(`${API_BASE_URL}/api/users/${loginData.user.id}/total-work-points`, {
      headers: { 
        'Authorization': `Bearer ${authToken}`,
        'Cookie': `token=${authToken}`
      }
    });

    const userData = await userResponse.json();
    const initialPoints = userData.totalWorkPoints || 0;
    console.log(`   Initial total work points: ${initialPoints}\n`);

    // Step 3: First increment request (should succeed)
    const req1Time = Date.now();
    const req1Elapsed = formatElapsed(req1Time - startTime);
    console.log(`🚀 Step 3: Request #1 (at ${req1Elapsed})...`);
    
    const response1 = await fetch(`${API_BASE_URL}/api/users/work-points/increment`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${authToken}`,
        'Cookie': `token=${authToken}`
      },
      body: JSON.stringify({ date: testDate })
    });

    const data1 = await response1.json();
    
    if (response1.ok && data1.success) {
      console.log(`✅ SUCCESS: ${data1.message}`);
      console.log(`   Points added: ${data1.workPointsAdded}`);
      console.log(`   Response time: ${Date.now() - req1Time}ms\n`);
    } else {
      console.log(`❌ FAILED: ${data1.error || data1.message}`);
      console.log(`   This first request should have succeeded!\n`);
      return;
    }

    // Step 4: Immediate second request (should fail with rate limit)
    await wait(100); // Wait 100ms to ensure it's after first request but well under 59 seconds
    const req2Time = Date.now();
    const req2Elapsed = formatElapsed(req2Time - startTime);
    const timeSinceFirst = ((req2Time - req1Time) / 1000).toFixed(2);
    
    console.log(`🚀 Step 4: Request #2 (at ${req2Elapsed}, ${timeSinceFirst}s after #1)...`);
    console.log(`   Expected: RATE LIMIT ERROR`);
    
    const response2 = await fetch(`${API_BASE_URL}/api/users/work-points/increment`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${authToken}`,
        'Cookie': `token=${authToken}`
      },
      body: JSON.stringify({ date: testDate })
    });

    const data2 = await response2.json();
    
    if (!response2.ok && data2.error && data2.error.includes('wait')) {
      console.log(`✅ CORRECTLY REJECTED: ${data2.error}`);
      console.log(`   Status: ${response2.status}`);
      console.log(`   Rate limit working as expected!\n`);
    } else if (response2.ok) {
      console.log(`❌ ERROR: Second request succeeded when it should have been rate limited!`);
      console.log(`   This is a SECURITY ISSUE - rate limit not working!\n`);
      return;
    } else {
      console.log(`⚠️  UNEXPECTED ERROR: ${data2.error}`);
      console.log(`   Expected rate limit error, got something else\n`);
    }

    // Step 5: Wait to 58 seconds for boundary test
    const timeUntil58s = 58000 - (Date.now() - req1Time);
    if (timeUntil58s > 0) {
      console.log(`⏳ Step 5: Waiting ${(timeUntil58s / 1000).toFixed(1)}s to reach 58s mark...`);
      
      // Show progress every 10 seconds
      const progressInterval = 10000;
      let waited = 0;
      while (waited < timeUntil58s) {
        const waitChunk = Math.min(progressInterval, timeUntil58s - waited);
        await wait(waitChunk);
        waited += waitChunk;
        if (waited < timeUntil58s) {
          const remaining = ((timeUntil58s - waited) / 1000).toFixed(1);
          console.log(`   ⏱️  ${remaining}s remaining...`);
        }
      }
      console.log(`   ✅ Reached 58s mark!\n`);
    }

    // Step 6: Boundary test at 58 seconds (should still be rate limited)
    const req3Time = Date.now();
    const req3Elapsed = formatElapsed(req3Time - startTime);
    const timeSinceFirst3 = ((req3Time - req1Time) / 1000).toFixed(2);
    
    console.log(`🚀 Step 6: Request #3 - BOUNDARY TEST (at ${req3Elapsed}, ${timeSinceFirst3}s after #1)...`);
    console.log(`   Expected: RATE LIMIT ERROR (< 59s)`);
    
    const response3 = await fetch(`${API_BASE_URL}/api/users/work-points/increment`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${authToken}`,
        'Cookie': `token=${authToken}`
      },
      body: JSON.stringify({ date: testDate })
    });

    const data3 = await response3.json();
    
    if (!response3.ok && data3.error && data3.error.includes('wait')) {
      console.log(`✅ CORRECTLY REJECTED at 58s: ${data3.error}`);
      console.log(`   Status: ${response3.status}`);
      console.log(`   Boundary condition working correctly!\n`);
    } else if (response3.ok) {
      console.log(`❌ ERROR: Request at 58s succeeded when it should have been rate limited!`);
      console.log(`   This is a SECURITY ISSUE - boundary condition not working!\n`);
      return;
    } else {
      console.log(`⚠️  UNEXPECTED ERROR: ${data3.error}`);
      console.log(`   Expected rate limit error at 58s\n`);
    }

    // Step 7: Wait the final 1 second (to reach 59s total)
    const timeUntil59s = 59000 - (Date.now() - req1Time);
    if (timeUntil59s > 0) {
      console.log(`⏳ Step 7: Waiting final ${(timeUntil59s / 1000).toFixed(1)}s to reach 59s...`);
      await wait(timeUntil59s);
      console.log(`   ✅ Reached 59s mark!\n`);
    }

    // Step 8: Fourth request after full 59 seconds (should succeed)
    const req4Time = Date.now();
    const req4Elapsed = formatElapsed(req4Time - startTime);
    const timeSinceFirst4 = ((req4Time - req1Time) / 1000).toFixed(2);
    
    console.log(`🚀 Step 8: Request #4 (at ${req4Elapsed}, ${timeSinceFirst4}s after #1)...`);
    console.log(`   Expected: SUCCESS (≥ 59s)`);
    
    const response4 = await fetch(`${API_BASE_URL}/api/users/work-points/increment`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${authToken}`,
        'Cookie': `token=${authToken}`
      },
      body: JSON.stringify({ date: testDate })
    });

    const data4 = await response4.json();
    
    if (response4.ok && data4.success) {
      console.log(`✅ SUCCESS: ${data4.message}`);
      console.log(`   Points added: ${data4.workPointsAdded}`);
      console.log(`   Response time: ${Date.now() - req4Time}ms\n`);
    } else {
      console.log(`❌ FAILED: ${data4.error || data4.message}`);
      console.log(`   This request should have succeeded after waiting!\n`);
      return;
    }

    // Step 9: Verify final total work points
    console.log('🔍 Step 9: Verifying final work points...');
    const finalUserResponse = await fetch(`${API_BASE_URL}/api/users/${loginData.user.id}/total-work-points`, {
      headers: { 
        'Authorization': `Bearer ${authToken}`,
        'Cookie': `token=${authToken}`
      }
    });

    const finalUserData = await finalUserResponse.json();
    const finalPoints = finalUserData.totalWorkPoints || 0;
    const pointsAdded = finalPoints - initialPoints;
    
    console.log(`   Initial points: ${initialPoints}`);
    console.log(`   Final points: ${finalPoints}`);
    console.log(`   Points added: ${pointsAdded}`);
    
    if (pointsAdded === 2) {
      console.log(`   ✅ CORRECT: Exactly 2 points added (rate limit worked!)\n`);
    } else if (pointsAdded === 3) {
      console.log(`   ❌ ERROR: 3 points added - rate limit did NOT work!\n`);
      return;
    } else {
      console.log(`   ⚠️  UNEXPECTED: ${pointsAdded} points added (expected 2)\n`);
      return;
    }

    // Final summary
    const totalTime = formatElapsed(Date.now() - startTime);
    console.log('=' .repeat(60));
    console.log('✅ ALL TESTS PASSED!');
    console.log('=' .repeat(60));
    console.log('✓ Request #1 (0.0s): Succeeded correctly');
    console.log('✓ Request #2 (0.1s): Rate limited correctly');
    console.log('✓ Request #3 (58.0s): Rate limited correctly (boundary test)');
    console.log('✓ Request #4 (59.0s): Succeeded correctly');
    console.log('✓ Only 2 points awarded (not 3 or 4)');
    console.log('✓ Rate limit enforcement verified at boundary (58s)');
    console.log('=' .repeat(60));
    console.log(`\n🎉 Test completed in ${totalTime}\n`);

  } catch (error) {
    console.error('\n❌ Test error:', error.message);
    console.error(error.stack);
  }
}

// Run the test
testRateLimit();
