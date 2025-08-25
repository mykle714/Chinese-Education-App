import fetch from 'node-fetch';

// Test configuration
const API_BASE_URL = 'http://localhost:3001';
const TEST_USER = { email: 'test@example.com', password: 'pw' };

async function testAuthMiddleware() {
    console.log('🧪 Testing Authentication Middleware...\n');
    
    try {
        // Step 1: Login to get JWT token
        console.log('1. Logging in to get JWT token...');
        const loginResponse = await fetch(`${API_BASE_URL}/api/auth/login`, {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json'
            },
            body: JSON.stringify(TEST_USER)
        });

        if (!loginResponse.ok) {
            const errorData = await loginResponse.json();
            throw new Error(`Login failed: ${errorData.error}`);
        }

        const loginData = await loginResponse.json();
        const token = loginData.token;
        const user = loginData.user;
        
        console.log(`✅ Login successful for user: ${user.name} (${user.email})`);
        console.log(`   User ID: ${user.id}`);
        console.log(`   Token: ${token.substring(0, 20)}...\n`);

        // Step 2: Test the /api/auth/me endpoint to verify token works
        console.log('2. Testing /api/auth/me endpoint...');
        const meResponse = await fetch(`${API_BASE_URL}/api/auth/me`, {
            headers: {
                'Authorization': `Bearer ${token}`
            }
        });

        if (!meResponse.ok) {
            const errorData = await meResponse.json();
            throw new Error(`Auth me failed: ${errorData.error} (Code: ${errorData.code})`);
        }

        const meData = await meResponse.json();
        console.log('✅ Auth me successful!');
        console.log(`   Authenticated user: ${meData.name} (${meData.email})`);
        console.log(`   User ID: ${meData.id}\n`);

        // Step 3: Test a simple GET request to vocab entries
        console.log('3. Testing GET /api/vocabEntries...');
        const getResponse = await fetch(`${API_BASE_URL}/api/vocabEntries`, {
            headers: {
                'Authorization': `Bearer ${token}`
            }
        });

        if (!getResponse.ok) {
            const errorData = await getResponse.json();
            console.log(`❌ GET vocabEntries failed: ${errorData.error} (Code: ${errorData.code})`);
        } else {
            const entries = await getResponse.json();
            console.log(`✅ GET vocabEntries successful! Found ${entries.length} entries\n`);
        }

        console.log('🎉 Authentication middleware is working correctly!');

    } catch (error) {
        console.error('❌ TEST FAILED:', error.message);
        process.exit(1);
    }
}

// Run the test
testAuthMiddleware();
